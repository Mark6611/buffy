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
		expect(r.hrReservePct).toBe(50);
		expect(r.band).toBe('moderate');
	});

	it('bands scale with effort', () => {
		const easy = computeWorkoutIntensity({ samples: bpms([90]), restingHr: 60, maxHr: 180 })!;
		expect(easy.band).toBe('easy'); // HRR 0.25
		const hard = computeWorkoutIntensity({ samples: bpms([155]), restingHr: 60, maxHr: 180 })!;
		expect(hard.band).toBe('hard'); // HRR ~0.79
		const maximal = computeWorkoutIntensity({ samples: bpms([175]), restingHr: 60, maxHr: 180 })!;
		expect(maximal.band).toBe('maximal'); // HRR ~0.96
	});

	it('derives max HR from age when not given (Tanaka)', () => {
		// age 40 → max 180. resting default 60 → reserve 120. bpm 120 → 0.5.
		const r = computeWorkoutIntensity({ samples: bpms([120]), age: 40 })!;
		expect(r.hrReservePct).toBe(50);
	});

	it('clamps HRR into [0,1] for sub-resting and supra-max HR', () => {
		const r = computeWorkoutIntensity({ samples: bpms([40, 250]), restingHr: 60, maxHr: 180 })!;
		// one sample below resting (→0), one above max (→1), equal weight → 0.5
		expect(r.hrReservePct).toBe(50);
		expect(r.peakHr).toBe(250);
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
});
