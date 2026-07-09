import { describe, it, expect } from 'vitest';
import { stripSessionHealth, preserveLocalHealth } from '$lib/healthPrivacy';
import type { WorkoutSession } from '$lib/types';

const base = (o: Partial<WorkoutSession> = {}): WorkoutSession => ({
	id: 's1',
	startedAt: '2026-07-04T10:00:00Z',
	endedAt: '2026-07-04T11:00:00Z',
	title: 'Push day',
	exercises: [{ exerciseId: 'bench', sets: [{ index: 0, completed: true, reps: 8, weight: 60 }] }],
	note: 'felt strong',
	updatedAt: '2026-07-04T11:00:00Z',
	...o
});

const withHealth = (o: Partial<WorkoutSession> = {}): WorkoutSession =>
	base({
		intensity: { score: 55, band: 'moderate', avgHr: 120, peakHr: 160, zones: { z1: 0.5, z2: 0.2, z3: 0.1, z4: 0.2, z5: 0 } },
		whoop: { strain: 12.4, avgHr: 118, maxHr: 165, kilojoule: 1800 },
		calories: { kcal: 320, method: 'whoop' },
		...o
	});

describe('stripSessionHealth (what CloudKit push sends)', () => {
	it('removes intensity, whoop, and calories', () => {
		const s = stripSessionHealth(withHealth());
		expect(s.intensity).toBeUndefined();
		expect(s.whoop).toBeUndefined();
		expect(s.calories).toBeUndefined();
	});
	it('keeps the loggable workout and metadata intact', () => {
		const s = stripSessionHealth(withHealth());
		expect(s.exercises).toHaveLength(1);
		expect(s.exercises[0].sets[0].weight).toBe(60);
		expect(s.note).toBe('felt strong');
		expect(s.updatedAt).toBe('2026-07-04T11:00:00Z');
	});
	it('does not mutate the original', () => {
		const orig = withHealth();
		stripSessionHealth(orig);
		expect(orig.intensity).toBeDefined();
	});
});

describe('preserveLocalHealth (what a pull applies)', () => {
	it('keeps this device local health while taking the remote loggable edits', () => {
		const remote = stripSessionHealth(base({ note: 'edited on iPad', updatedAt: '2026-07-04T12:00:00Z' }));
		const local = withHealth(); // this device already computed health
		const merged = preserveLocalHealth(remote, local);
		expect(merged.note).toBe('edited on iPad'); // remote edit wins for loggable data
		expect(merged.intensity).toEqual(local.intensity); // local health preserved
		expect(merged.whoop).toEqual(local.whoop);
		expect(merged.calories).toEqual(local.calories);
	});
	it('a session first seen via sync has no health (recomputed locally later)', () => {
		const merged = preserveLocalHealth(base(), undefined);
		expect(merged.intensity).toBeUndefined();
		expect(merged.whoop).toBeUndefined();
		expect(merged.calories).toBeUndefined();
	});
	it('never ADOPTS remote health, even from a legacy record that still carries it', () => {
		const legacyRemote = withHealth(); // pushed before the rule existed
		const merged = preserveLocalHealth(legacyRemote, undefined);
		expect(merged.intensity).toBeUndefined();
		expect(merged.whoop).toBeUndefined();
	});
});
