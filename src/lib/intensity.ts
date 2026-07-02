// Per-workout intensity from heart-rate samples — the HR a wearable (Whoop, Apple
// Watch) wrote into Apple Health during the workout's time window. Pure & testable.
//
// NOTE: this is NOT Whoop's proprietary Strain (0–21) — that score never enters
// HealthKit. This is a Buffy intensity read from raw HR: average % heart-rate
// reserve (Karvonen), observed peak, and time spent in HR zones.
import { clamp01 } from '$lib/math';

export interface HrSample {
	bpm: number;
	/** epoch ms — enables time-weighting when samples are irregular. Optional. */
	atMs?: number;
}

export interface IntensityInput {
	samples: HrSample[];
	/** Resting HR (bpm). Default 60. */
	restingHr?: number;
	/** Max HR (bpm). If absent, derived from age (Tanaka: 208 − 0.7·age) or 190. */
	maxHr?: number;
	age?: number;
}

export type IntensityBand = 'easy' | 'moderate' | 'hard' | 'maximal';

export interface WorkoutIntensity {
	avgHr: number;
	peakHr: number;
	/** 0–100 intensity score — this IS the average % heart-rate reserve (rounded avg %HRR). */
	score: number;
	band: IntensityBand;
	/** Fraction of time in each %HRR zone (z1<50, z2 50–60, z3 60–70, z4 70–85, z5≥85). Sums to ~1. */
	zones: { z1: number; z2: number; z3: number; z4: number; z5: number };
}

function bandFor(score: number): IntensityBand {
	if (score < 50) return 'easy';
	if (score < 70) return 'moderate';
	if (score < 85) return 'hard';
	return 'maximal';
}

function zoneFor(hrr: number): keyof WorkoutIntensity['zones'] {
	if (hrr < 0.5) return 'z1';
	if (hrr < 0.6) return 'z2';
	if (hrr < 0.7) return 'z3';
	if (hrr < 0.85) return 'z4';
	return 'z5';
}

export function computeWorkoutIntensity(input: IntensityInput): WorkoutIntensity | null {
	// Sensor artifacts (optical dropouts, doubled beats) produce physiologically
	// impossible readings. avgHr uses raw bpm while score uses clamped HRR, so an
	// absurd sample skews both — drop anything outside a plausible human band.
	const samples = input.samples.filter((s) => typeof s.bpm === 'number' && s.bpm > 25 && s.bpm < 250);
	if (!samples.length) return null;

	const resting = typeof input.restingHr === 'number' && input.restingHr > 0 ? input.restingHr : 60;
	let maxHr =
		typeof input.maxHr === 'number' && input.maxHr > 0
			? input.maxHr
			: typeof input.age === 'number' && input.age > 0
				? 208 - 0.7 * input.age
				: 190;
	// Guard the Karvonen denominator against garbage inputs (max ≤ resting).
	if (maxHr <= resting) maxHr = resting + 1;
	const reserve = maxHr - resting;

	// Time-weight only when every sample carries a timestamp; otherwise equal weight.
	const timed = samples.length > 1 && samples.every((s) => typeof s.atMs === 'number');
	const ordered = timed ? [...samples].sort((a, b) => (a.atMs as number) - (b.atMs as number)) : samples;
	const weights = ordered.map((s, i) => {
		if (!timed) return 1;
		if (i < ordered.length - 1) return Math.max(0, (ordered[i + 1].atMs as number) - (s.atMs as number));
		// Last sample: reuse the previous interval so it isn't dropped.
		return i > 0 ? Math.max(0, (s.atMs as number) - (ordered[i - 1].atMs as number)) : 1;
	});
	let totalW = weights.reduce((a, w) => a + w, 0);
	if (totalW <= 0) {
		// All timestamps identical → fall back to equal weighting.
		weights.fill(1);
		totalW = weights.length;
	}

	const zones = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
	let hrSum = 0;
	let hrrSum = 0;
	let peakHr = 0;
	ordered.forEach((s, i) => {
		const w = weights[i];
		const hrr = clamp01((s.bpm - resting) / reserve);
		hrSum += s.bpm * w;
		hrrSum += hrr * w;
		zones[zoneFor(hrr)] += w;
		if (s.bpm > peakHr) peakHr = s.bpm;
	});

	const avgHrr = hrrSum / totalW;
	const score = Math.round(avgHrr * 100);
	(Object.keys(zones) as (keyof typeof zones)[]).forEach((k) => (zones[k] = zones[k] / totalW));

	return {
		avgHr: Math.round(hrSum / totalW),
		peakHr,
		score,
		band: bandFor(score),
		zones
	};
}
