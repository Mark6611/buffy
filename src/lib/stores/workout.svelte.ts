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
	/** Exercise metadata parallel to session.exercises. Snapshotted (rather than
	 *  re-read on resume) so the table renders with the RIGHT columns on the first
	 *  paint, and so the Live Activity keeps the exercise name instead of falling
	 *  back to a generic "Rest". Optional — snapshots written by older builds
	 *  don't carry it and still restore. */
	meta?: Exercise[];
	activeEx: number;
	activeSet: number;
	restRunning: boolean;
	restSeedSec: number;
	restForSet: { ex: number; set: number } | null;
	restStartedAtMs: number;
	restAccumSec: number;
}

/** The numeric fields "apply to the rest of this exercise" can spread. REPS are
 *  deliberately absent: reps are what you actually managed on the day, and the
 *  plan already prefills them — spreading one set's outcome over the rest would
 *  overwrite the target, not fill it in. Weight and the two time metrics are the
 *  ones that genuinely repeat across a working set. */
export type SpreadField = 'weight' | 'durationSec' | 'timeSec';

/** Outcome of a start attempt. A live workout is never overwritten — the caller
 *  decides what to offer (resume it, or cancel() then start again). */
export type StartResult =
	| { ok: true; skippedExerciseIds: string[] }
	| { ok: false; reason: 'in-progress' | 'missing-template' };

/** Outcome of finish(). `nothing-logged` does NOT discard: cancel() wipes the
 *  resume snapshot and the session note, so the caller has to confirm first. */
export type FinishResult = { status: 'saved'; id: string } | { status: 'nothing-logged' } | { status: 'empty' };

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
						meta: $state.snapshot(this.meta) as Exercise[],
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

	async startFromTemplate(templateId: string, applySuggestions = false): Promise<StartResult> {
		// Never overwrite a live workout — same guard restore() has always had. The
		// caller decides what to offer instead (resume, or cancel() then start).
		if (this.session) return { ok: false, reason: 'in-progress' };
		const repo = getRepository();
		await settings.load();
		const [tpl, exAll] = await Promise.all([repo.getTemplate(templateId), repo.listExercises()]);
		if (!tpl) return { ok: false, reason: 'missing-template' };
		const byId = new Map(exAll.map((e) => [e.id, e]));

		const meta: Exercise[] = [];
		const plannedRest: number[][] = [];
		const exercises: LoggedExercise[] = [];
		// A template can outlive an exercise it references (an interrupted sync pushes
		// templates and exercises independently). Skip the orphan rather than asserting
		// on it — every other consumer optional-chains, and a throw here reached the
		// user as a Start button that silently did nothing.
		const skippedExerciseIds: string[] = [];
		for (const tex of tpl.exercises) {
			const ex = byId.get(tex.exerciseId);
			if (!ex) {
				skippedExerciseIds.push(tex.exerciseId);
				continue;
			}
			meta.push(ex);
			plannedRest.push(
				tex.plannedSets.map((ps) => ps.targetRestSec ?? ex.defaultRestSec ?? settings.current.defaultRestSec)
			);
			exercises.push({
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
					distanceMeters: ps.targetDistanceMeters,
					perSide: ex.loadType === 'per_side' ? true : undefined
				}))
			});
		}

		// "Last time" history and the suggested next step come from the same object,
		// but only the STEP is the auto-progression feature — read history either way
		// so turning the setting off doesn't also blank the last-session readout.
		const sugg: Record<string, Suggestion | null> = {};
		if (settings.current.autoProgression) await recovery.refresh(); // suggestions must see today's band, not last view's
		for (const ex of meta) {
			const last = await repo.lastSessionForExercise(ex.id);
			sugg[ex.id] = computeSuggestion(ex, last, { readiness: recovery.current?.band });
		}

		if (applySuggestions && settings.current.autoProgression) {
			exercises.forEach((le) => {
				const sg = sugg[le.exerciseId];
				if (!sg) return;
				le.sets.forEach((set) => {
					if (sg.nextWeight != null) set.weight = sg.nextWeight;
					if (sg.nextReps != null) set.reps = sg.nextReps;
					if (sg.nextDurationSec != null) set.durationSec = sg.nextDurationSec;
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
		return { ok: true, skippedExerciseIds };
	}

	async startAdhoc(): Promise<StartResult> {
		if (this.session) return { ok: false, reason: 'in-progress' };
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
		// A quick log has no template read to hide a settings load behind, so it happens
		// here — otherwise the workout screen paints against DEFAULT_SETTINGS (no RPE
		// column, stock default rest) until something else loads them. Deliberately
		// AFTER the session exists, so the workout is live the moment this is called
		// and only the navigation waits on the read — and a failed read must not strand
		// the caller on its loading screen, since the defaults are perfectly usable.
		try {
			await settings.load();
		} catch {
			/* keep DEFAULT_SETTINGS — the workout is already live */
		}
		return { ok: true, skippedExerciseIds: [] };
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
		this.meta = snap.meta ?? []; // pre-meta snapshots restore empty; hydrateMeta fills them in
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
		// A cold relaunch never fires visibilitychange either (nothing transitioned FROM
		// hidden in this process), so the two things that handler does on the way back in
		// have to happen here too: drop the OS "rest complete" notification, because the
		// in-app banner + haptic own the cue while we're in the foreground…
		cancelRestEndAlert();
		// …and reconcile a pending Live Activity adjustment BEFORE the Activity is
		// re-synced to our state.
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
		// Keep whatever the resume snapshot already gave us for an exercise the catalog
		// no longer has (tombstoned mid-workout): a hole here means permanently wrong
		// columns and a blank name for the rest of the session.
		this.meta = s.exercises.map((le, i) => byId.get(le.exerciseId) ?? this.meta[i]);
		const sugg: Record<string, Suggestion | null> = {};
		if (settings.current.autoProgression) await recovery.refresh(); // suggestions must see today's band, not last view's
		for (const le of s.exercises) {
			const ex = byId.get(le.exerciseId);
			if (!ex) continue;
			const last = await repo.lastSessionForExercise(ex.id);
			sugg[ex.id] = computeSuggestion(ex, last, { readiness: recovery.current?.band });
		}
		this.suggestions = sugg;
		// meta may have arrived after restore()'s restLiveSync ran against an empty
		// array — re-sync so the Lock Screen / Island shows the exercise name, not "Rest".
		this.restLiveSync();
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
		// Same one-liner swapExercise ends with: an exercise added mid-session has a
		// history too, and without this a quick log shows no "last time" anchor at all
		// (until an app relaunch, where hydrateMeta populates it — an odd inconsistency).
		void this.hydrateSuggestionFor(ex);
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

	/** Fetch the last-time readout + suggestion for one exercise — used after a swap
	 *  or an add. Not gated on autoProgression: the setting governs the suggested
	 *  STEP, which the screen hides on its own; the history readout is always wanted. */
	private async hydrateSuggestionFor(ex: Exercise) {
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
			// If we were resting "for" this set, stop the timer — otherwise the active
			// pointer goes stale and the next completed set's rest gets attributed to
			// this now-incomplete set and then dropped at finish().
			if (this.restForSet && this.restForSet.ex === exIndex && this.restForSet.set === setIndex) {
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
		const seed = this.plannedRest[exIndex]?.[setIndex] ?? settings.current.defaultRestSec;
		if (seed <= 0) {
			// A seed of 0 means "no rest for this set" — the seeded cardio machines ship
			// that way, and blanking a Rest cell produces it too. Arming the timer anyway
			// put a red "rest overage" banner and a heavy haptic on screen one second
			// after every treadmill set, so treat it as no rest at all.
			cancelRestEndAlert();
			this.restRunning = false;
			this.restAccumSec = 0;
			this.restStartedAtMs = 0;
			this.restSeedSec = 0;
			this.restForSet = null;
			this.restHapticFired = false;
			this.nowMs = Date.now();
			this.setActiveToFirstIncomplete();
			this.restLiveSync();
			return;
		}
		this.restSeedSec = seed;
		this.restForSet = { ex: exIndex, set: setIndex };
		this.restStartedAtMs = Date.now();
		this.restAccumSec = 0;
		this.restRunning = true;
		this.restHapticFired = false;
		this.nowMs = Date.now();
		this.setActiveToFirstIncomplete();
		this.restLiveSync();
	}

	/** Carry an edited weight down to the LATER planned sets of the same exercise that
	 *  still hold the value it replaced. `previous` is what the cell held before the
	 *  edit (captured on focus), which is what keeps a deliberate pyramid or drop set
	 *  intact — only sets that agreed with the old number follow the new one. */
	propagateWeight(exIndex: number, setIndex: number, previous: number | undefined) {
		const le = this.session?.exercises[exIndex];
		const edited = le?.sets[setIndex];
		if (!le || !edited || edited.weight == null || edited.weight === previous) return;
		for (let i = setIndex + 1; i < le.sets.length; i++) {
			const s = le.sets[i];
			if (s.completed) continue; // already logged — its number is a record, not a plan
			if (s.weight === previous) s.weight = edited.weight;
		}
	}

	/** Sets of the same exercise that "apply to the rest" would actually change:
	 *  not the source, not completed, and not already holding the value. Zero means
	 *  the affordance has nothing to do and must not be offered — which is the
	 *  common case, because propagateWeight above has usually already carried it. */
	private spreadTargets(exIndex: number, setIndex: number, field: SpreadField): LoggedSet[] {
		const le = this.session?.exercises[exIndex];
		const src = le?.sets[setIndex];
		if (!le || !src) return [];
		const value = src[field];
		if (value == null) return [];
		return le.sets.filter((s, i) => i !== setIndex && !s.completed && s[field] !== value);
	}

	/** How many sets the value would reach — drives the label, so the user sees the
	 *  blast radius before tapping. */
	spreadCount(exIndex: number, setIndex: number, field: SpreadField): number {
		return this.spreadTargets(exIndex, setIndex, field).length;
	}

	/** Copy one set's weight/hold/time onto every UNLOGGED set of the same exercise.
	 *  Deliberately different from propagateWeight: that one only follows sets that
	 *  still agreed with the old value (so a pyramid survives an edit) and runs
	 *  automatically. This is the user explicitly asking for one number everywhere,
	 *  so it overwrites whatever the other sets hold.
	 *
	 *  A COMPLETED set is never touched. Its numbers are a record of what was
	 *  actually lifted, not a plan — rewriting them would falsify history, and the
	 *  volume/PR math downstream reads exactly these values. Returns how many sets
	 *  changed. */
	applyToUnlogged(exIndex: number, setIndex: number, field: SpreadField): number {
		const targets = this.spreadTargets(exIndex, setIndex, field);
		const value = this.session?.exercises[exIndex]?.sets[setIndex]?.[field];
		if (value == null) return 0;
		for (const s of targets) s[field] = value;
		return targets.length;
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
	/** Change the planned rest (timer seed) for an upcoming set. 0 is kept as an
	 *  explicit "no rest" (blank the cell to get it; toggleSet then starts no timer);
	 *  anything else floors at 5s like adjustRest, so a 1-second countdown can't be
	 *  typed in by accident. */
	setPlannedRest(exIndex: number, setIndex: number, sec: number) {
		const row = this.plannedRest[exIndex];
		if (!row || setIndex >= row.length) return;
		const v = Math.round(sec || 0);
		row[setIndex] = v > 0 ? Math.max(5, v) : 0;
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
			// Stamp the rest that had elapsed AT THE TAP (adj.endTimeMs recorded by the
			// Skip intent), not at reconcile time — skipRest() reads the live wall-clock
			// elapsed, which includes every minute the app stayed backgrounded after the
			// tap and inflates the previous set's recorded rest.
			const prev = this.session?.exercises[this.restForSet.ex]?.sets[this.restForSet.set];
			if (prev) {
				const elapsedAtTap = this.restAccumSec + Math.max(0, (adj.endTimeMs - this.restStartedAtMs) / 1000);
				prev.restTakenSec = Math.max(0, Math.round(elapsedAtTap));
			}
			cancelRestEndAlert();
			this.restRunning = false;
			this.restAccumSec = 0;
			this.restStartedAtMs = 0;
			this.restSeedSec = 0;
			this.restForSet = null;
			this.restHapticFired = false;
			this.restLiveSync();
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

	async finish(): Promise<FinishResult> {
		const s = this.session;
		if (!s) return { status: 'empty' };
		// Build the finished record on a SNAPSHOT — never mutate the live $state session
		// before the await. If upsert throws (storage full / WebKit eviction), the
		// in-progress workout and its localStorage resume snapshot must stay intact and
		// resumable rather than being left pruned and misaligned with meta/plannedRest.
		const out = $state.snapshot(s) as WorkoutSession;
		// read before the prune below: what we need to know is whether there was ever
		// anything in this workout, not what survived the completed-only filter
		const hadExercises = s.exercises.length > 0;
		// fold the final running rest into its set
		if (this.restForSet) {
			const prev = out.exercises[this.restForSet.ex]?.sets[this.restForSet.set];
			if (prev) prev.restTakenSec = Math.max(0, Math.round(this.restElapsedSec));
		}
		out.endedAt = new Date().toISOString();
		// keep only completed sets (drop prefilled-but-unchecked ones), then drop empty exercises
		out.exercises = out.exercises
			.map((e) => ({ ...e, sets: e.sets.filter((x) => x.completed) }))
			.filter((e) => e.sets.length > 0);
		if (out.exercises.length === 0) {
			// Nothing logged — don't save an empty session. But don't discard one either:
			// cancel() also wipes the session note and the resume snapshot, and Finish
			// used to do that silently. An empty shell (a quick log nothing was ever
			// added to) has nothing to lose, so it still goes quietly; anything with
			// exercises in it comes back for the caller to confirm.
			if (!hadExercises) {
				this.cancel();
				return { status: 'empty' };
			}
			return { status: 'nothing-logged' };
		}
		await getRepository().upsertSession(out);
		const id = out.id;
		this.cancel();
		return { status: 'saved', id };
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
