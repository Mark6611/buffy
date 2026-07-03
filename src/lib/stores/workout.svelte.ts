// Active-workout state machine: drives the live screen.
// Logging is linear (exercise by exercise); superset groups render together but
// log in order — full round-cycling is a planned refinement (the data model
// already carries groupId so it can layer on without schema change).
import { getRepository } from '$lib/db';
import type { Exercise, LoggedExercise, LoggedSet, WorkoutSession } from '$lib/types';
import { settings } from './settings.svelte';
import { computeSuggestion, type Suggestion } from '$lib/progression';
import { recovery } from './recovery.svelte';
import {
	haptic,
	keepAwake,
	allowSleep,
	reacquireWakeLock,
	scheduleRestEndAlert,
	cancelRestEndAlert,
	startRestLiveActivity,
	endRestLiveActivity,
	readPendingRestAdjustment
} from '$lib/native';
import { newId } from '$lib/id';

// In-progress workouts are persisted here so a backgrounded or killed app (iOS
// purges the WebView under memory pressure) resumes exactly where it left off,
// timers included. This is transient, device-local resume state — not a domain
// record (sessions only reach the repository on finish()) — so localStorage is
// the right store and the repository boundary doesn't apply.
const RESUME_KEY = 'buffy:activeWorkout';

interface ResumeSnapshot {
	session: WorkoutSession;
	plannedRest: number[][];
	activeEx: number;
	activeSet: number;
	restRunning: boolean;
	restSeedSec: number;
	restForSet: { ex: number; set: number } | null;
	restStartedAtMs: number;
	restAccumSec: number;
}

class WorkoutStore {
	session = $state<WorkoutSession | null>(null);
	meta = $state<Exercise[]>([]); // parallel to session.exercises
	plannedRest = $state<number[][]>([]); // seed seconds per [ex][set]
	suggestions = $state<Record<string, Suggestion | null>>({});

	activeEx = $state(0);
	activeSet = $state(0);

	// Rest timer — wall-clock based. Elapsed is DERIVED from timestamps (see the
	// restElapsedSec getter), never incremented tick-by-tick, so it stays correct
	// across app backgrounding (the WebView's JS timers freeze when suspended).
	restRunning = $state(false);
	restSeedSec = $state(0);
	restForSet = $state<{ ex: number; set: number } | null>(null);
	restStartedAtMs = $state(0); // when the current running rest segment began
	restAccumSec = $state(0); // rest banked from earlier segments (before pauses)
	private restHapticFired = false;

	nowMs = $state(Date.now());
	private interval: ReturnType<typeof setInterval> | null = null;

	constructor() {
		if (typeof document !== 'undefined') {
			// Returning to the foreground: refresh the clock immediately so both
			// timers jump to the real elapsed time instead of waiting for the next
			// tick (and the interval, which iOS suspended, resumes on its own).
			document.addEventListener('visibilitychange', () => {
				if (document.visibilityState === 'visible') {
					this.nowMs = Date.now();
					cancelRestEndAlert(); // back in-app — the on-screen + haptic cue takes over
					reacquireWakeLock();
					void this.reconcileLiveActivityAdjustment(); // apply any +30s/skip done from the Island while away
				} else if (this.restRunning && this.restForSet && this.restRemaining > 0) {
					// backgrounded mid-rest: hand the rest-over alert to the OS so it
					// still fires (sound + system buzz) while the app is suspended/locked
					const endMs = this.restStartedAtMs + (this.restSeedSec - this.restAccumSec) * 1000;
					scheduleRestEndAlert(endMs, this.meta[this.restForSet.ex]?.name);
				}
			});
		}
		if (typeof window !== 'undefined') {
			// Auto-persist on any change — including direct set edits (reps/weight
			// inputs mutate the set object, not via a method). The deep snapshot read
			// tracks every nested field; nowMs is deliberately NOT read here so we
			// don't write every second. Removal is explicit (cancel) to avoid a
			// startup race where the first run wipes a session before restore() reads.
			$effect.root(() => {
				$effect(() => {
					if (!this.session) return;
					const snap: ResumeSnapshot = {
						session: $state.snapshot(this.session) as WorkoutSession,
						plannedRest: $state.snapshot(this.plannedRest) as number[][],
						activeEx: this.activeEx,
						activeSet: this.activeSet,
						restRunning: this.restRunning,
						restSeedSec: this.restSeedSec,
						restForSet: this.restForSet ? { ...this.restForSet } : null,
						restStartedAtMs: this.restStartedAtMs,
						restAccumSec: this.restAccumSec
					};
					try {
						localStorage.setItem(RESUME_KEY, JSON.stringify(snap));
					} catch {
						/* storage unavailable — resume is best-effort */
					}
				});
			});
		}
	}

	get active(): boolean {
		return this.session !== null;
	}
	get restElapsedSec(): number {
		if (this.restForSet == null) return 0;
		const running = this.restRunning ? (this.nowMs - this.restStartedAtMs) / 1000 : 0;
		return Math.max(0, this.restAccumSec + running);
	}
	get restRemaining(): number {
		return this.restSeedSec - this.restElapsedSec;
	}
	get restOver(): boolean {
		return this.restRemaining < 0;
	}
	get elapsedSec(): number {
		if (!this.session) return 0;
		return Math.max(0, (this.nowMs - Date.parse(this.session.startedAt)) / 1000);
	}
	get exerciseCount(): number {
		return this.session?.exercises.length ?? 0;
	}

	private ensureInterval() {
		if (this.interval) return;
		this.interval = setInterval(() => {
			this.nowMs = Date.now();
			if (
				this.restRunning &&
				this.restForSet &&
				!this.restHapticFired &&
				this.restElapsedSec >= this.restSeedSec &&
				settings.current.hapticAtRestEnd
			) {
				this.restHapticFired = true;
				haptic('heavy'); // rest hit zero — native buzz on iOS; on-screen cue everywhere
			}
		}, 1000);
	}
	private stopInterval() {
		if (this.interval) clearInterval(this.interval);
		this.interval = null;
	}

	async startFromTemplate(templateId: string, applySuggestions = false) {
		const repo = getRepository();
		await settings.load();
		const [tpl, exAll] = await Promise.all([repo.getTemplate(templateId), repo.listExercises()]);
		if (!tpl) return;
		const byId = new Map(exAll.map((e) => [e.id, e]));

		const meta: Exercise[] = [];
		const plannedRest: number[][] = [];
		const exercises: LoggedExercise[] = tpl.exercises.map((tex) => {
			const ex = byId.get(tex.exerciseId)!;
			meta.push(ex);
			plannedRest.push(
				tex.plannedSets.map((ps) => ps.targetRestSec ?? ex.defaultRestSec ?? settings.current.defaultRestSec)
			);
			return {
				exerciseId: tex.exerciseId,
				groupId: tex.groupId ?? null,
				setupNote: tex.setupNote ?? ex.setupNote,
				sets: tex.plannedSets.map((ps, i) => ({
					index: i,
					completed: false,
					reps: ps.targetReps,
					weight: ps.targetWeight,
					durationSec: ps.targetDurationSec,
					timeSec: ps.targetTimeSec,
					incline: ps.targetIncline,
					speed: ps.targetSpeed,
					perSide: ex.loadType === 'per_side' ? true : undefined
				}))
			};
		});

		// auto-progression suggestions from last time
		const sugg: Record<string, Suggestion | null> = {};
		if (settings.current.autoProgression) {
			await recovery.refresh(); // suggestions must see today's band, not last view's
			for (const ex of meta) {
				const last = await repo.lastSessionForExercise(ex.id);
				sugg[ex.id] = computeSuggestion(ex, last, { readiness: recovery.current?.band });
			}
		}

		if (applySuggestions) {
			exercises.forEach((le) => {
				const sg = sugg[le.exerciseId];
				if (!sg) return;
				le.sets.forEach((set) => {
					if (sg.nextWeight != null) set.weight = sg.nextWeight;
					if (sg.nextReps != null) set.reps = sg.nextReps;
				});
			});
		}

		this.meta = meta;
		this.plannedRest = plannedRest;
		this.suggestions = sugg;
		this.session = {
			id: newId(),
			startedAt: new Date().toISOString(),
			sourceTemplateId: templateId,
			title: tpl.name,
			exercises
		};
		this.resetTimerState();
		this.setActiveToFirstIncomplete();
		this.nowMs = Date.now();
		this.ensureInterval();
		keepAwake();
	}

	startAdhoc() {
		this.meta = [];
		this.plannedRest = [];
		this.suggestions = {};
		this.session = {
			id: newId(),
			startedAt: new Date().toISOString(),
			sourceTemplateId: null,
			title: 'Quick log',
			exercises: []
		};
		this.resetTimerState();
		this.nowMs = Date.now();
		this.ensureInterval();
		keepAwake();
	}

	/** Resume an in-progress workout after an app restart / WebView purge. */
	restore() {
		if (this.session) return;
		let snap: ResumeSnapshot | null = null;
		try {
			const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(RESUME_KEY) : null;
			snap = raw ? (JSON.parse(raw) as ResumeSnapshot) : null;
		} catch {
			snap = null;
		}
		if (!snap?.session?.exercises?.length) return;

		this.plannedRest = snap.plannedRest ?? [];
		this.activeEx = snap.activeEx ?? 0;
		this.activeSet = snap.activeSet ?? 0;
		this.restSeedSec = snap.restSeedSec ?? 0;
		this.restForSet = snap.restForSet ?? null;
		this.restStartedAtMs = snap.restStartedAtMs ?? 0;
		this.restAccumSec = snap.restAccumSec ?? 0;
		this.restRunning = snap.restRunning ?? false;
		this.session = snap.session;
		this.nowMs = Date.now();

		// Left mid-rest for hours? Drop the stale rest so the banner doesn't show a
		// nonsense overage on resume.
		if (this.restForSet && this.restElapsedSec > this.restSeedSec + 3600) {
			this.restRunning = false;
			this.restForSet = null;
			this.restSeedSec = 0;
			this.restAccumSec = 0;
		}
		this.restHapticFired = this.restElapsedSec >= this.restSeedSec;

		this.ensureInterval();
		keepAwake();
		// A cold relaunch never fires visibilitychange (nothing transitioned FROM
		// hidden in this process), so a pending Live Activity adjustment has to be
		// reconciled here too, before the Activity is re-synced to our state.
		void this.reconcileLiveActivityAdjustment().then(() => this.restLiveSync());
		void this.hydrateMeta();
	}

	/** Re-fetch exercise metadata + suggestions for a restored session (async). */
	private async hydrateMeta() {
		const s = this.session;
		if (!s) return;
		const repo = getRepository();
		await settings.load();
		const exAll = await repo.listExercises();
		const byId = new Map(exAll.map((e) => [e.id, e]));
		this.meta = s.exercises.map((le) => byId.get(le.exerciseId) as Exercise);
		const sugg: Record<string, Suggestion | null> = {};
		if (settings.current.autoProgression) {
			await recovery.refresh(); // suggestions must see today's band, not last view's
			for (const le of s.exercises) {
				const ex = byId.get(le.exerciseId);
				if (!ex) continue;
				const last = await repo.lastSessionForExercise(ex.id);
				sugg[ex.id] = computeSuggestion(ex, last, { readiness: recovery.current?.band });
			}
		}
		this.suggestions = sugg;
	}

	addExercise(ex: Exercise, sets = 3) {
		if (!this.session) return;
		this.meta.push(ex);
		this.plannedRest.push(Array.from({ length: sets }, () => ex.defaultRestSec ?? settings.current.defaultRestSec));
		this.session.exercises.push({
			exerciseId: ex.id,
			groupId: null,
			setupNote: ex.setupNote,
			sets: Array.from({ length: sets }, (_, i) => ({
				index: i,
				completed: false,
				reps: ex.defaultTargetReps,
				perSide: ex.loadType === 'per_side' ? true : undefined
			}))
		});
	}

	/** Remove an exercise entirely from the in-progress workout (any logged sets on it are lost). */
	removeExercise(exIndex: number) {
		const s = this.session;
		if (!s || !s.exercises[exIndex]) return;
		const removedId = s.exercises[exIndex].exerciseId;
		s.exercises.splice(exIndex, 1);
		this.meta.splice(exIndex, 1);
		this.plannedRest.splice(exIndex, 1);
		if (!s.exercises.some((e) => e.exerciseId === removedId)) delete this.suggestions[removedId];

		if (this.restForSet?.ex === exIndex) {
			// the exercise we were resting for is gone — nothing left to record it against
			cancelRestEndAlert();
			this.restRunning = false;
			this.restAccumSec = 0;
			this.restStartedAtMs = 0;
			this.restSeedSec = 0;
			this.restForSet = null;
			this.restHapticFired = false;
		} else if (this.restForSet && this.restForSet.ex > exIndex) {
			this.restForSet = { ...this.restForSet, ex: this.restForSet.ex - 1 };
		}
		this.setActiveToFirstIncomplete();
		// all sets complete: setActiveToFirstIncomplete leaves activeEx untouched,
		// which can now point past the shortened list (UI would read "2/1")
		if (this.activeEx >= s.exercises.length) {
			this.activeEx = Math.max(0, s.exercises.length - 1);
			this.activeSet = 0;
		}
		this.restLiveSync();
	}

	/** Swap the exercise at a slot for a different one — a fresh set list at the new
	 *  exercise's defaults (same set count), since logged weight/reps only make sense
	 *  for the exercise they were logged against. */
	swapExercise(exIndex: number, newEx: Exercise) {
		const s = this.session;
		const le = s?.exercises[exIndex];
		if (!s || !le) return;
		const removedId = le.exerciseId;
		const setCount = le.sets.length || 3;

		this.meta[exIndex] = newEx;
		this.plannedRest[exIndex] = Array.from({ length: setCount }, () => newEx.defaultRestSec ?? settings.current.defaultRestSec);
		s.exercises[exIndex] = {
			exerciseId: newEx.id,
			groupId: le.groupId ?? null,
			setupNote: newEx.setupNote,
			sets: Array.from({ length: setCount }, (_, i) => ({
				index: i,
				completed: false,
				reps: newEx.defaultTargetReps,
				perSide: newEx.loadType === 'per_side' ? true : undefined
			}))
		};
		if (!s.exercises.some((e) => e.exerciseId === removedId)) delete this.suggestions[removedId];

		if (this.restForSet?.ex === exIndex) {
			// the exercise identity changed mid-rest — nothing left to record the old rest against
			cancelRestEndAlert();
			this.restRunning = false;
			this.restAccumSec = 0;
			this.restStartedAtMs = 0;
			this.restSeedSec = 0;
			this.restForSet = null;
			this.restHapticFired = false;
		}
		this.setActiveToFirstIncomplete();
		this.restLiveSync();
		void this.hydrateSuggestionFor(newEx);
	}

	/** Fetch (or clear) the auto-progression suggestion for one exercise — used after a swap. */
	private async hydrateSuggestionFor(ex: Exercise) {
		if (!settings.current.autoProgression) return;
		const last = await getRepository().lastSessionForExercise(ex.id);
		this.suggestions[ex.id] = computeSuggestion(ex, last, { readiness: recovery.current?.band });
	}

	/** Move an exercise one slot up/down. Superset blocks travel as UNITS — the
	 *  group chip and round-cycling both assume members stay adjacent, so a
	 *  grouped exercise drags its partners along and a neighbor group is jumped
	 *  over whole. */
	moveExercise(exIndex: number, dir: -1 | 1) {
		const s = this.session;
		if (!s || !s.exercises[exIndex]) return;
		const own = this.groupBounds(exIndex);
		const neighborIndex = dir === -1 ? own.start - 1 : own.end + 1;
		if (neighborIndex < 0 || neighborIndex >= s.exercises.length) return;
		const other = this.groupBounds(neighborIndex);
		const [top, bottom] = dir === -1 ? [other, own] : [own, other];
		// remap the rest pointer by object identity — index math across two moving
		// blocks is exactly the kind of arithmetic that grows off-by-ones
		const restLe = this.restForSet ? s.exercises[this.restForSet.ex] : null;
		const swapBlocks = <T,>(arr: T[]) => {
			const block = arr.splice(bottom.start, bottom.end - bottom.start + 1);
			arr.splice(top.start, 0, ...block);
		};
		swapBlocks(s.exercises);
		swapBlocks(this.meta);
		swapBlocks(this.plannedRest);
		if (restLe && this.restForSet) {
			this.restForSet = { ...this.restForSet, ex: s.exercises.indexOf(restLe) };
		}
		this.setActiveToFirstIncomplete();
		this.restLiveSync();
	}

	addSet(exIndex: number) {
		const le = this.session?.exercises[exIndex];
		if (!le) return;
		const last = le.sets[le.sets.length - 1];
		le.sets.push({
			index: le.sets.length,
			completed: false,
			reps: last?.reps,
			weight: last?.weight,
			durationSec: last?.durationSec,
			perSide: last?.perSide
		});
		this.plannedRest[exIndex]?.push(this.plannedRest[exIndex].at(-1) ?? settings.current.defaultRestSec);
		// if everything was complete, the new set is now the workout's next target
		this.setActiveToFirstIncomplete();
	}

	removeSet(exIndex: number) {
		const le = this.session?.exercises[exIndex];
		if (le) this.removeSetAt(exIndex, le.sets.length - 1);
	}

	/** Delete one set mid-workout (swipe-to-delete on a set row). The last
	 *  remaining set can't be removed — deleting the whole exercise is the
	 *  existing swipe on its header. */
	removeSetAt(exIndex: number, setIndex: number) {
		const le = this.session?.exercises[exIndex];
		if (!le || le.sets.length <= 1 || !le.sets[setIndex]) return;
		le.sets.splice(setIndex, 1);
		le.sets.forEach((set, i) => (set.index = i));
		this.plannedRest[exIndex]?.splice(setIndex, 1);

		if (this.restForSet?.ex === exIndex) {
			if (this.restForSet.set === setIndex) {
				// the set we were resting after is gone — nothing to record the rest against
				cancelRestEndAlert();
				this.restRunning = false;
				this.restAccumSec = 0;
				this.restStartedAtMs = 0;
				this.restSeedSec = 0;
				this.restForSet = null;
				this.restHapticFired = false;
			} else if (this.restForSet.set > setIndex) {
				this.restForSet = { ...this.restForSet, set: this.restForSet.set - 1 };
			}
		}
		this.setActiveToFirstIncomplete();
		// mirror removeExercise's clamp: with everything complete the active pointer
		// can be left past the shortened set list
		if (this.activeEx === exIndex && this.activeSet >= le.sets.length) {
			this.activeSet = Math.max(0, le.sets.length - 1);
		}
		this.restLiveSync();
	}

	toggleSet(exIndex: number, setIndex: number) {
		const set = this.session?.exercises[exIndex]?.sets[setIndex];
		if (!set) return;
		if (set.completed) {
			set.completed = false;
			return;
		}
		set.completed = true;
		haptic('medium'); // tactile confirm of a logged set
		cancelRestEndAlert(); // clear any pending alert from the rest we just ended
		// assign elapsed rest to whichever set we were resting on (read before reset)
		if (this.restForSet) {
			const prev = this.session!.exercises[this.restForSet.ex]?.sets[this.restForSet.set];
			if (prev) prev.restTakenSec = Math.max(0, Math.round(this.restElapsedSec));
		}
		// The timer starts after EVERY logged set — regardless of which exercise or
		// which set, in or out of the template's order. Supersets keep their
		// round-cycling active pointer (A1→B1→A2…), but no longer suppress the
		// timer mid-round: suppression meant that deviating from the round flow
		// (straight sets on one member) silently never started a rest at all. When
		// you do fly straight to the partner exercise, this rest simply gets folded
		// into that set as a few seconds of recorded rest — harmless.
		this.restSeedSec = this.plannedRest[exIndex]?.[setIndex] ?? settings.current.defaultRestSec;
		this.restForSet = { ex: exIndex, set: setIndex };
		this.restStartedAtMs = Date.now();
		this.restAccumSec = 0;
		this.restRunning = true;
		this.restHapticFired = false;
		this.nowMs = Date.now();
		this.setActiveToFirstIncomplete();
		this.restLiveSync();
	}

	adjustRest(delta: number) {
		this.restSeedSec = Math.max(5, this.restSeedSec + delta);
		if (this.restElapsedSec < this.restSeedSec) this.restHapticFired = false; // re-arm if we pushed past the buzz
		this.restLiveSync();
	}
	/** Set the running rest timer to an absolute duration (tap-to-edit on the banner). */
	setRestSeed(sec: number) {
		this.restSeedSec = Math.max(5, Math.round(sec || 0));
		if (this.restElapsedSec < this.restSeedSec) this.restHapticFired = false;
		this.restLiveSync();
	}
	/** Change the planned rest (timer seed) for an upcoming set. */
	setPlannedRest(exIndex: number, setIndex: number, sec: number) {
		const row = this.plannedRest[exIndex];
		if (row && setIndex < row.length) row[setIndex] = Math.max(0, Math.round(sec || 0));
	}
	/** Free-text note for the whole session. */
	setNote(text: string) {
		if (this.session) this.session.note = text;
	}
	togglePause() {
		if (this.restRunning) {
			// bank the running segment, then freeze
			this.restAccumSec = Math.max(0, this.restAccumSec + (Date.now() - this.restStartedAtMs) / 1000);
			this.restRunning = false;
		} else {
			this.restStartedAtMs = Date.now();
			this.nowMs = Date.now();
			this.restRunning = true;
		}
		this.restLiveSync();
	}
	skipRest() {
		if (this.restForSet) {
			const prev = this.session?.exercises[this.restForSet.ex]?.sets[this.restForSet.set];
			if (prev) prev.restTakenSec = Math.max(0, Math.round(this.restElapsedSec));
		}
		cancelRestEndAlert();
		this.restRunning = false;
		this.restAccumSec = 0;
		this.restStartedAtMs = 0;
		this.restSeedSec = 0;
		this.restForSet = null;
		this.restHapticFired = false;
		this.restLiveSync();
	}

	private resetTimerState() {
		this.restRunning = false;
		this.restAccumSec = 0;
		this.restStartedAtMs = 0;
		this.restSeedSec = 0;
		this.restForSet = null;
		this.restHapticFired = false;
		this.activeEx = 0;
		this.activeSet = 0;
	}

	/** Keep the Dynamic Island / Lock Screen Live Activity in sync with the rest timer. */
	private restLiveSync() {
		if (this.restRunning && this.restForSet && this.restRemaining > 0.5) {
			const now = Date.now();
			startRestLiveActivity(now, now + this.restRemaining * 1000, this.meta[this.restForSet.ex]?.name ?? 'Rest');
		} else {
			endRestLiveActivity();
		}
	}

	/** Apply a +30s/skip done from the Live Activity's own buttons while the app
	 *  was backgrounded — those act directly on the Activity, so this brings the
	 *  in-app timer state (and hence the next restLiveSync) back in sync with it. */
	private applyExternalRestAdjustment(adj: { endTimeMs: number; skipped: boolean }) {
		if (!this.restForSet) return;
		if (adj.skipped) {
			this.skipRest();
			return;
		}
		const remainingSec = (adj.endTimeMs - Date.now()) / 1000;
		this.setRestSeed(this.restElapsedSec + remainingSec);
	}

	private async reconcileLiveActivityAdjustment() {
		const adj = await readPendingRestAdjustment();
		if (adj) this.applyExternalRestAdjustment(adj);
	}

	/** Bounds [start, end] of the superset group exIndex belongs to — a maximal run of
	 *  consecutive exercises sharing a non-null groupId; a standalone exercise is itself. */
	private groupBounds(exIndex: number): { start: number; end: number } {
		const s = this.session;
		if (!s) return { start: exIndex, end: exIndex };
		const g = s.exercises[exIndex]?.groupId ?? null;
		if (g == null) return { start: exIndex, end: exIndex };
		let start = exIndex;
		let end = exIndex;
		while (start - 1 >= 0 && s.exercises[start - 1]?.groupId === g) start--;
		while (end + 1 < s.exercises.length && s.exercises[end + 1]?.groupId === g) end++;
		return { start, end };
	}

	/** True if finishing (exIndex, round) is a mid-superset step — another exercise in
	 *  the group still owes that round — so we go straight on with no rest between. */
	// Advance in superset round order: set r of every exercise in a group (A1→B1→A2→B2…)
	// before moving on. Standalone exercises log linearly (a group of one).
	private setActiveToFirstIncomplete() {
		const s = this.session;
		if (!s) return;
		let e = 0;
		while (e < s.exercises.length) {
			const { start, end } = this.groupBounds(e);
			let maxSets = 0;
			for (let g = start; g <= end; g++) maxSets = Math.max(maxSets, s.exercises[g].sets.length);
			for (let r = 0; r < maxSets; r++) {
				for (let g = start; g <= end; g++) {
					const set = s.exercises[g].sets[r];
					if (set && !set.completed) {
						this.activeEx = g;
						this.activeSet = r;
						return;
					}
				}
			}
			e = end + 1;
		}
	}

	async finish(): Promise<string | null> {
		const s = this.session;
		if (!s) return null;
		// fold the final running rest into its set
		if (this.restForSet) {
			const prev = s.exercises[this.restForSet.ex]?.sets[this.restForSet.set];
			if (prev) prev.restTakenSec = Math.max(0, Math.round(this.restElapsedSec));
		}
		s.endedAt = new Date().toISOString();
		// keep only completed sets (drop prefilled-but-unchecked ones), then drop empty exercises
		s.exercises = s.exercises
			.map((e) => ({ ...e, sets: e.sets.filter((x) => x.completed) }))
			.filter((e) => e.sets.length > 0);
		if (s.exercises.length === 0) {
			this.cancel();
			return null; // nothing logged — don't save an empty session
		}
		await getRepository().upsertSession($state.snapshot(s));
		const id = s.id;
		this.cancel();
		return id;
	}

	cancel() {
		this.stopInterval();
		allowSleep();
		cancelRestEndAlert();
		endRestLiveActivity();
		this.session = null;
		this.meta = [];
		this.plannedRest = [];
		this.suggestions = {};
		this.resetTimerState();
		try {
			if (typeof localStorage !== 'undefined') localStorage.removeItem(RESUME_KEY);
		} catch {
			/* ignore */
		}
	}
}

export const workout = new WorkoutStore();
