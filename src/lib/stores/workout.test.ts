// Workout store: wall-clock rest timer + persist/restore resume semantics.
// The timers must survive app backgrounding (iOS freezes JS timers) and full
// restarts (WebView purge) — these tests simulate both by jumping the system
// clock without ticking intervals, exactly what suspension looks like to JS.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Exercise, WorkoutSession } from '$lib/types';

const h = vi.hoisted(() => {
	const upserted: unknown[] = [];
	const exercises: Exercise[] = [];
	const pendingAdjustment: { value: { endTimeMs: number; skipped: boolean } | null } = { value: null };
	return {
		upserted,
		exercises,
		pendingAdjustment,
		repo: {
			listExercises: async () => exercises,
			lastSessionForExercise: async () => undefined,
			getTemplate: async () => undefined,
			upsertSession: async (s: unknown) => {
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
	cancelRestEndAlert: async () => {},
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
		const id = await workout.finish();
		expect(id).not.toBeNull();
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
	it('cycles A1→B1→A2→B2 within a group, resting only after the round', () => {
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
		expect(workout.restForSet).toBeNull(); // no rest mid-superset
		workout.toggleSet(1, 0);
		expect([workout.activeEx, workout.activeSet]).toEqual([0, 1]); // → A2
		expect(workout.restForSet).toEqual({ ex: 1, set: 0 }); // rest after the round
		workout.toggleSet(0, 1);
		expect([workout.activeEx, workout.activeSet]).toEqual([1, 1]); // → B2
		expect(workout.restForSet).toBeNull();
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
