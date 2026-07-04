// Calories burned for a strength session — tiered by the quality of what we
// actually have, best first. Honest framing: consumer methods for resistance
// exercise carry 15–57% error (2024 scoping review), so the method is stored
// alongside the number and the UI labels it as an estimate.
//
//  1. 'whoop' — Whoop's measured energy for the matched workout. Their model is
//     HR-based and personalized; the API's kilojoule field behaves as GROSS
//     energy, so the 1-MET resting baseline is subtracted — over the WHOOP
//     workout's own window (that's what the gross number was measured over),
//     not Buffy's session window.
//  2. 'hr'    — Keytel et al. 2005 (J Sports Sci 23(3):289-297) per-minute
//     regression integrated over the session's HR stream, minus the resting
//     baseline, ×0.80: Keytel assumes steady-state aerobic work, and lifting
//     violates it upward (pressor/Valsalva HR during sets, elevated HR through
//     rests), so an uncorrected sum overestimates. No validated RT correction
//     exists — 0.80 is the literature-suggested haircut band's midpoint.
//     Energy is integrated over the span the samples actually COVER — never
//     extrapolated across a longer session (a partially-synced wearable chunk
//     must not be billed across the whole hour) — and the tier stands down
//     entirely below 70% coverage.
//  3. 'met'   — Compendium of Physical Activities: net kcal = (MET−1) × kg ×
//     hours, MET picked from the session's measured %HRR intensity when
//     available (3.5 general / 5.0 moderate / 6.0 vigorous; codes 02054/02052/
//     02050), else the general 3.5.
import type { HrSample } from '$lib/intensity';

export interface CalorieInputs {
	durationSec: number;
	weightKg?: number;
	/** years */
	age?: number;
	sex?: 'male' | 'female';
	/** Whoop's kilojoule for the matched workout (gross) */
	whoopKilojoule?: number;
	/** the WHOOP workout window the kilojoule was measured over (defaults to durationSec) */
	whoopDurationSec?: number;
	/** in-workout HR stream (Health) — same shape intensity uses */
	hrSamples?: HrSample[];
	/** avg %HRR 0–100 from the intensity summary — picks the MET tier */
	intensityScore?: number;
}

export interface CalorieEstimate {
	kcal: number;
	method: 'whoop' | 'hr' | 'met';
}

const KJ_PER_KCAL = 4.184;
const RT_HAIRCUT = 0.8;
const MIN_HR_SAMPLES = 5;
const MIN_HR_COVERAGE = 0.7;

/** Physiologically plausible HR samples — optical dropouts and doubled beats
 *  land far outside this band. Shared by the gate and the integrator so the
 *  ≥5-sample minimum counts samples that will actually be used. */
export function usableHrSamples(samples: HrSample[]): HrSample[] {
	return samples.filter((s) => typeof s.bpm === 'number' && s.bpm > 25 && s.bpm < 250);
}

/** 1-MET resting energy over a span — the convention Apple's "active energy"
 *  subtracts. 1 MET ≈ 1 kcal · kg⁻¹ · h⁻¹. */
function restingKcal(weightKg: number, durationSec: number): number {
	return (weightKg * durationSec) / 3600;
}

/** Keytel 2005, no-VO2max model. Returns kJ/min for one HR value.
 *  NB the female weight coefficient is NEGATIVE (−0.1263) — the most
 *  mis-transcribed sign in the paper. */
export function keytelKjPerMin(hr: number, weightKg: number, age: number, sex: 'male' | 'female'): number {
	return sex === 'male'
		? -55.0969 + 0.6309 * hr + 0.1988 * weightKg + 0.2017 * age
		: -20.4022 + 0.4472 * hr - 0.1263 * weightKg + 0.074 * age;
}

export interface KeytelIntegral {
	/** gross kcal over the covered span only — never extrapolated */
	kcal: number;
	/** fraction of durationSec the samples actually cover (1 for untimed streams) */
	coverageFrac: number;
}

/** Gross Keytel kcal integrated over a time-weighted HR stream — energy is
 *  power × time, so unlike the dimensionless intensity average this must only
 *  bill the span the samples cover. Untimed streams (no atMs) fall back to
 *  equal weighting across the full duration. */
export function keytelGrossKcal(
	samples: HrSample[],
	durationSec: number,
	weightKg: number,
	age: number,
	sex: 'male' | 'female'
): KeytelIntegral {
	const usable = usableHrSamples(samples);
	if (!usable.length || durationSec <= 0) return { kcal: 0, coverageFrac: 0 };
	let timed = usable.length > 1 && usable.every((s) => typeof s.atMs === 'number');
	let ordered = timed ? [...usable].sort((a, b) => (a.atMs as number) - (b.atMs as number)) : usable;
	if (timed) {
		const spanMs = (ordered[ordered.length - 1].atMs as number) - (ordered[0].atMs as number);
		if (spanMs <= 0) {
			// all-identical timestamps — degrade to the equal-weight path (mirrors intensity.ts)
			timed = false;
			ordered = usable;
		}
	}

	if (!timed) {
		const avgKjPerMin = ordered.reduce((a, s) => a + Math.max(0, keytelKjPerMin(s.bpm, weightKg, age, sex)), 0) / ordered.length;
		return { kcal: (avgKjPerMin * (durationSec / 60)) / KJ_PER_KCAL, coverageFrac: 1 };
	}

	let kj = 0;
	let coveredMs = 0;
	ordered.forEach((s, i) => {
		const w =
			i < ordered.length - 1
				? Math.max(0, (ordered[i + 1].atMs as number) - (s.atMs as number))
				: Math.max(0, (s.atMs as number) - (ordered[i - 1].atMs as number)); // reuse trailing interval
		// negative regression output (very low HR) contributes zero, not negative
		kj += (Math.max(0, keytelKjPerMin(s.bpm, weightKg, age, sex)) * w) / 60_000;
		coveredMs += w;
	});
	return {
		kcal: kj / KJ_PER_KCAL,
		coverageFrac: Math.min(1, coveredMs / (durationSec * 1000))
	};
}

/** MET for a lifting session from its measured avg %HRR (intensity score),
 *  mapping to Compendium resistance-training codes. */
export function metForIntensity(score: number | undefined): number {
	if (score == null) return 3.5; // 02054 — general 8–15 rep resistance training
	if (score < 35) return 3.5;
	if (score < 55) return 5.0; // 02052 — heavier compound work
	return 6.0; // 02050 — vigorous
}

/** Best available estimate, or null when even the MET floor lacks a body weight
 *  (or everything rounds below 1 kcal). */
export function estimateCalories(input: CalorieInputs): CalorieEstimate | null {
	const { durationSec, weightKg } = input;
	if (durationSec <= 0 || !weightKg || weightKg <= 0) return null;
	const done = (net: number, method: CalorieEstimate['method']): CalorieEstimate | null => {
		const kcal = Math.round(net);
		return kcal >= 1 ? { kcal, method } : null;
	};

	if (typeof input.whoopKilojoule === 'number' && input.whoopKilojoule > 0) {
		// net out resting over the window Whoop measured, not Buffy's session span
		const whoopSpan = input.whoopDurationSec && input.whoopDurationSec > 0 ? input.whoopDurationSec : durationSec;
		const est = done(input.whoopKilojoule / KJ_PER_KCAL - restingKcal(weightKg, whoopSpan), 'whoop');
		if (est) return est;
		// implausibly small vs resting baseline — fall through to the next tier
	}

	if (
		input.hrSamples &&
		usableHrSamples(input.hrSamples).length >= MIN_HR_SAMPLES &&
		typeof input.age === 'number' &&
		input.age > 0 &&
		(input.sex === 'male' || input.sex === 'female')
	) {
		const { kcal: gross, coverageFrac } = keytelGrossKcal(input.hrSamples, durationSec, weightKg, input.age, input.sex);
		if (coverageFrac >= MIN_HR_COVERAGE) {
			// resting is netted over the covered span — the uncovered remainder was
			// never billed, so it must not be debited either
			const est = done((gross - restingKcal(weightKg, durationSec * coverageFrac)) * RT_HAIRCUT, 'hr');
			if (est) return est;
		}
		// low coverage (partially-synced wearable) → stand down to the MET floor;
		// the capture layer re-runs when fuller data lands and upgrades the tier
	}

	const met = metForIntensity(input.intensityScore);
	return done((met - 1) * weightKg * (durationSec / 3600), 'met');
}
