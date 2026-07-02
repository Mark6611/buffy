import { describe, it, expect } from 'vitest';
import { computeWorkoutIntensity } from '$lib/intensity';

const bpms = (arr: number[]) => arr.map((bpm) => ({ bpm }));

describe('computeWorkoutIntensity', () => {
	it('null with no usable samples', () => {
		expect(computeWorkoutIntensity({ samples: [] })).toBeNull();
		expect(computeWorkoutIntensity({ samples: [{ bpm: 0 }, { bpm: -5 }] })).toBeNull();
	});

	it('computes avg %HRR (Karvonen) with explicit resting/max', () => {
		// resting 60, max 180 → reserve 120. bpm 120 → HRR (120−60)/120 = 0.5.
		const r = computeWorkoutIntensity({ samples: bpms([120, 120]), restingHr: 60, maxHr: 180 })!;
		expect(r.avgHr).toBe(120);
		expect(r.peakHr).toBe(120);
		expect(r.score).toBe(50);
		expect(r.band).toBe('moderate');
	});

	it('bands scale with effort (strength-calibrated thresholds 35/55/75)', () => {
		const easy = computeWorkoutIntensity({ samples: bpms([90]), restingHr: 60, maxHr: 180 })!;
		expect(easy.band).toBe('easy'); // HRR 0.25
		const hard = computeWorkoutIntensity({ samples: bpms([135]), restingHr: 60, maxHr: 180 })!;
		expect(hard.band).toBe('hard'); // HRR ~0.63 — a working strength session
		const maximal = computeWorkoutIntensity({ samples: bpms([155]), restingHr: 60, maxHr: 180 })!;
		expect(maximal.band).toBe('maximal'); // HRR ~0.79 — sustained near-cardio effort
	});

	it('a realistic lifting session (rests included in the average) is not graded easy', () => {
		// 6 work sets ~148bpm with 2.5-min rests ~112bpm, resting 55, max 187 (age 30)
		const session = [
			...Array(10).fill(105), // warmup
			...Array(12).fill(148), ...Array(30).fill(112), // work/rest blocks
			...Array(12).fill(150), ...Array(30).fill(114),
			...Array(12).fill(146), ...Array(30).fill(110)
		];
		const r = computeWorkoutIntensity({ samples: bpms(session), restingHr: 55, age: 30 })!;
		expect(r.band).not.toBe('easy');
	});

	it('derives max HR from age when not given (Tanaka)', () => {
		// age 40 → max 180. resting default 60 → reserve 120. bpm 120 → 0.5.
		const r = computeWorkoutIntensity({ samples: bpms([120]), age: 40 })!;
		expect(r.score).toBe(50);
	});

	it('clamps HRR into [0,1] for sub-resting and supra-max HR', () => {
		const r = computeWorkoutIntensity({ samples: bpms([40, 240]), restingHr: 60, maxHr: 180 })!;
		// one sample below resting (→0), one above max (→1), equal weight → 0.5
		expect(r.score).toBe(50);
		expect(r.peakHr).toBe(240);
	});

	it('time-weights irregular samples', () => {
		// 100 bpm held 90s, then 160 bpm for 10s. Time-weighted avg pulls toward 100.
		const r = computeWorkoutIntensity({
			samples: [
				{ bpm: 100, atMs: 0 },
				{ bpm: 160, atMs: 90_000 },
				{ bpm: 160, atMs: 100_000 }
			],
			restingHr: 60,
			maxHr: 180
		})!;
		// A naive mean would be ~140; time-weighting keeps avgHr well below that.
		expect(r.avgHr).toBeLessThan(120);
	});

	it('zones sum to ~1', () => {
		const r = computeWorkoutIntensity({ samples: bpms([80, 110, 140, 170]), restingHr: 60, maxHr: 180 })!;
		const total = Object.values(r.zones).reduce((a, b) => a + b, 0);
		expect(total).toBeCloseTo(1, 5);
	});

	it('survives identical timestamps by falling back to equal weight', () => {
		const r = computeWorkoutIntensity({
			samples: [
				{ bpm: 120, atMs: 5 },
				{ bpm: 120, atMs: 5 }
			],
			restingHr: 60,
			maxHr: 180
		})!;
		expect(r.avgHr).toBe(120);
	});

	it('mixed timestamps (only some samples timed) fall back to equal weighting', () => {
		const r = computeWorkoutIntensity({
			samples: [{ bpm: 100, atMs: 0 }, { bpm: 160, atMs: 90_000 }, { bpm: 160 }],
			restingHr: 60,
			maxHr: 180
		})!;
		expect(r.avgHr).toBe(140); // plain mean — no time-weighting without full timestamps
	});

	it('unsorted timestamps give the same result as sorted (order independence)', () => {
		const sorted = computeWorkoutIntensity({
			samples: [
				{ bpm: 100, atMs: 0 },
				{ bpm: 160, atMs: 90_000 },
				{ bpm: 160, atMs: 100_000 }
			],
			restingHr: 60,
			maxHr: 180
		})!;
		const shuffled = computeWorkoutIntensity({
			samples: [
				{ bpm: 160, atMs: 100_000 },
				{ bpm: 100, atMs: 0 },
				{ bpm: 160, atMs: 90_000 }
			],
			restingHr: 60,
			maxHr: 180
		})!;
		expect(shuffled).toEqual(sorted);
	});

	it('drops physiologically implausible artifact samples (bpm ≤ 25 or ≥ 250)', () => {
		const r = computeWorkoutIntensity({ samples: bpms([10, 300, 120]), restingHr: 60, maxHr: 180 })!;
		expect(r.avgHr).toBe(120);
		expect(r.peakHr).toBe(120); // a 300 bpm artifact never becomes the peak
		expect(computeWorkoutIntensity({ samples: bpms([5, 260]) })).toBeNull();
	});
});
