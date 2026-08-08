import { describe, it, expect } from 'vitest';
import { applyFullSync, applyWeightsOnlySync, buildTemplateFromSession } from '$lib/templateSync';
import type { Exercise, Template, WorkoutSession } from '$lib/types';

const press: Exercise = {
	id: 'press',
	name: 'Dumbbell Shoulder Press',
	equipment: 'dumbbell',
	primaryMuscles: ['Shoulders'],
	secondaryMuscles: [],
	trackingType: 'weight_reps',
	loadType: 'per_side',
	defaultTargetReps: 10,
	weightStep: 1,
	defaultRestSec: 90
};
const curl: Exercise = {
	id: 'curl',
	name: 'Dumbbell Bicep Curl',
	equipment: 'dumbbell',
	primaryMuscles: ['Biceps'],
	secondaryMuscles: [],
	trackingType: 'weight_reps',
	loadType: 'per_side',
	defaultTargetReps: 12,
	weightStep: 1,
	defaultRestSec: 45
};
// distance-mode cardio: the erg/rower shape, where metres are the target that matters
const rower: Exercise = {
	id: 'rower',
	name: 'Concept2 Rower',
	equipment: 'cardio',
	primaryMuscles: ['Back'],
	secondaryMuscles: [],
	trackingType: 'cardio',
	loadType: 'total',
	cardioMetric: 'distance',
	defaultRestSec: 120
};
const exById = new Map([
	['press', press],
	['curl', curl],
	['rower', rower]
]);

const template: Template = {
	id: 'tpl-1',
	name: 'Shoulder Core',
	exercises: [
		{
			exerciseId: 'press',
			groupId: null,
			plannedSets: [
				{ targetReps: 10, targetWeight: 12, targetRestSec: 90 },
				{ targetReps: 10, targetWeight: 12, targetRestSec: 90 }
			]
		}
	],
	groups: [],
	createdAt: '2026-01-01T00:00:00Z',
	updatedAt: '2026-01-01T00:00:00Z'
};

function session(over: Partial<WorkoutSession> = {}): WorkoutSession {
	return {
		id: 'sess-1',
		startedAt: '2026-06-01T10:00:00Z',
		endedAt: '2026-06-01T10:45:00Z',
		sourceTemplateId: 'tpl-1',
		title: 'Shoulder Core',
		exercises: [
			{
				exerciseId: 'press',
				groupId: null,
				sets: [
					{ index: 0, completed: true, reps: 12, weight: 14, restTakenSec: 100 },
					{ index: 1, completed: true, reps: 11, weight: 14, restTakenSec: 95 }
				]
			}
		],
		...over
	};
}

describe('applyWeightsOnlySync', () => {
	it('updates matched set weights/reps, leaves structure and rest targets untouched', () => {
		const result = applyWeightsOnlySync(template, session());
		expect(result.exercises).toHaveLength(1); // structure unchanged
		expect(result.exercises[0].plannedSets).toHaveLength(2);
		expect(result.exercises[0].plannedSets[0].targetWeight).toBe(14);
		expect(result.exercises[0].plannedSets[0].targetReps).toBe(12);
		expect(result.exercises[0].plannedSets[0].targetRestSec).toBe(90); // untouched
		expect(result.exercises[0].plannedSets[1].targetWeight).toBe(14);
	});

	it('ignores an exercise the template never had', () => {
		const s = session({
			exercises: [
				...session().exercises,
				{ exerciseId: 'curl', groupId: null, sets: [{ index: 0, completed: true, reps: 12, weight: 8 }] }
			]
		});
		const result = applyWeightsOnlySync(template, s);
		expect(result.exercises).toHaveLength(1); // curl not added — weights-only never restructures
	});

	it('leaves extra template sets untouched when fewer sets were logged', () => {
		const s = session({
			exercises: [{ exerciseId: 'press', groupId: null, sets: [{ index: 0, completed: true, reps: 12, weight: 14 }] }]
		});
		const result = applyWeightsOnlySync(template, s);
		expect(result.exercises[0].plannedSets[1].targetWeight).toBe(12); // unchanged from template
	});

	it('updates a distance-mode cardio target and keeps the untouched one', () => {
		const cardioTpl: Template = {
			...template,
			exercises: [
				{
					exerciseId: 'rower',
					groupId: null,
					plannedSets: [
						{ targetDistanceMeters: 2000, targetTimeSec: 480, targetRestSec: 120 },
						{ targetDistanceMeters: 2000, targetTimeSec: 480, targetRestSec: 120 }
					]
				}
			]
		};
		const s = session({
			exercises: [
				{
					exerciseId: 'rower',
					groupId: null,
					sets: [{ index: 0, completed: true, distanceMeters: 2500, timeSec: 600 }]
				}
			]
		});
		const result = applyWeightsOnlySync(cardioTpl, s);
		expect(result.exercises[0].plannedSets[0].targetDistanceMeters).toBe(2500);
		expect(result.exercises[0].plannedSets[1].targetDistanceMeters).toBe(2000); // no 2nd set logged
	});

	it('does not mutate the input template', () => {
		const before = JSON.stringify(template);
		applyWeightsOnlySync(template, session());
		expect(JSON.stringify(template)).toBe(before);
	});

	it('pairs a duplicated exercise by occurrence order, not collapsed by id', () => {
		const dup: Template = {
			...template,
			exercises: [
				{ exerciseId: 'press', groupId: null, plannedSets: [{ targetReps: 10, targetWeight: 12, targetRestSec: 90 }] },
				{ exerciseId: 'press', groupId: null, plannedSets: [{ targetReps: 10, targetWeight: 10, targetRestSec: 90 }] }
			]
		};
		const s = session({
			exercises: [
				{ exerciseId: 'press', groupId: null, sets: [{ index: 0, completed: true, reps: 10, weight: 14 }] },
				{ exerciseId: 'press', groupId: null, sets: [{ index: 0, completed: true, reps: 10, weight: 11 }] }
			]
		});
		const result = applyWeightsOnlySync(dup, s);
		expect(result.exercises[0].plannedSets[0].targetWeight).toBe(14); // 1st occurrence ← 1st logged
		expect(result.exercises[1].plannedSets[0].targetWeight).toBe(11); // 2nd occurrence ← 2nd logged
	});
});

describe('applyFullSync', () => {
	it('replaces the exercise list with exactly what was logged', () => {
		const s = session({
			exercises: [
				{ exerciseId: 'press', groupId: null, sets: [{ index: 0, completed: true, reps: 12, weight: 14, restTakenSec: 100 }] },
				{ exerciseId: 'curl', groupId: null, sets: [{ index: 0, completed: true, reps: 12, weight: 8 }] }
			]
		});
		const result = applyFullSync(template, s, exById);
		expect(result.exercises).toHaveLength(2);
		expect(result.exercises.map((e) => e.exerciseId)).toEqual(['press', 'curl']);
		expect(result.exercises[0].plannedSets).toHaveLength(1); // set count now matches what was logged
	});

	it('falls back to the exercise default rest when nothing was taken (e.g. mid-superset round)', () => {
		const s = session({
			exercises: [{ exerciseId: 'curl', groupId: 'g1', sets: [{ index: 0, completed: true, reps: 12, weight: 8 }] }]
		});
		const result = applyFullSync(template, s, exById);
		expect(result.exercises[0].plannedSets[0].targetRestSec).toBe(45); // curl's defaultRestSec
	});

	it('carries a distance-mode cardio target back into the template', () => {
		const s = session({
			exercises: [
				{
					exerciseId: 'rower',
					groupId: null,
					sets: [{ index: 0, completed: true, distanceMeters: 2000, timeSec: 480, restTakenSec: 120 }]
				}
			]
		});
		const result = applyFullSync(template, s, exById);
		expect(result.exercises[0].plannedSets[0].targetDistanceMeters).toBe(2000);
		expect(result.exercises[0].plannedSets[0].targetTimeSec).toBe(480);
	});

	it('preserves the template id and its existing superset groups', () => {
		const grouped: Template = { ...template, groups: [{ id: 'g1', restSec: 45 }] };
		const result = applyFullSync(grouped, session(), exById);
		expect(result.id).toBe('tpl-1');
		expect(result.groups).toEqual([{ id: 'g1', restSec: 45 }]);
	});
});

describe('buildTemplateFromSession', () => {
	it('builds a fresh template with a new id from a quick-log session', () => {
		const s = session({ sourceTemplateId: null, title: 'Quick log' });
		const result = buildTemplateFromSession(s, exById, 'My New Split');
		expect(result.id).not.toBe('tpl-1');
		expect(result.name).toBe('My New Split');
		expect(result.groups).toEqual([]);
		expect(result.exercises).toHaveLength(1);
		expect(result.exercises[0].plannedSets[0].targetWeight).toBe(14);
	});

	it('keeps a rower session\'s metres when saving a quick log as a template', () => {
		const s = session({
			sourceTemplateId: null,
			exercises: [
				{ exerciseId: 'rower', groupId: null, sets: [{ index: 0, completed: true, distanceMeters: 5000, timeSec: 1200 }] }
			]
		});
		const result = buildTemplateFromSession(s, exById, 'Erg Day');
		expect(result.exercises[0].plannedSets[0].targetDistanceMeters).toBe(5000);
	});

	it('two builds from the same session get different ids', () => {
		const s = session({ sourceTemplateId: null });
		const a = buildTemplateFromSession(s, exById, 'A');
		const b = buildTemplateFromSession(s, exById, 'B');
		expect(a.id).not.toBe(b.id);
	});
});
