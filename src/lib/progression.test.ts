import { describe, it, expect } from 'vitest';
import { computeSuggestion } from '$lib/progression';
import type { Exercise, WorkoutSession, LoggedSet } from '$lib/types';

const exercise = (o: Partial<Exercise>): Exercise => ({
	id: 'inc',
	name: 'Incline',
	equipment: 'barbell',
	primaryMuscles: [],
	secondaryMuscles: [],
	trackingType: 'weight_reps',
	loadType: 'total',
	defaultTargetReps: 8,
	weightStep: 2.5,
	...o
});
const set = (o: Partial<LoggedSet>): LoggedSet => ({ index: 0, completed: true, ...o });
const session = (exerciseId: string, sets: LoggedSet[]): WorkoutSession => ({
	id: 's',
	startedAt: '',
	endedAt: '2026-01-01T00:00:00Z',
	sourceTemplateId: 't',
	exercises: [{ exerciseId, sets }]
});

describe('computeSuggestion', () => {
	it('null with no history', () => {
		expect(computeSuggestion(exercise({}), undefined)).toBeNull();
	});
	it('null if exercise absent from last session', () => {
		expect(computeSuggestion(exercise({ id: 'inc' }), session('other', [set({ reps: 8, weight: 40 })]))).toBeNull();
	});
	it('hit target on all working sets → bumps weight by step', () => {
		const sg = computeSuggestion(
			exercise({ defaultTargetReps: 8, weightStep: 2.5 }),
			session('inc', [set({ reps: 8, weight: 40 }), set({ reps: 9, weight: 40 })])
		);
		expect(sg?.hit).toBe(true);
		expect(sg?.nextWeight).toBe(42.5);
		expect(sg?.stepLabel).toBe('+2.5');
	});
	it('missed target → holds weight', () => {
		const sg = computeSuggestion(
			exercise({ defaultTargetReps: 8 }),
			session('inc', [set({ reps: 8, weight: 40 }), set({ reps: 6, weight: 40 })])
		);
		expect(sg?.hit).toBe(false);
		expect(sg?.nextWeight).toBe(40);
		expect(sg?.stepLabel).toBe('hold');
	});
	it('per-side shows ×2 and uses per-side step', () => {
		const sg = computeSuggestion(
			exercise({ loadType: 'per_side', weightStep: 1, defaultTargetReps: 12 }),
			session('inc', [set({ reps: 12, weight: 12.5, perSide: true })])
		);
		expect(sg?.nextWeight).toBe(13.5);
		expect(sg?.last).toContain('×2');
	});
	it('bodyweight hit → +1 rep', () => {
		const sg = computeSuggestion(
			exercise({ id: 'pu', loadType: 'bodyweight', defaultTargetReps: 10 }),
			session('pu', [set({ reps: 10 }), set({ reps: 11 })])
		);
		expect(sg?.nextReps).toBe(11);
		expect(sg?.stepLabel).toBe('+1 rep');
	});
	it('time-hold → +5s', () => {
		const sg = computeSuggestion(
			exercise({ id: 'pl', trackingType: 'time_hold', loadType: 'bodyweight' }),
			session('pl', [set({ durationSec: 45 })])
		);
		expect(sg?.stepLabel).toBe('+5s');
		expect(sg?.last).toBe('0:45 hold');
	});
	it('time-hold target hit → +5s', () => {
		const sg = computeSuggestion(
			exercise({ id: 'pl', trackingType: 'time_hold', loadType: 'bodyweight', defaultTargetDurationSec: 45 }),
			session('pl', [set({ durationSec: 45 })])
		);
		expect(sg?.hit).toBe(true);
		expect(sg?.stepLabel).toBe('+5s');
	});
	it('time-hold target missed → hold', () => {
		const sg = computeSuggestion(
			exercise({ id: 'pl', trackingType: 'time_hold', loadType: 'bodyweight', defaultTargetDurationSec: 60 }),
			session('pl', [set({ durationSec: 30 })])
		);
		expect(sg?.hit).toBe(false);
		expect(sg?.stepLabel).toBe('hold');
		expect(sg?.heldForRecovery).toBe(false);
		expect(sg?.last).toBe('0:30 hold');
	});
	it('time-hold target hit while strained → held for recovery', () => {
		const sg = computeSuggestion(
			exercise({ id: 'pl', trackingType: 'time_hold', loadType: 'bodyweight', defaultTargetDurationSec: 45 }),
			session('pl', [set({ durationSec: 50 })]),
			{ readiness: 'strained' }
		);
		expect(sg?.hit).toBe(true);
		expect(sg?.stepLabel).toBe('hold (recovery)');
		expect(sg?.heldForRecovery).toBe(true);
	});
	it('cardio → null (log-only)', () => {
		const sg = computeSuggestion(
			exercise({ id: 'tm', trackingType: 'cardio', loadType: 'total' }),
			session('tm', [set({ timeSec: 600, incline: 6, speed: 6 })])
		);
		expect(sg).toBeNull();
	});

	describe('readiness nudge', () => {
		const hitSession = () => session('inc', [set({ reps: 8, weight: 40 }), set({ reps: 9, weight: 40 })]);

		it("strained holds the load even on a hit, and flags heldForRecovery", () => {
			const sg = computeSuggestion(exercise({ defaultTargetReps: 8, weightStep: 2.5 }), hitSession(), {
				readiness: 'strained'
			})!;
			expect(sg.hit).toBe(true);
			expect(sg.nextWeight).toBe(40); // held, not 42.5
			expect(sg.stepLabel).toBe('hold (recovery)');
			expect(sg.heldForRecovery).toBe(true);
		});

		it('fresh/moderate progress normally (recovery-agnostic)', () => {
			for (const readiness of ['fresh', 'moderate'] as const) {
				const sg = computeSuggestion(exercise({ defaultTargetReps: 8, weightStep: 2.5 }), hitSession(), { readiness })!;
				expect(sg.nextWeight).toBe(42.5);
				expect(sg.heldForRecovery).toBe(false);
			}
		});

		it('no opts ⇒ unchanged behavior (no heldForRecovery)', () => {
			const sg = computeSuggestion(exercise({ defaultTargetReps: 8, weightStep: 2.5 }), hitSession())!;
			expect(sg.nextWeight).toBe(42.5);
			expect(sg.heldForRecovery).toBe(false);
		});

		it('strained does not rescue a miss — still a plain hold', () => {
			const sg = computeSuggestion(
				exercise({ defaultTargetReps: 8 }),
				session('inc', [set({ reps: 8, weight: 40 }), set({ reps: 6, weight: 40 })]),
				{ readiness: 'strained' }
			)!;
			expect(sg.hit).toBe(false);
			expect(sg.nextWeight).toBe(40);
			expect(sg.stepLabel).toBe('hold'); // not "hold · recovery" — the miss, not recovery, held it
			expect(sg.heldForRecovery).toBe(false);
		});

		it('bodyweight strained holds reps', () => {
			const sg = computeSuggestion(
				exercise({ id: 'pu', loadType: 'bodyweight', defaultTargetReps: 10 }),
				session('pu', [set({ reps: 10 }), set({ reps: 11 })]),
				{ readiness: 'strained' }
			)!;
			expect(sg.nextReps).toBe(10);
			expect(sg.stepLabel).toBe('hold (recovery)');
		});
	});
});
