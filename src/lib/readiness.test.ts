import { describe, it, expect } from 'vitest';
import { computeReadiness, bandFor } from '$lib/readiness';

describe('computeReadiness', () => {
	it('null when no signals are available', () => {
		expect(computeReadiness({})).toBeNull();
		expect(computeReadiness({ hrvMs: 60 })).toBeNull(); // baseline missing → hrv skipped
	});

	it('at-baseline HRV + RHR + on-target sleep ≈ neutral/moderate', () => {
		const r = computeReadiness({
			hrvMs: 60,
			hrvBaselineMs: 60,
			restingHr: 55,
			restingHrBaseline: 55,
			sleepHours: 8
		})!;
		// hrv 0.5, rhr 0.5, sleep 1.0 → 0.5*.5 + .3*.5 + .2*1 = .6 → 60
		expect(r.score).toBe(60);
		expect(r.band).toBe('moderate');
		expect(r.components).toEqual({ hrv: 0.5, rhr: 0.5, sleep: 1 });
	});

	it('HRV well above baseline, low RHR, full sleep → fresh', () => {
		const r = computeReadiness({
			hrvMs: 80,
			hrvBaselineMs: 60, // ratio 1.33 → hrv ≈ 1.0
			restingHr: 48,
			restingHrBaseline: 56, // −8 → rhr ≈ 1.0
			sleepHours: 8
		})!;
		expect(r.score).toBeGreaterThanOrEqual(95);
		expect(r.band).toBe('fresh');
	});

	it('suppressed HRV, elevated RHR, poor sleep → strained', () => {
		const r = computeReadiness({
			hrvMs: 40,
			hrvBaselineMs: 60, // ratio 0.67 → hrv ≈ 0
			restingHr: 64,
			restingHrBaseline: 56, // +8 → rhr ≈ 0
			sleepHours: 4 // 0.5
		})!;
		expect(r.score).toBeLessThanOrEqual(15);
		expect(r.band).toBe('strained');
	});

	it('renormalises weights when only some signals exist', () => {
		// Only HRV present at baseline → score is entirely the hrv sub-score (0.5).
		const r = computeReadiness({ hrvMs: 60, hrvBaselineMs: 60 })!;
		expect(r.components).toEqual({ hrv: 0.5 });
		expect(r.score).toBe(50);
	});

	it('clamps extreme HRV so score stays in [0,100]', () => {
		const hi = computeReadiness({ hrvMs: 500, hrvBaselineMs: 50 })!;
		expect(hi.components.hrv).toBe(1);
		const lo = computeReadiness({ hrvMs: 1, hrvBaselineMs: 50 })!;
		expect(lo.components.hrv).toBe(0);
	});

	it('respects a custom sleep target', () => {
		const r = computeReadiness({ sleepHours: 7, sleepTargetHours: 7 })!;
		expect(r.components.sleep).toBe(1);
	});

	it('bandFor thresholds', () => {
		expect(bandFor(67)).toBe('fresh');
		expect(bandFor(66)).toBe('moderate');
		expect(bandFor(34)).toBe('moderate');
		expect(bandFor(33)).toBe('strained');
	});
});
