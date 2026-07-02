// Recovery/readiness scoring from the physiological signals a wearable (Whoop,
// Apple Watch, etc.) writes into Apple Health — HRV, resting heart rate, sleep.
// Pure & framework-free so it's unit-testable and shared across PWA + native.
//
// This is a Buffy-native readiness read, NOT Whoop's proprietary Recovery % —
// that score is never exposed through HealthKit. Same inputs, our own transparent
// formula: today's HRV and resting HR relative to a rolling baseline, plus last
// night's sleep. Higher HRV, lower resting HR, and more sleep → fresher.
import { clamp01 } from '$lib/math';

export type ReadinessBand = 'fresh' | 'moderate' | 'strained';

export interface ReadinessInput {
	/** Today's heart-rate variability (SDNN, ms). */
	hrvMs?: number;
	/** Rolling baseline HRV (ms) — e.g. the trailing 14–30 day average. */
	hrvBaselineMs?: number;
	/** Today's resting heart rate (bpm). */
	restingHr?: number;
	/** Rolling baseline resting HR (bpm). */
	restingHrBaseline?: number;
	/** Last main sleep, hours. */
	sleepHours?: number;
	/** Sleep target, hours (default 8). */
	sleepTargetHours?: number;
}

export interface Readiness {
	/** 0–100. */
	score: number;
	band: ReadinessBand;
	/** Per-signal sub-scores in [0,1], present only when the input was available. */
	components: { hrv?: number; rhr?: number; sleep?: number };
}

const isPos = (n: number | undefined): n is number => typeof n === 'number' && n > 0;
const isNonNeg = (n: number | undefined): n is number => typeof n === 'number' && n >= 0;

// Relative weights when all three signals are present. Renormalised over whatever
// signals are actually available (a wearable may not write all of them to Health).
const W = { hrv: 0.5, rhr: 0.3, sleep: 0.2 } as const;

export function bandFor(score: number): ReadinessBand {
	if (score >= 67) return 'fresh';
	if (score >= 34) return 'moderate';
	return 'strained';
}

export function computeReadiness(input: ReadinessInput): Readiness | null {
	const components: { hrv?: number; rhr?: number; sleep?: number } = {};

	// HRV relative to baseline. ±33% from baseline spans the full range; sitting
	// exactly at baseline is neutral (0.5). HRV is the dominant recovery signal.
	if (isPos(input.hrvMs) && isPos(input.hrvBaselineMs)) {
		const ratio = input.hrvMs / input.hrvBaselineMs;
		components.hrv = clamp01(0.5 + (ratio - 1) * 1.5);
	}
	// Resting HR relative to baseline. Elevated is bad; ±8 bpm spans the range.
	if (isPos(input.restingHr) && isPos(input.restingHrBaseline)) {
		const delta = input.restingHr - input.restingHrBaseline;
		components.rhr = clamp01(0.5 - delta * (0.5 / 8));
	}
	// Sleep as a fraction of target, capped at 1.
	if (isNonNeg(input.sleepHours)) {
		const target = isPos(input.sleepTargetHours) ? input.sleepTargetHours : 8;
		components.sleep = clamp01(input.sleepHours / target);
	}

	// Sleep alone can't establish readiness: it's an absolute attainment fraction
	// (8h ⇒ 1.0) while HRV/RHR are baseline-centred at 0.5, so with weight
	// renormalisation a sleep-only night would read as perfect freshness. That
	// input is realistic — iPhone-only sleep tracking writes sleep but no HRV/RHR
	// — so require at least one autonomic signal before emitting a score.
	if (components.hrv === undefined && components.rhr === undefined) return null;

	const present = Object.entries(components) as [keyof typeof W, number][];
	const wsum = present.reduce((a, [k]) => a + W[k], 0);
	const raw = present.reduce((a, [k, v]) => a + W[k] * v, 0) / wsum;
	const score = Math.round(raw * 100);

	return { score, band: bandFor(score), components };
}
