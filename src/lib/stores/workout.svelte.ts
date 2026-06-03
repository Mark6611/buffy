// Active-workout state machine: drives the live screen.
// Logging is linear (exercise by exercise); superset groups render together but
// log in order — full round-cycling is a planned refinement (the data model
// already carries groupId so it can layer on without schema change).
import { getRepository } from '$lib/db';
import type { Exercise, LoggedExercise, LoggedSet, WorkoutSession } from '$lib/types';
import { settings } from './settings.svelte';
import { computeSuggestion, type Suggestion } from '$lib/progression';
import { haptic } from '$lib/native';

function newId(): string {
	return crypto.randomUUID();
}

class WorkoutStore {
	session = $state<WorkoutSession | null>(null);
	meta = $state<Exercise[]>([]); // parallel to session.exercises
	plannedRest = $state<number[][]>([]); // seed seconds per [ex][set]
	suggestions = $state<Record<string, Suggestion | null>>({});

	activeEx = $state(0);
	activeSet = $state(0);

	// rest timer
	restRunning = $state(false);
	restSeedSec = $state(0);
	restElapsedSec = $state(0);
	restForSet = $state<{ ex: number; set: number } | null>(null);

	nowMs = $state(Date.now());
	private interval: ReturnType<typeof setInterval> | null = null;

	get active(): boolean {
		return this.session !== null;
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
			if (this.restRunning) {
				const wasOver = this.restElapsedSec >= this.restSeedSec;
				this.restElapsedSec += 1;
				if (!wasOver && this.restElapsedSec >= this.restSeedSec && settings.current.hapticAtRestEnd) {
					haptic('heavy'); // rest hit zero — native buzz on iOS; on-screen cue everywhere
				}
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
			for (const ex of meta) {
				const last = await repo.lastSessionForExercise(ex.id);
				sugg[ex.id] = computeSuggestion(ex, last);
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
	}

	removeSet(exIndex: number) {
		const le = this.session?.exercises[exIndex];
		if (le && le.sets.length > 1) {
			le.sets.pop();
			this.plannedRest[exIndex]?.pop();
		}
	}

	toggleSet(exIndex: number, setIndex: number) {
		const set = this.session?.exercises[exIndex]?.sets[setIndex];
		if (!set) return;
		if (set.completed) {
			set.completed = false;
			return;
		}
		set.completed = true;
		// assign elapsed rest to whichever set we were resting on
		if (this.restForSet) {
			const prev = this.session!.exercises[this.restForSet.ex]?.sets[this.restForSet.set];
			if (prev) prev.restTakenSec = Math.max(0, Math.round(this.restElapsedSec));
		}
		// start resting for this set
		this.restSeedSec = this.plannedRest[exIndex]?.[setIndex] ?? settings.current.defaultRestSec;
		this.restElapsedSec = 0;
		this.restRunning = true;
		this.restForSet = { ex: exIndex, set: setIndex };
		this.setActiveToFirstIncomplete();
	}

	adjustRest(delta: number) {
		this.restSeedSec = Math.max(5, this.restSeedSec + delta);
	}
	togglePause() {
		this.restRunning = !this.restRunning;
	}
	skipRest() {
		if (this.restForSet) {
			const prev = this.session?.exercises[this.restForSet.ex]?.sets[this.restForSet.set];
			if (prev) prev.restTakenSec = Math.max(0, Math.round(this.restElapsedSec));
		}
		this.restRunning = false;
		this.restElapsedSec = 0;
		this.restSeedSec = 0;
		this.restForSet = null;
	}

	private resetTimerState() {
		this.restRunning = false;
		this.restElapsedSec = 0;
		this.restSeedSec = 0;
		this.restForSet = null;
		this.activeEx = 0;
		this.activeSet = 0;
	}

	private setActiveToFirstIncomplete() {
		const s = this.session;
		if (!s) return;
		for (let e = 0; e < s.exercises.length; e++) {
			const idx = s.exercises[e].sets.findIndex((x) => !x.completed);
			if (idx !== -1) {
				this.activeEx = e;
				this.activeSet = idx;
				return;
			}
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
		this.session = null;
		this.meta = [];
		this.plannedRest = [];
		this.suggestions = {};
		this.resetTimerState();
	}
}

export const workout = new WorkoutStore();
