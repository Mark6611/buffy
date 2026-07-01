// Workout store: wall-clock rest timer + persist/restore resume semantics.
// The timers must survive app backgrounding (iOS freezes JS timers) and full
// restarts (WebView purge) — these tests simulate both by jumping the system
// clock without ticking intervals, exactly what suspension looks like to JS.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Exercise, WorkoutSession } from '$lib/types';

const h = vi.hoisted(() => {
	const upserted: unknown[] = [];
	const exercises: Exercise[] = [];
	return {
		upserted,
		exercises,
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
	endRestLiveActivity: async () => {}
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
