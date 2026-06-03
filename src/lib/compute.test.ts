import { describe, it, expect } from 'vitest';
import {
	setVolume,
	sessionVolume,
	sessionSetCount,
	sessionDurationSec,
	cardioDistanceKm,
	templateDerived
} from '$lib/compute';
import type { LoggedSet, WorkoutSession, Template, Exercise } from '$lib/types';

const set = (o: Partial<LoggedSet>): LoggedSet => ({ index: 0, completed: true, ...o });

describe('setVolume', () => {
	it('weight × reps', () => expect(setVolume(set({ weight: 40, reps: 8 }))).toBe(320));
	it('per-side doubles', () => expect(setVolume(set({ weight: 12.5, reps: 10, perSide: true }))).toBe(250));
	it('bodyweight (no weight) → 0', () => expect(setVolume(set({ reps: 10 }))).toBe(0));
});

describe('session aggregates', () => {
	const sess: WorkoutSession = {
		id: 'x',
		startedAt: '2026-06-03T10:00:00Z',
		endedAt: '2026-06-03T10:45:00Z',
		sourceTemplateId: 't',
		exercises: [{ exerciseId: 'a', sets: [set({ weight: 40, reps: 8 }), set({ weight: 40, reps: 8 })] }]
	};
	it('volume sums all sets', () => expect(sessionVolume(sess)).toBe(640));
	it('counts completed sets', () => expect(sessionSetCount(sess)).toBe(2));
	it('duration in seconds', () => expect(sessionDurationSec(sess)).toBe(2700));
});

describe('cardioDistanceKm', () => {
	it('speed × time / 3600', () => expect(cardioDistanceKm(set({ speed: 6, timeSec: 600 }))).toBe(1));
	it('missing inputs → undefined', () => expect(cardioDistanceKm(set({ speed: 6 }))).toBeUndefined());
});

describe('templateDerived', () => {
	const ex: Exercise = {
		id: 'a',
		name: 'A',
		equipment: 'barbell',
		primaryMuscles: ['Chest'],
		secondaryMuscles: [],
		trackingType: 'weight_reps',
		loadType: 'total',
		defaultRestSec: 60
	};
	const t: Template = {
		id: 't',
		name: 'T',
		groups: [],
		createdAt: '',
		updatedAt: '',
		exercises: [{ exerciseId: 'a', plannedSets: [{ targetRestSec: 90 }, { targetRestSec: 90 }] }]
	};
	it('derives muscles, equipment, setCount, duration', () => {
		const d = templateDerived(t, new Map([['a', ex]]));
		expect(d.muscles).toEqual(['Chest']);
		expect(d.equipment).toEqual(['barbell']);
		expect(d.setCount).toBe(2);
		expect(d.estDurationSec).toBe(2 * (35 + 90));
	});
});
