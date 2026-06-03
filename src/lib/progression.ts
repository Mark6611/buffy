// Auto-progression suggestion logic — pure & framework-free so it's unit-testable.
import type { Exercise, WorkoutSession } from '$lib/types';
import { kg } from '$lib/format';

export interface Suggestion {
	last: string;
	nextWeight?: number;
	nextReps?: number;
	stepLabel: string;
	hit: boolean;
}

/**
 * Given an exercise and the most recent session that logged it, suggest the next
 * target. Double-progression: hit the target reps on all working sets → bump the
 * weight (or +1 rep for bodyweight, +5s for time-holds); otherwise hold.
 */
export function computeSuggestion(ex: Exercise, last: WorkoutSession | undefined): Suggestion | null {
	if (!last) return null;
	const le = last.exercises.find((e) => e.exerciseId === ex.id);
	if (!le) return null;
	const working = le.sets.filter((s) => s.completed);
	if (!working.length) return null;

	if (ex.trackingType === 'cardio') return null;
	if (ex.trackingType === 'time_hold') {
		const lastDur = Math.max(...working.map((s) => s.durationSec ?? 0));
		const m = Math.floor(lastDur / 60);
		const r = lastDur % 60;
		return {
			last: `${m}:${String(r).padStart(2, '0')} hold`,
			stepLabel: '+5s',
			hit: true
		};
	}

	const targetReps = ex.defaultTargetReps ?? working[0].reps ?? 0;
	const hit = working.every((s) => (s.reps ?? 0) >= targetReps);
	const lastSet = working[working.length - 1];

	if (ex.loadType === 'bodyweight') {
		return {
			last: `${lastSet.reps ?? 0} reps`,
			nextReps: hit ? targetReps + 1 : targetReps,
			stepLabel: hit ? '+1 rep' : 'hold',
			hit
		};
	}

	const step = ex.weightStep ?? (ex.loadType === 'per_side' ? 1 : 2.5);
	const topWeight = Math.max(...working.map((s) => s.weight ?? 0));
	return {
		last: `${lastSet.reps ?? 0}×${kg(lastSet.weight)}kg${ex.loadType === 'per_side' ? ' ×2' : ''}`,
		nextWeight: hit ? topWeight + step : topWeight,
		stepLabel: hit ? `+${kg(step)}` : 'hold',
		hit
	};
}
