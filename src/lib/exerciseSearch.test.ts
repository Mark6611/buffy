import { describe, it, expect } from 'vitest';
import { matchesExercise, normalizeName, sameExerciseName } from '$lib/exerciseSearch';
import type { Exercise } from '$lib/types';

// Real rows from the seed catalog — the point of these tests is that the way a
// person types these names actually finds them.
function ex(over: Partial<Exercise> & Pick<Exercise, 'id' | 'name'>): Exercise {
	return {
		equipment: 'machine',
		primaryMuscles: [],
		secondaryMuscles: [],
		trackingType: 'weight_reps',
		loadType: 'total',
		...over
	};
}

const latPulldown = ex({
	id: 'lat-pulldown',
	name: 'Machine Lat Pull Down Wide-Grip',
	equipment: 'machine',
	primaryMuscles: ['Lats'],
	secondaryMuscles: ['Biceps']
});
const pullups = ex({
	id: 'pullups',
	name: 'Pull-ups',
	equipment: 'bodyweight',
	primaryMuscles: ['Lats'],
	secondaryMuscles: ['Biceps'],
	loadType: 'bodyweight'
});
const bicepCurl = ex({
	id: 'bicep-curl',
	name: 'Dumbbell Bicep Curl',
	equipment: 'dumbbell',
	primaryMuscles: ['Biceps'],
	loadType: 'per_side'
});
const incBench = ex({
	id: 'inc-bench',
	name: 'Barbell Incline Bench Press',
	equipment: 'barbell',
	primaryMuscles: ['Chest'],
	secondaryMuscles: ['Triceps', 'Shoulders']
});
const chestPress = ex({
	id: 'chest-press',
	name: 'Machine Seated Chest Press',
	equipment: 'machine',
	primaryMuscles: ['Chest'],
	secondaryMuscles: ['Triceps']
});
const plank = ex({ id: 'plank', name: 'Plank', equipment: 'bodyweight', primaryMuscles: ['Abs'], trackingType: 'time_hold' });

describe('matchesExercise', () => {
	it('matches a name typed as one word when the catalog has two', () => {
		expect(matchesExercise(latPulldown, 'pulldown')).toBe(true);
		expect(matchesExercise(pullups, 'pullups')).toBe(true);
	});

	it('matches across a plural the catalog spells singular', () => {
		expect(matchesExercise(bicepCurl, 'biceps')).toBe(true); // primaryMuscles is ['Biceps'], name says "Bicep"
		expect(matchesExercise(latPulldown, 'lats')).toBe(true);
	});

	it('matches words out of order and non-adjacent', () => {
		expect(matchesExercise(incBench, 'incline press')).toBe(true); // "Incline Bench Press"
		expect(matchesExercise(incBench, 'press incline')).toBe(true);
	});

	it('searches muscle and equipment, not just the name', () => {
		expect(matchesExercise(incBench, 'chest')).toBe(true); // only via primaryMuscles
		expect(matchesExercise(chestPress, 'chest')).toBe(true); // via the name
		expect(matchesExercise(bicepCurl, 'dumbbell')).toBe(true);
		expect(matchesExercise(pullups, 'bodyweight')).toBe(true);
	});

	it('matches on a prefix, so results narrow as you type', () => {
		for (const q of ['i', 'inc', 'incl', 'incline']) expect(matchesExercise(incBench, q)).toBe(true);
	});

	it('ignores case, punctuation and stray whitespace', () => {
		expect(matchesExercise(pullups, '  PULL   UPS ')).toBe(true);
		expect(matchesExercise(latPulldown, 'wide-grip')).toBe(true);
		expect(matchesExercise(latPulldown, 'wide grip')).toBe(true);
	});

	it('keeps short words intact rather than over-stemming them', () => {
		expect(matchesExercise(plank, 'abs')).toBe(true);
	});

	it('requires every typed word to match something', () => {
		expect(matchesExercise(incBench, 'incline curl')).toBe(false);
		expect(matchesExercise(bicepCurl, 'barbell curl')).toBe(false); // it's a dumbbell curl
	});

	it('returns no false positives for an unrelated query', () => {
		expect(matchesExercise(plank, 'squat')).toBe(false);
		expect(matchesExercise(chestPress, 'deadlift')).toBe(false);
	});

	it('matches everything on an empty or whitespace-only query', () => {
		for (const q of ['', '   ', '-']) {
			expect(matchesExercise(plank, q)).toBe(true);
			expect(matchesExercise(incBench, q)).toBe(true);
		}
	});
});

describe('sameExerciseName', () => {
	it('ignores case, punctuation and spacing', () => {
		expect(sameExerciseName('Pull-Ups', 'pull ups')).toBe(true);
		expect(sameExerciseName('Plank', ' plank ')).toBe(true);
	});

	it('does not collapse genuinely different names', () => {
		expect(sameExerciseName('Plank', 'Side Plank')).toBe(false);
		expect(sameExerciseName('Bicep Curl', 'Bicep Curls')).toBe(false); // a deliberate variant name stands
	});

	it('never reports a match for an empty name', () => {
		expect(sameExerciseName('', '')).toBe(false);
		expect(sameExerciseName('  ', 'Plank')).toBe(false);
	});
});

describe('normalizeName', () => {
	it('collapses punctuation runs to single spaces', () => {
		expect(normalizeName('Machine Lat Pull Down Wide-Grip')).toBe('machine lat pull down wide grip');
		expect(normalizeName('  Concept2  Rower!! ')).toBe('concept2 rower');
	});
});
