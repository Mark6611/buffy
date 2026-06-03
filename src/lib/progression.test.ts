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
	it('cardio → null (log-only)', () => {
		const sg = computeSuggestion(
			exercise({ id: 'tm', trackingType: 'cardio', loadType: 'total' }),
			session('tm', [set({ timeSec: 600, incline: 6, speed: 6 })])
		);
		expect(sg).toBeNull();
	});
});
