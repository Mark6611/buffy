// Workout store: wall-clock rest timer + persist/restore resume semantics.
// The timers must survive app backgrounding (iOS freezes JS timers) and full
// restarts (WebView purge) — these tests simulate both by jumping the system
// clock without ticking intervals, exactly what suspension looks like to JS.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Exercise, Template, WorkoutSession } from '$lib/types';

const h = vi.hoisted(() => {
	const upserted: unknown[] = [];
	const exercises: Exercise[] = [];
	const template: { value: unknown } = { value: undefined };
	const lastSession: { value: unknown } = { value: undefined };
	const upsertError: { value: Error | null } = { value: null };
	const calls = { cancelRestEndAlert: 0 };
	const pendingAdjustment: { value: { endTimeMs: number; skipped: boolean } | null } = { value: null };
	return {
		upserted,
		exercises,
		template,
		lastSession,
		upsertError,
		calls,
		pendingAdjustment,
		repo: {
			listExercises: async () => exercises,
			lastSessionForExercise: async () => lastSession.value,
			getTemplate: async () => template.value,
			upsertSession: async (s: unknown) => {
				if (upsertError.value) throw upsertError.value;
				upserted.push(s);
			}
		},
		settings: {
			current: { defaultRestSec: 90, hapticAtRestEnd: false, autoProgression: false },
			load: async () => {}
		}
	};
});
vi.mock('$lib/db', () => ({ getRepository: () => h.repo, ensureSeeded: async () => {} }));
vi.mock('$lib/stores/settings.svelte', () => ({ settings: h.settings }));
vi.mock('$lib/native', () => ({
	haptic: async () => {},
	isNative: false,
	keepAwake: async () => {},
	allowSleep: async () => {},
	reacquireWakeLock: async () => {},
	scheduleRestEndAlert: async () => {},
	cancelRestEndAlert: async () => {
		h.calls.cancelRestEndAlert++;
	},
	startRestLiveActivity: async () => {},
	endRestLiveActivity: async () => {},
	readPendingRestAdjustment: async () => {
		const v = h.pendingAdjustment.value;
		h.pendingAdjustment.value = null; // consumed, same contract as the native side
		return v;
	}
}));

import { workout } from '$lib/stores/workout.svelte';

const RESUME_KEY = 'buffy:activeWorkout';
const BASE = new Date('2026-06-12T10:00:00Z').getTime();

const press: Exercise = {
	id: 'press',
	name: 'Dumbbell Shoulder Press',
	equipment: 'dumbbell',
	primaryMuscles: ['Shoulders'],
	secondaryMuscles: [],
	trackingType: 'weight_reps',
	loadType: 'per_side',
	defaultTargetReps: 10,
	weightStep: 1,
	defaultRestSec: 60
};

let backing: Map<string, string>;

/** Advance the wall clock with NO interval ticks — what iOS suspension looks
 *  like to JS — then sync nowMs the way the visibilitychange handler does. */
function jumpClock(sec: number) {
	vi.setSystemTime(Date.now() + sec * 1000);
	workout.nowMs = Date.now();
}

/** Flush the microtask chain of restore()'s async hydrateMeta. */
async function flush() {
	for (let i = 0; i < 6; i++) await Promise.resolve();
}

function resumeSnapshot(over: Record<string, unknown> = {}) {
	const session: WorkoutSession = {
		id: 'sess-1',
		startedAt: new Date(BASE - 10 * 60 * 1000).toISOString(), // started 10 min ago
		sourceTemplateId: 'shoulder-core',
		title: 'Shoulder Core',
		exercises: [
			{
				exerciseId: 'press',
				groupId: null,
				sets: [
					{ index: 0, completed: true, reps: 10, weight: 12, perSide: true },
					{ index: 1, completed: false, reps: 10, weight: 12, perSide: true }
				]
			}
		]
	};
	return {
		session,
		plannedRest: [[60, 60]],
		activeEx: 0,
		activeSet: 1,
		restRunning: true,
		restSeedSec: 60,
		restForSet: { ex: 0, set: 0 },
		restStartedAtMs: BASE - 90 * 1000, // rest began 90s ago
		restAccumSec: 0,
		...over
	};
}

beforeEach(() => {
	vi.useFakeTimers({ now: BASE });
	backing = new Map();
	globalThis.localStorage = {
		getItem: (k: string) => backing.get(k) ?? null,
		setItem: (k: string, v: string) => void backing.set(k, String(v)),
		removeItem: (k: string) => void backing.delete(k),
		clear: () => backing.clear(),
		key: (i: number) => [...backing.keys()][i] ?? null,
		get length() {
			return backing.size;
		}
	} as Storage;
	h.exercises.length = 0;
	h.exercises.push(press);
	h.upserted.length = 0;
	h.template.value = undefined;
	h.lastSession.value = undefined;
	h.upsertError.value = null;
	h.calls.cancelRestEndAlert = 0;
	h.pendingAdjustment.value = null;
});

afterEach(() => {
	workout.cancel();
	vi.useRealTimers();
});

describe('rest timer — wall-clock derived', () => {
	it('counts down from the exercise rest seed', () => {
		workout.startAdhoc();
		workout.addExercise(press);
		workout.toggleSet(0, 0);
		expect(workout.restRunning).toBe(true);
		expect(workout.restSeedSec).toBe(60);
		jumpClock(25);
		expect(workout.restElapsedSec).toBeCloseTo(25, 0);
		expect(workout.restRemaining).toBeCloseTo(35, 0);
		expect(workout.restOver).toBe(false);
	});

	it('keeps counting through a background freeze (no ticks)', () => {
		workout.startAdhoc();
		workout.addExercise(press);
		workout.toggleSet(0, 0);
		// app backgrounded for 145s: zero interval ticks, only the clock moves
		jumpClock(145);
		expect(workout.restElapsedSec).toBeCloseTo(145, 0);
		expect(workout.restOver).toBe(true);
		// session clock also tracked the gap
		expect(workout.elapsedSec).toBeCloseTo(145, 0);
	});

	it('pause banks elapsed; time while paused does not count', () => {
		workout.startAdhoc();
		workout.addExercise(press);
		workout.toggleSet(0, 0);
		jumpClock(20);
		workout.togglePause(); // bank 20s
		jumpClock(300); // five minutes paused — must not count
		expect(workout.restElapsedSec).toBeCloseTo(20, 0);
		workout.togglePause(); // resume
		jumpClock(10);
		expect(workout.restElapsedSec).toBeCloseTo(30, 0);
	});

	it('adjustRest floors the seed at 5s', () => {
		workout.startAdhoc();
		workout.addExercise(press);
		workout.toggleSet(0, 0);
		workout.adjustRest(-500);
		expect(workout.restSeedSec).toBe(5);
	});

	it('finish folds the running rest into the set and keeps only completed sets', async () => {
		workout.startAdhoc();
		workout.addExercise(press); // 3 prefilled sets
		workout.toggleSet(0, 0);
		jumpClock(30);
		const res = await workout.finish();
		expect(res.status).toBe('saved');
		const saved = h.upserted[0] as WorkoutSession;
		expect(saved.exercises).toHaveLength(1);
		expect(saved.exercises[0].sets).toHaveLength(1); // 2 unchecked sets dropped
		expect(saved.exercises[0].sets[0].restTakenSec).toBe(30);
		expect(backing.has(RESUME_KEY)).toBe(false); // resume state cleared
	});
});

describe('restore — resume after app restart', () => {
	it('restores the session and the rest timer keeps real elapsed time', async () => {
		backing.set(RESUME_KEY, JSON.stringify(resumeSnapshot()));
		workout.restore();
		expect(workout.active).toBe(true);
		expect(workout.session?.id).toBe('sess-1');
		expect(workout.session?.exercises[0].sets[0].completed).toBe(true);
		// rest began 90s ago against a 60s seed → 30s over, still running
		expect(workout.restRunning).toBe(true);
		expect(workout.restElapsedSec).toBeCloseTo(90, 0);
		expect(workout.restOver).toBe(true);
		// session clock reflects the original start, not the restore moment
		expect(workout.elapsedSec).toBeCloseTo(600, 0);
		await flush(); // exercise metadata re-hydrates async
		expect(workout.meta[0]?.name).toBe('Dumbbell Shoulder Press');
	});

	it('drops a rest left running for over an hour as stale', () => {
		backing.set(
			RESUME_KEY,
			JSON.stringify(resumeSnapshot({ restStartedAtMs: BASE - 2 * 3600 * 1000 }))
		);
		workout.restore();
		expect(workout.active).toBe(true); // workout survives
		expect(workout.restForSet).toBeNull(); // stale rest dropped
		expect(workout.restRunning).toBe(false);
	});

	it('does nothing without a snapshot, and never clobbers a live session', () => {
		workout.restore();
		expect(workout.active).toBe(false);
		workout.startAdhoc();
		const id = workout.session?.id;
		backing.set(RESUME_KEY, JSON.stringify(resumeSnapshot()));
		workout.restore(); // must not replace the live session
		expect(workout.session?.id).toBe(id);
	});

	it('cancel clears the persisted resume state', () => {
		backing.set(RESUME_KEY, JSON.stringify(resumeSnapshot()));
		workout.restore();
		expect(workout.active).toBe(true);
		workout.cancel();
		expect(workout.active).toBe(false);
		expect(backing.has(RESUME_KEY)).toBe(false);
	});
});

describe('superset round-cycling', () => {
	it('cycles A1→B1→A2→B2 within a group, timer running after every set', () => {
		const session: WorkoutSession = {
			id: 'ss',
			startedAt: new Date(BASE).toISOString(),
			sourceTemplateId: 't',
			title: 'SS',
			exercises: [
				{ exerciseId: 'a', groupId: 'g', sets: [{ index: 0, completed: false }, { index: 1, completed: false }] },
				{ exerciseId: 'b', groupId: 'g', sets: [{ index: 0, completed: false }, { index: 1, completed: false }] }
			]
		};
		backing.set(
			RESUME_KEY,
			JSON.stringify({
				session,
				plannedRest: [[60, 60], [60, 60]],
				activeEx: 0,
				activeSet: 0,
				restRunning: false,
				restSeedSec: 0,
				restForSet: null,
				restStartedAtMs: 0,
				restAccumSec: 0
			})
		);
		workout.restore();
		expect([workout.activeEx, workout.activeSet]).toEqual([0, 0]); // A1
		workout.toggleSet(0, 0);
		expect([workout.activeEx, workout.activeSet]).toEqual([1, 0]); // → B1
		expect(workout.restForSet).toEqual({ ex: 0, set: 0 }); // timer runs even mid-round
		workout.toggleSet(1, 0);
		expect([workout.activeEx, workout.activeSet]).toEqual([0, 1]); // → A2
		expect(workout.restForSet).toEqual({ ex: 1, set: 0 });
		workout.toggleSet(0, 1);
		expect([workout.activeEx, workout.activeSet]).toEqual([1, 1]); // → B2
		expect(workout.restForSet).toEqual({ ex: 0, set: 1 });
	});

	it('non-grouped exercises stay linear', () => {
		workout.startAdhoc();
		workout.addExercise(press); // groupId null
		workout.toggleSet(0, 0);
		expect([workout.activeEx, workout.activeSet]).toEqual([0, 1]); // next set, same exercise
		expect(workout.restForSet).toEqual({ ex: 0, set: 0 });
	});
});

describe('interactive Live Activity reconciliation', () => {
	it('applies a pending +30s adjustment made from the Dynamic Island on resume', async () => {
		// rest began 30s ago against a 60s seed → 30s left; the Island's +30 button
		// extended it to end 60s from BASE (i.e. 60s remaining from "now")
		const endTimeMs = BASE + 60_000;
		h.pendingAdjustment.value = { endTimeMs, skipped: false };
		backing.set(RESUME_KEY, JSON.stringify(resumeSnapshot({ restStartedAtMs: BASE - 30_000 })));
		workout.restore();
		await flush();
		expect(workout.restForSet).not.toBeNull();
		expect(workout.restRemaining).toBeCloseTo(60, 0);
	});

	it('applies a pending skip made from the Dynamic Island on resume', async () => {
		h.pendingAdjustment.value = { endTimeMs: BASE, skipped: true };
		backing.set(RESUME_KEY, JSON.stringify(resumeSnapshot({ restStartedAtMs: BASE - 30_000 })));
		workout.restore();
		await flush();
		expect(workout.restForSet).toBeNull();
		expect(workout.restRunning).toBe(false);
	});

	it('is a no-op with nothing pending', async () => {
		backing.set(RESUME_KEY, JSON.stringify(resumeSnapshot({ restStartedAtMs: BASE - 30_000, restSeedSec: 60 })));
		workout.restore();
		await flush();
		expect(workout.restForSet).toEqual({ ex: 0, set: 0 });
		expect(workout.restRemaining).toBeCloseTo(30, 0);
	});
});

const row: Exercise = {
	id: 'row',
	name: 'Cable Row',
	equipment: 'cable',
	primaryMuscles: ['Back'],
	secondaryMuscles: [],
	trackingType: 'weight_reps',
	loadType: 'total',
	defaultTargetReps: 10,
	weightStep: 2.5,
	defaultRestSec: 60
};

const curl: Exercise = {
	id: 'curl',
	name: 'Dumbbell Bicep Curl',
	equipment: 'dumbbell',
	primaryMuscles: ['Biceps'],
	secondaryMuscles: [],
	trackingType: 'weight_reps',
	loadType: 'per_side',
	defaultTargetReps: 12,
	weightStep: 1,
	defaultRestSec: 45
};

describe('removeExercise', () => {
	it('drops the exercise and its meta/rest rows together', () => {
		workout.startAdhoc();
		workout.addExercise(press);
		workout.addExercise(curl);
		workout.removeExercise(0);
		expect(workout.session?.exercises).toHaveLength(1);
		expect(workout.session?.exercises[0].exerciseId).toBe('curl');
		expect(workout.meta.map((e) => e.id)).toEqual(['curl']);
		expect(workout.plannedRest).toHaveLength(1);
	});

	it('clears the rest timer when the exercise currently being rested for is removed', () => {
		workout.startAdhoc();
		workout.addExercise(press);
		workout.toggleSet(0, 0); // starts a rest against exercise 0
		expect(workout.restForSet).toEqual({ ex: 0, set: 0 });
		workout.removeExercise(0);
		expect(workout.restForSet).toBeNull();
		expect(workout.restRunning).toBe(false);
		expect(workout.session?.exercises).toHaveLength(0);
	});

	it('shifts restForSet.ex down when an earlier exercise is removed', () => {
		workout.startAdhoc();
		workout.addExercise(press); // ex 0
		workout.addExercise(curl); // ex 1
		workout.toggleSet(1, 0); // rest against exercise 1 (curl)
		expect(workout.restForSet).toEqual({ ex: 1, set: 0 });
		workout.removeExercise(0); // remove press — curl shifts to index 0
		expect(workout.restForSet).toEqual({ ex: 0, set: 0 });
		expect(workout.restRunning).toBe(true);
		expect(workout.session?.exercises[0].exerciseId).toBe('curl');
	});

	it('leaves an unrelated running rest untouched when a later exercise is removed', () => {
		workout.startAdhoc();
		workout.addExercise(press); // ex 0
		workout.addExercise(curl); // ex 1
		workout.toggleSet(0, 0); // rest against exercise 0
		workout.removeExercise(1); // remove curl — press keeps index 0
		expect(workout.restForSet).toEqual({ ex: 0, set: 0 });
		expect(workout.restRunning).toBe(true);
	});

	it('is a no-op past the end of the exercise list', () => {
		workout.startAdhoc();
		workout.addExercise(press);
		workout.removeExercise(5);
		expect(workout.session?.exercises).toHaveLength(1);
	});

	it('clamps activeEx when the last exercise is removed with every set complete', () => {
		workout.startAdhoc();
		workout.addExercise(press); // ex 0, 3 sets
		workout.addExercise(curl); // ex 1, 3 sets
		for (let e = 0; e < 2; e++) for (let s = 0; s < 3; s++) workout.toggleSet(e, s);
		expect(workout.activeEx).toBe(1); // nothing incomplete — active stays on the last set
		workout.removeExercise(1);
		expect(workout.session?.exercises).toHaveLength(1);
		expect(workout.activeEx).toBe(0); // in range, not "2/1"
		expect(workout.activeSet).toBe(0);
	});
});

describe('swapExercise', () => {
	it('replaces the exercise with a fresh set list at the new exercise defaults', () => {
		workout.startAdhoc();
		workout.addExercise(press); // 3 sets, press defaults
		workout.toggleSet(0, 0); // log one set of press
		workout.swapExercise(0, curl);
		const le = workout.session?.exercises[0];
		expect(le?.exerciseId).toBe('curl');
		expect(le?.sets).toHaveLength(3); // same set count as what it replaced
		expect(le?.sets.every((s) => !s.completed)).toBe(true); // nothing carries over as "done"
		expect(le?.sets[0].reps).toBe(curl.defaultTargetReps);
		expect(workout.meta[0]).toBe(curl);
		expect(workout.plannedRest[0]).toEqual([curl.defaultRestSec, curl.defaultRestSec, curl.defaultRestSec]);
	});

	it('preserves the set count of the exercise it replaces', () => {
		workout.startAdhoc();
		workout.addExercise(press);
		workout.addSet(0);
		workout.addSet(0); // now 5 sets
		workout.swapExercise(0, curl);
		expect(workout.session?.exercises[0].sets).toHaveLength(5);
	});

	it('clears an in-progress rest for the exercise being swapped', () => {
		workout.startAdhoc();
		workout.addExercise(press);
		workout.toggleSet(0, 0); // starts a rest against exercise 0
		expect(workout.restForSet).toEqual({ ex: 0, set: 0 });
		workout.swapExercise(0, curl);
		expect(workout.restForSet).toBeNull();
		expect(workout.restRunning).toBe(false);
	});

	it('drops the stale suggestion for the exerciseId that was swapped out', () => {
		workout.startAdhoc();
		workout.addExercise(press);
		workout.suggestions['press'] = null; // simulate a previously-loaded suggestion
		workout.swapExercise(0, curl);
		expect('press' in workout.suggestions).toBe(false);
	});

	it('is a no-op past the end of the exercise list', () => {
		workout.startAdhoc();
		workout.addExercise(press);
		workout.swapExercise(5, curl);
		expect(workout.session?.exercises[0].exerciseId).toBe('press');
	});
});

describe('addSet / removeSetAt', () => {
	it('removeSetAt drops the set and its planned rest, and reindexes the rest', () => {
		workout.startAdhoc();
		workout.addExercise(press);
		const n = workout.session!.exercises[0].sets.length;
		workout.removeSetAt(0, 0);
		const sets = workout.session!.exercises[0].sets;
		expect(sets).toHaveLength(n - 1);
		expect(sets.map((x) => x.index)).toEqual(sets.map((_, i) => i));
		expect(workout.plannedRest[0]).toHaveLength(n - 1);
	});

	it('clears the rest timer when the set being rested after is removed', () => {
		workout.startAdhoc();
		workout.addExercise(press);
		workout.toggleSet(0, 0); // rest now runs against set 0
		expect(workout.restForSet).toEqual({ ex: 0, set: 0 });
		workout.removeSetAt(0, 0);
		expect(workout.restForSet).toBeNull();
		expect(workout.restRunning).toBe(false);
	});

	it('shifts restForSet.set down when an earlier set is removed', () => {
		workout.startAdhoc();
		workout.addExercise(press);
		workout.toggleSet(0, 0);
		workout.toggleSet(0, 1); // rest moves to set 1
		expect(workout.restForSet).toEqual({ ex: 0, set: 1 });
		workout.removeSetAt(0, 0); // remove set 0 — rested set shifts to index 0
		expect(workout.restForSet).toEqual({ ex: 0, set: 0 });
		expect(workout.restRunning).toBe(true);
	});

	it('never removes the last remaining set', () => {
		workout.startAdhoc();
		workout.addExercise(press);
		const n = workout.session!.exercises[0].sets.length;
		for (let i = 0; i < n; i++) workout.removeSetAt(0, 0);
		expect(workout.session!.exercises[0].sets).toHaveLength(1);
	});

	it('addSet copies the last set values and becomes the next target when all were complete', () => {
		workout.startAdhoc();
		workout.addExercise(press);
		const le = workout.session!.exercises[0];
		le.sets.forEach((_, i) => workout.toggleSet(0, i));
		const before = le.sets.length;
		le.sets[before - 1].weight = 42.5;
		workout.addSet(0);
		expect(le.sets).toHaveLength(before + 1);
		expect(le.sets[before].weight).toBe(42.5);
		expect(le.sets[before].completed).toBe(false);
		expect(workout.plannedRest[0]).toHaveLength(before + 1);
		expect(workout.activeEx).toBe(0);
		expect(workout.activeSet).toBe(before);
	});
});

describe('moveExercise', () => {
	it('swaps a standalone exercise with its neighbor (both directions, arrays in lockstep)', () => {
		workout.startAdhoc();
		workout.addExercise(press); // 0
		workout.addExercise(curl); // 1
		workout.moveExercise(0, 1);
		expect(workout.session!.exercises.map((e) => e.exerciseId)).toEqual(['curl', 'press']);
		expect(workout.meta.map((e) => e.id)).toEqual(['curl', 'press']);
		workout.moveExercise(1, -1);
		expect(workout.session!.exercises.map((e) => e.exerciseId)).toEqual(['press', 'curl']);
	});

	it('is a no-op at the boundaries', () => {
		workout.startAdhoc();
		workout.addExercise(press);
		workout.addExercise(curl);
		workout.moveExercise(0, -1);
		workout.moveExercise(1, 1);
		expect(workout.session!.exercises.map((e) => e.exerciseId)).toEqual(['press', 'curl']);
	});

	it('keeps the rest pointer on the same set through a move', () => {
		workout.startAdhoc();
		workout.addExercise(press); // 0
		workout.addExercise(curl); // 1
		workout.toggleSet(0, 0); // rest against press set 0
		expect(workout.restForSet).toEqual({ ex: 0, set: 0 });
		workout.moveExercise(0, 1); // press moves to index 1
		expect(workout.restForSet).toEqual({ ex: 1, set: 0 });
		expect(workout.session!.exercises[1].exerciseId).toBe('press');
		expect(workout.restRunning).toBe(true);
	});

	it('moves a superset block as a unit and jumps a standalone neighbor over it', () => {
		workout.startAdhoc();
		workout.addExercise(press); // 0 standalone
		workout.addExercise(curl); // 1
		workout.addExercise(row); // 2
		// group curl+row as a superset block
		workout.session!.exercises[1].groupId = 'g';
		workout.session!.exercises[2].groupId = 'g';
		workout.moveExercise(1, -1); // move the BLOCK up past press
		expect(workout.session!.exercises.map((e) => e.exerciseId)).toEqual(['curl', 'row', 'press']);
		expect(workout.meta.map((e) => e.id)).toEqual(['curl', 'row', 'press']);
		// moving the standalone back up jumps the whole block
		workout.moveExercise(2, -1);
		expect(workout.session!.exercises.map((e) => e.exerciseId)).toEqual(['press', 'curl', 'row']);
	});
});

const treadmill: Exercise = {
	id: 'treadmill',
	name: 'Treadmill',
	equipment: 'cardio',
	primaryMuscles: ['Cardio'],
	secondaryMuscles: [],
	trackingType: 'cardio',
	loadType: 'total',
	cardioMetric: 'distance',
	defaultRestSec: 0
};

function templateWith(exerciseIds: string[], over: Partial<Template> = {}): Template {
	return {
		id: 'tpl-1',
		name: 'Test Template',
		exercises: exerciseIds.map((id) => ({
			exerciseId: id,
			groupId: null,
			plannedSets: [{ targetReps: 10, targetWeight: 20 }]
		})),
		groups: [],
		createdAt: new Date(BASE).toISOString(),
		updatedAt: new Date(BASE).toISOString(),
		...over
	};
}

describe('starting never overwrites a live workout', () => {
	it('startAdhoc refuses while a session is in progress', async () => {
		await workout.startAdhoc();
		workout.addExercise(press);
		workout.toggleSet(0, 0); // a real logged set that exists nowhere else yet
		const id = workout.session?.id;

		const res = await workout.startAdhoc();
		expect(res).toEqual({ ok: false, reason: 'in-progress' });
		expect(workout.session?.id).toBe(id);
		expect(workout.session?.exercises[0].sets[0].completed).toBe(true);
	});

	it('startFromTemplate refuses while a session is in progress', async () => {
		await workout.startAdhoc();
		workout.addExercise(press);
		workout.toggleSet(0, 0);
		const id = workout.session?.id;
		h.template.value = templateWith(['press']);

		const res = await workout.startFromTemplate('tpl-1');
		expect(res).toEqual({ ok: false, reason: 'in-progress' });
		expect(workout.session?.id).toBe(id);
		expect(workout.session?.title).toBe('Quick log'); // not replaced by the template's
		expect(workout.session?.exercises[0].sets[0].completed).toBe(true);
	});

	it('the guard lifts once the live workout is cancelled', async () => {
		await workout.startAdhoc();
		workout.cancel();
		const res = await workout.startAdhoc();
		expect(res.ok).toBe(true);
		expect(workout.active).toBe(true);
	});
});

describe('startFromTemplate', () => {
	it('skips an exercise the catalog no longer has instead of throwing', async () => {
		h.template.value = templateWith(['press', 'ghost', 'curl']);
		h.exercises.push(curl);

		const res = await workout.startFromTemplate('tpl-1');
		expect(res).toEqual({ ok: true, skippedExerciseIds: ['ghost'] });
		expect(workout.session?.exercises.map((e) => e.exerciseId)).toEqual(['press', 'curl']);
		// the three parallel arrays must stay index-aligned or the table renders
		// one exercise's columns against another's sets
		expect(workout.meta.map((e) => e.id)).toEqual(['press', 'curl']);
		expect(workout.plannedRest).toHaveLength(2);
	});

	it('reports a missing template without starting anything', async () => {
		h.template.value = undefined;
		const res = await workout.startFromTemplate('gone');
		expect(res).toEqual({ ok: false, reason: 'missing-template' });
		expect(workout.active).toBe(false);
	});

	it('prefills the cardio distance target so it does not have to be retyped', async () => {
		h.exercises.push(treadmill);
		h.template.value = templateWith([], {
			exercises: [
				{
					exerciseId: 'treadmill',
					groupId: null,
					plannedSets: [{ targetTimeSec: 600, targetDistanceMeters: 2000 }]
				}
			]
		});
		await workout.startFromTemplate('tpl-1');
		expect(workout.session?.exercises[0].sets[0].distanceMeters).toBe(2000);
		expect(workout.session?.exercises[0].sets[0].timeSec).toBe(600);
	});

	it('reads the last-time history even with auto-progression off', async () => {
		// the setting governs the suggested STEP; the history readout is not the feature
		expect(h.settings.current.autoProgression).toBe(false);
		h.lastSession.value = {
			id: 'prev',
			startedAt: new Date(BASE - 86_400_000).toISOString(),
			endedAt: new Date(BASE - 86_400_000).toISOString(),
			sourceTemplateId: null,
			title: 'prev',
			exercises: [{ exerciseId: 'press', groupId: null, sets: [{ index: 0, completed: true, reps: 10, weight: 12 }] }]
		};
		h.template.value = templateWith(['press']);
		await workout.startFromTemplate('tpl-1');
		expect(workout.suggestions['press']?.last).toBe('10×12kg ×2');
	});
});

describe('rest seed of zero means no rest', () => {
	it('logging a cardio set with a 0 seed starts no timer', async () => {
		await workout.startAdhoc();
		workout.addExercise(treadmill); // defaultRestSec 0
		expect(workout.plannedRest[0]).toEqual([0, 0, 0]);
		workout.toggleSet(0, 0);
		expect(workout.session?.exercises[0].sets[0].completed).toBe(true); // still logged
		expect(workout.restRunning).toBe(false);
		expect(workout.restForSet).toBeNull();
		expect(workout.restOver).toBe(false); // no phantom "rest overage" banner
	});

	it('setPlannedRest keeps 0 as "no rest" but floors any real value at 5s', async () => {
		await workout.startAdhoc();
		workout.addExercise(press);
		workout.setPlannedRest(0, 0, 0); // blanking the cell
		expect(workout.plannedRest[0][0]).toBe(0);
		workout.setPlannedRest(0, 1, 3);
		expect(workout.plannedRest[0][1]).toBe(5);
		workout.setPlannedRest(0, 2, 75);
		expect(workout.plannedRest[0][2]).toBe(75);
	});
});

describe('finish with nothing ticked', () => {
	// The autopersist $effect is window-gated and never runs under the node env, so
	// these seed RESUME_KEY by hand: its survival is the proof that cancel() — which
	// removes it, along with the session note — was NOT called.
	it('keeps the workout alive instead of discarding it silently', async () => {
		await workout.startAdhoc();
		workout.addExercise(press);
		workout.setNote('felt strong');
		backing.set(RESUME_KEY, 'snapshot');
		const res = await workout.finish();
		expect(res).toEqual({ status: 'nothing-logged' });
		expect(h.upserted).toHaveLength(0); // no empty session written
		expect(workout.active).toBe(true); // …and nothing destroyed
		expect(workout.session?.note).toBe('felt strong');
		expect(backing.has(RESUME_KEY)).toBe(true);
	});

	it('still drops an empty shell quietly', async () => {
		await workout.startAdhoc(); // no exercises ever added
		backing.set(RESUME_KEY, 'snapshot');
		const res = await workout.finish();
		expect(res).toEqual({ status: 'empty' });
		expect(workout.active).toBe(false);
		expect(backing.has(RESUME_KEY)).toBe(false);
	});

	it('leaves the workout resumable when the write fails', async () => {
		await workout.startAdhoc();
		workout.addExercise(press);
		workout.toggleSet(0, 0);
		backing.set(RESUME_KEY, 'snapshot');
		h.upsertError.value = new Error('QuotaExceededError');
		await expect(workout.finish()).rejects.toThrow('QuotaExceededError');
		expect(workout.active).toBe(true);
		expect(workout.session?.exercises[0].sets[0].completed).toBe(true);
		expect(backing.has(RESUME_KEY)).toBe(true);
	});
});

describe('propagateWeight', () => {
	it('carries an edited load to the later sets that still agreed with the old one', async () => {
		await workout.startAdhoc();
		workout.addExercise(press);
		const sets = workout.session!.exercises[0].sets;
		sets.forEach((s) => (s.weight = 20));
		sets[0].weight = 25; // the input's oninput already wrote the new value
		workout.propagateWeight(0, 0, 20);
		expect(sets.map((s) => s.weight)).toEqual([25, 25, 25]);
	});

	it('leaves a deliberate pyramid alone', async () => {
		await workout.startAdhoc();
		workout.addExercise(press);
		const sets = workout.session!.exercises[0].sets;
		sets[0].weight = 20;
		sets[1].weight = 30;
		sets[2].weight = 40;
		sets[0].weight = 25;
		workout.propagateWeight(0, 0, 20);
		expect(sets.map((s) => s.weight)).toEqual([25, 30, 40]);
	});

	it('never rewrites a set that is already logged, or an earlier one', async () => {
		await workout.startAdhoc();
		workout.addExercise(press);
		const sets = workout.session!.exercises[0].sets;
		sets.forEach((s) => (s.weight = 20));
		workout.toggleSet(0, 2); // set 3 is a record now, not a plan
		sets[1].weight = 25;
		workout.propagateWeight(0, 1, 20);
		expect(sets.map((s) => s.weight)).toEqual([20, 25, 20]);
	});
});

describe('resume snapshot carries exercise metadata', () => {
	it('restores the table shape on the first paint, before hydrateMeta lands', async () => {
		// a snapshot written by the current build, for a CARDIO exercise: without meta
		// the table paints Rest/Reps/kg bound to the wrong fields until the async
		// hydrate lands, and the Live Activity says "Rest" instead of the exercise name
		h.exercises.push(treadmill);
		const snap = resumeSnapshot();
		snap.session.exercises[0].exerciseId = 'treadmill';
		backing.set(RESUME_KEY, JSON.stringify({ ...snap, meta: [treadmill] }));
		workout.restore();
		// synchronously — no await: this is the frame the workout screen first paints
		expect(workout.meta[0]?.trackingType).toBe('cardio');
		await flush();
		expect(workout.meta[0]?.id).toBe('treadmill');
	});

	it('still restores a snapshot written before meta was persisted', async () => {
		backing.set(RESUME_KEY, JSON.stringify(resumeSnapshot()));
		workout.restore();
		expect(workout.active).toBe(true);
		expect(workout.meta).toEqual([]);
		await flush();
		expect(workout.meta[0]?.name).toBe('Dumbbell Shoulder Press');
	});

	it('cancels the pending OS rest alert on a cold relaunch', () => {
		backing.set(RESUME_KEY, JSON.stringify(resumeSnapshot()));
		h.calls.cancelRestEndAlert = 0;
		workout.restore();
		// a cold relaunch never fires visibilitychange, so restore() owns the cancel
		expect(h.calls.cancelRestEndAlert).toBeGreaterThan(0);
	});
});

describe('addExercise', () => {
	it('reads the added exercise history so the "last time" anchor appears', async () => {
		h.lastSession.value = {
			id: 'prev',
			startedAt: new Date(BASE - 86_400_000).toISOString(),
			endedAt: new Date(BASE - 86_400_000).toISOString(),
			sourceTemplateId: null,
			title: 'prev',
			exercises: [{ exerciseId: 'press', groupId: null, sets: [{ index: 0, completed: true, reps: 10, weight: 12 }] }]
		};
		await workout.startAdhoc();
		workout.addExercise(press);
		await flush();
		expect(workout.suggestions['press']?.last).toBe('10×12kg ×2');
	});
});
