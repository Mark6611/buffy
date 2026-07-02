// Auto-progression suggestion logic — pure & framework-free so it's unit-testable.
import type { Exercise, WorkoutSession } from '$lib/types';
import type { ReadinessBand } from '$lib/readiness';
import { kg } from '$lib/format';

export interface Suggestion {
	last: string;
	nextWeight?: number;
	nextReps?: number;
	stepLabel: string;
	hit: boolean;
	/** True when reps were hit but we held the load anyway because recovery is low. */
	heldForRecovery?: boolean;
}

export interface SuggestionOpts {
	/**
	 * Today's readiness band (from lib/readiness). When 'strained', a would-be bump
	 * is held back — you hit your reps, but low recovery says don't add load today.
	 * Omitted/undefined ⇒ progression behaves exactly as before (recovery-agnostic).
	 */
	readiness?: ReadinessBand;
}

/**
 * Given an exercise and the most recent session that logged it, suggest the next
 * target. Double-progression: hit the target reps on all working sets → bump the
 * weight (or +1 rep for bodyweight, +5s for time-holds); otherwise hold. A
 * 'strained' readiness band holds the load even on a hit (see SuggestionOpts).
 */
export function computeSuggestion(
	ex: Exercise,
	last: WorkoutSession | undefined,
	opts: SuggestionOpts = {}
): Suggestion | null {
	if (!last) return null;
	const le = last.exercises.find((e) => e.exerciseId === ex.id);
	if (!le) return null;
	const working = le.sets.filter((s) => s.completed);
	if (!working.length) return null;

	const strained = opts.readiness === 'strained';

	if (ex.trackingType === 'cardio') return null;
	if (ex.trackingType === 'time_hold') {
		const lastDur = Math.max(...working.map((s) => s.durationSec ?? 0));
		// Not format.mmss() — that pads minutes to two digits ("00:45"); holds read as "0:45".
		const m = Math.floor(lastDur / 60);
		const r = lastDur % 60;
		const target = ex.defaultTargetDurationSec;
		// No target duration configured → the historical always-advance behavior.
		const hit = typeof target !== 'number' || lastDur >= target;
		const held = hit && strained;
		const advance = hit && !strained;
		return {
			last: `${m}:${String(r).padStart(2, '0')} hold`,
			stepLabel: advance ? '+5s' : held ? 'hold (recovery)' : 'hold',
			hit,
			heldForRecovery: held
		};
	}

	const targetReps = ex.defaultTargetReps ?? working[0].reps ?? 0;
	const hit = working.every((s) => (s.reps ?? 0) >= targetReps);
	const lastSet = working[working.length - 1];
	// Reps were earned, but low recovery says don't add load/reps today.
	const held = hit && strained;
	const advance = hit && !strained;

	if (ex.loadType === 'bodyweight') {
		return {
			last: `${lastSet.reps ?? 0} reps`,
			nextReps: advance ? targetReps + 1 : targetReps,
			stepLabel: advance ? '+1 rep' : held ? 'hold (recovery)' : 'hold',
			hit,
			heldForRecovery: held
		};
	}

	const step = ex.weightStep ?? (ex.loadType === 'per_side' ? 1 : 2.5);
	const topWeight = Math.max(...working.map((s) => s.weight ?? 0));
	return {
		last: `${lastSet.reps ?? 0}×${kg(lastSet.weight)}kg${ex.loadType === 'per_side' ? ' ×2' : ''}`,
		nextWeight: advance ? topWeight + step : topWeight,
		stepLabel: advance ? `+${kg(step)}` : held ? 'hold (recovery)' : 'hold',
		hit,
		heldForRecovery: held
	};
}
