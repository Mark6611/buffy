import { describe, it, expect } from 'vitest';
import { estimateCalories, keytelKjPerMin, keytelGrossKcal, metForIntensity } from '$lib/calories';

describe('keytelKjPerMin', () => {
	it('matches the paper worked example for men (80kg, 35y, HR 130 → ~49.9 kJ/min)', () => {
		expect(keytelKjPerMin(130, 80, 35, 'male')).toBeCloseTo(49.9, 1);
	});
	it("uses the NEGATIVE weight coefficient for women — heavier does not mean more kJ at same HR", () => {
		const w60 = keytelKjPerMin(130, 60, 35, 'female');
		const w90 = keytelKjPerMin(130, 90, 35, 'female');
		expect(w90).toBeLessThan(w60);
		// −20.4022 + 0.4472·130 − 0.1263·60 + 0.074·35 = 32.746
		expect(w60).toBeCloseTo(32.75, 1);
	});
});

describe('keytelGrossKcal', () => {
	it('integrates equal-weighted untimed samples over the duration (coverage 1)', () => {
		// steady 130bpm for 45 min, 80kg 35y male: 49.884 kJ/min × 45 / 4.184 = 536.5 kcal
		const samples = Array.from({ length: 10 }, () => ({ bpm: 130 }));
		const r = keytelGrossKcal(samples, 45 * 60, 80, 35, 'male');
		expect(r.kcal).toBeCloseTo(536.5, 0);
		expect(r.coverageFrac).toBe(1);
	});
	it('clamps negative per-sample output to zero instead of refunding calories', () => {
		// HR 40 → negative regression for males; must not reduce the total
		const r = keytelGrossKcal([{ bpm: 40 }, { bpm: 130 }], 10 * 60, 80, 35, 'male');
		expect(r.kcal).toBeGreaterThan(0);
		expect(r.kcal).toBeCloseTo(((49.9 / 2) * 10) / 4.184, 0);
	});
	it('zero without usable samples', () => {
		expect(keytelGrossKcal([], 600, 80, 35, 'male').kcal).toBe(0);
		expect(keytelGrossKcal([{ bpm: 300 }], 600, 80, 35, 'male').kcal).toBe(0);
	});
	it('NEVER extrapolates a covered span across a longer session — bills covered time only', () => {
		// 45 min of timed 130bpm samples inside a 6-HOUR session (forgot to finish):
		// energy must be the 45-min integral (~536 kcal), coverage ≈ 0.125
		const t0 = Date.parse('2026-07-03T10:00:00Z');
		const samples = Array.from({ length: 90 }, (_, i) => ({ bpm: 130, atMs: t0 + i * 30_000 }));
		const r = keytelGrossKcal(samples, 6 * 3600, 80, 35, 'male');
		expect(r.kcal).toBeLessThan(560);
		expect(r.kcal).toBeGreaterThan(500);
		expect(r.coverageFrac).toBeCloseTo((90 * 30_000) / (6 * 3600 * 1000), 2);
	});
	it('all-identical timestamps degrade to equal weighting instead of zero', () => {
		const samples = Array.from({ length: 6 }, () => ({ bpm: 130, atMs: 1000 }));
		const r = keytelGrossKcal(samples, 30 * 60, 80, 35, 'male');
		expect(r.kcal).toBeGreaterThan(300);
		expect(r.coverageFrac).toBe(1);
	});
});

describe('metForIntensity', () => {
	it('maps intensity score to compendium tiers', () => {
		expect(metForIntensity(undefined)).toBe(3.5);
		expect(metForIntensity(20)).toBe(3.5);
		expect(metForIntensity(45)).toBe(5.0);
		expect(metForIntensity(70)).toBe(6.0);
	});
});

describe('estimateCalories — tier selection', () => {
	const hour = 3600;

	it('null without body weight (even the MET floor needs mass)', () => {
		expect(estimateCalories({ durationSec: hour })).toBeNull();
	});

	it('whoop tier: gross kJ minus the 1-MET resting baseline', () => {
		// 2000 kJ ≈ 478 kcal gross; resting 80kg × 1h = 80 → net ≈ 398
		const e = estimateCalories({ durationSec: hour, weightKg: 80, whoopKilojoule: 2000 })!;
		expect(e.method).toBe('whoop');
		expect(e.kcal).toBe(398);
	});

	it('implausibly small whoop energy falls through instead of reporting ~0', () => {
		const e = estimateCalories({ durationSec: hour, weightKg: 80, whoopKilojoule: 100, intensityScore: 45 })!;
		expect(e.method).toBe('met');
	});

	it('hr tier: keytel net of resting, with the 0.80 resistance-training haircut', () => {
		const samples = Array.from({ length: 10 }, () => ({ bpm: 130 }));
		const e = estimateCalories({ durationSec: 45 * 60, weightKg: 80, age: 35, sex: 'male', hrSamples: samples })!;
		expect(e.method).toBe('hr');
		// gross ≈ 536.6; resting 80×0.75h = 60 → (536.6−60)×0.8 ≈ 381
		expect(e.kcal).toBe(381);
	});

	it('hr tier stands down below 70% coverage — partially-synced wearable falls to met', () => {
		const t0 = Date.parse('2026-07-03T10:00:00Z');
		// 20 minutes of samples in a 60-minute session
		const samples = Array.from({ length: 40 }, (_, i) => ({ bpm: 140, atMs: t0 + i * 30_000 }));
		const e = estimateCalories({ durationSec: 3600, weightKg: 80, age: 35, sex: 'male', hrSamples: samples, intensityScore: 45 })!;
		expect(e.method).toBe('met');
	});

	it('the ≥5-sample gate counts artifact-FILTERED samples, not raw', () => {
		// four optical dropouts + one real sample must not unlock the hr tier
		const samples = [{ bpm: 300 }, { bpm: 300 }, { bpm: 300 }, { bpm: 300 }, { bpm: 140 }];
		const e = estimateCalories({ durationSec: 3600, weightKg: 80, age: 35, sex: 'male', hrSamples: samples, intensityScore: 45 })!;
		expect(e.method).toBe('met');
	});

	it('whoop tier nets resting over the WHOOP window, not the session span', () => {
		// 2000 kJ measured over a 30-min whoop window inside a 2h Buffy session:
		// resting debit must be 80kg × 0.5h = 40, not 160
		const e = estimateCalories({ durationSec: 2 * 3600, weightKg: 80, whoopKilojoule: 2000, whoopDurationSec: 1800 })!;
		expect(e.method).toBe('whoop');
		expect(e.kcal).toBe(438); // 478 − 40
	});

	it('hr tier requires age AND sex — otherwise met', () => {
		const samples = Array.from({ length: 10 }, () => ({ bpm: 130 }));
		const e = estimateCalories({ durationSec: hour, weightKg: 80, hrSamples: samples, intensityScore: 45 })!;
		expect(e.method).toBe('met');
	});

	it('met tier: (MET−1) × kg × hours with intensity-picked MET', () => {
		const e = estimateCalories({ durationSec: hour, weightKg: 80, intensityScore: 60 })!;
		expect(e.method).toBe('met');
		expect(e.kcal).toBe(400); // (6−1) × 80 × 1
	});
});
