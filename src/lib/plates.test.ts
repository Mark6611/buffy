import { describe, it, expect } from 'vitest';
import { platesPerSide, formatPerSide } from '$lib/plates';

describe('platesPerSide', () => {
	it('bar only when total <= bar', () => {
		expect(platesPerSide(20).perSide).toEqual([]);
		expect(platesPerSide(15).loadable).toBe(true);
		expect(formatPerSide(platesPerSide(20))).toBe('bar only');
	});

	it('breaks a clean load greedily per side', () => {
		// 100kg on a 20kg bar → 40 per side → 25 + 15
		const l = platesPerSide(100);
		expect(l.perSide).toEqual([
			{ plate: 25, count: 1 },
			{ plate: 15, count: 1 }
		]);
		expect(l.loadable).toBe(true);
		expect(formatPerSide(l)).toBe('25 + 15');
	});

	it('uses multiples of the same plate', () => {
		// 140kg → 60 per side → 25 + 25 + 10
		expect(formatPerSide(platesPerSide(140))).toBe('25 + 25 + 10');
	});

	it('handles fractional plates', () => {
		// 65kg → 22.5 per side → 20 + 2.5
		expect(formatPerSide(platesPerSide(65))).toBe('20 + 2.5');
	});

	it('flags an unloadable remainder', () => {
		// 61kg → 20.5 per side; smallest plate 1.25 leaves 0.5 short
		const l = platesPerSide(61);
		expect(l.loadable).toBe(false);
		expect(l.remainderKg).toBeCloseTo(0.5, 2);
	});

	it('respects a custom bar', () => {
		// 60kg on a 15kg bar → 22.5 per side → 20 + 2.5
		expect(formatPerSide(platesPerSide(60, 15))).toBe('20 + 2.5');
	});
});
