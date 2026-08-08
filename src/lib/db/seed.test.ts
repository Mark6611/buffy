// Seeding must survive being INTERRUPTED. It writes exercises, then templates, in
// separate transactions, so an app kill or reload between those phases leaves the
// database half-populated. The guard therefore has to mean "a seed finished", not
// "some data exists" — the latter short-circuits every later launch and the
// templates never arrive.
//
// It also must NOT write workout history any more: the demo sessions it used to
// generate were indistinguishable from real ones. The id set they were minted with
// survives only so Settings can purge them from existing installs.
import { describe, it, expect, beforeEach } from 'vitest';
// These run under the node environment, which has no localStorage. seedDatabase
// guards with `typeof localStorage !== 'undefined'` so it stays SSR-safe, but the
// completion marker needs somewhere to live for the persistence cases below.
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
	value: {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, String(v)),
		removeItem: (k: string) => void store.delete(k),
		clear: () => store.clear()
	},
	configurable: true
});
import { seedDatabase, demoSessionIds, isDemoSessionId } from './seed';
import type { Repository } from './repository';
import type { Exercise, Template, WorkoutSession } from '$lib/types';

function fakeRepo() {
	const exercises: Exercise[] = [];
	const templates: Template[] = [];
	const sessions: WorkoutSession[] = [];
	const newer = (incoming?: string, current?: string) =>
		!current || (!!incoming && Date.parse(incoming) > Date.parse(current));
	const repo = {
		listExercises: async () => exercises.filter((e) => !e.deletedAt),
		listTemplates: async () => templates.filter((t) => !t.deletedAt),
		listSessions: async () => sessions.filter((s) => !s.deletedAt),
		applySyncedExercise: async (e: Exercise) => {
			const i = exercises.findIndex((x) => x.id === e.id);
			if (i < 0) exercises.push(e);
			else if (newer(e.updatedAt, exercises[i].updatedAt)) exercises[i] = e;
		},
		applySyncedTemplate: async (t: Template) => {
			const i = templates.findIndex((x) => x.id === t.id);
			if (i < 0) templates.push(t);
			else if (newer(t.updatedAt, templates[i].updatedAt)) templates[i] = t;
		},
		applySyncedSession: async (s: WorkoutSession) => {
			const i = sessions.findIndex((x) => x.id === s.id);
			if (i < 0) sessions.push(s);
			else if (newer(s.updatedAt, sessions[i].updatedAt)) sessions[i] = s;
		}
	} as unknown as Repository;
	return { repo, exercises, templates, sessions };
}

describe('seedDatabase', () => {
	beforeEach(() => localStorage.clear());

	it('populates exercises and templates on a clean database', async () => {
		const f = fakeRepo();
		await seedDatabase(f.repo);
		expect(f.exercises.length).toBeGreaterThan(0);
		expect(f.templates.length).toBeGreaterThan(0);
	});

	it('writes NO workout history — a new install starts with an empty log', async () => {
		const f = fakeRepo();
		await seedDatabase(f.repo);
		expect(f.sessions).toEqual([]);
	});

	it('finishes a seed that was interrupted after the exercises were written', async () => {
		// exactly the half-written state a reload mid-seed leaves behind
		const f = fakeRepo();
		f.exercises.push({
			id: 'already-there',
			name: 'Already There',
			equipment: 'barbell',
			primaryMuscles: [],
			secondaryMuscles: [],
			trackingType: 'weight_reps',
			loadType: 'total',
			updatedAt: '2000-01-01T00:00:00.000Z'
		});

		await seedDatabase(f.repo);

		// the old guard returned early here, so this stayed empty forever
		expect(f.templates.length).toBeGreaterThan(0);
	});

	it('skips the work once a seed has completed', async () => {
		const f = fakeRepo();
		await seedDatabase(f.repo);
		const before = f.templates.length;
		f.templates.length = 0; // as if the user deleted everything
		await seedDatabase(f.repo);
		expect(before).toBeGreaterThan(0);
		expect(f.templates.length).toBe(0); // no resurrection on a completed seed
	});

	it('does not overwrite a record the user has since edited', async () => {
		const f = fakeRepo();
		await seedDatabase(f.repo);
		const edited = { ...f.templates[0], name: 'My Renamed Split', updatedAt: new Date().toISOString() };
		f.templates[0] = edited;
		localStorage.clear(); // force the seed to run again

		await seedDatabase(f.repo);

		expect(f.templates.find((t) => t.id === edited.id)?.name).toBe('My Renamed Split');
	});
});

// The "Remove sample data" action in Settings deletes by this predicate, so a false
// positive destroys a real workout. It must recognise every id the old seed minted
// and nothing else.
describe('isDemoSessionId', () => {
	it('lists exactly the 36 ids the retired demo history created', () => {
		const ids = demoSessionIds();
		expect(ids).toHaveLength(36);
		expect(new Set(ids).size).toBe(36); // no duplicates — 36 distinct sessions
	});

	it('recognises the round-robin ids the generator actually produced', () => {
		// week 11 opened the cycle: chest-tricep, back-bicep, shoulder-core…
		expect(isDemoSessionId('sess-chest-tricep-w11-d2')).toBe(true);
		expect(isDemoSessionId('sess-back-bicep-w11-d4')).toBe(true);
		expect(isDemoSessionId('sess-shoulder-core-w11-d6')).toBe(true);
		// …and week 10 continued it from `legs`, not from the top
		expect(isDemoSessionId('sess-legs-w10-d2')).toBe(true);
		expect(isDemoSessionId('sess-legs-w0-d6')).toBe(true);
	});

	it('rejects lookalike ids the generator never minted', () => {
		expect(isDemoSessionId('sess-legs-w11-d2')).toBe(false); // wrong template for that slot
		expect(isDemoSessionId('sess-chest-tricep-w12-d2')).toBe(false); // week 12 never existed
		expect(isDemoSessionId('sess-chest-tricep-w11-d3')).toBe(false); // only days 2/4/6
		expect(isDemoSessionId('sess-chest-tricep-w11-d2-copy')).toBe(false);
	});

	it('rejects a real workout id', () => {
		expect(isDemoSessionId('V1StGXR8_Z5jdHi6B-myT')).toBe(false);
		expect(isDemoSessionId('')).toBe(false);
	});

	it('matches the ids the seeded sessions carried', () => {
		// every generated id is `sess-<template>-w<0..11>-d<2|4|6>`
		for (const id of demoSessionIds()) {
			expect(id).toMatch(/^sess-(chest-tricep|back-bicep|shoulder-core|legs)-w(1[01]|[0-9])-d[246]$/);
			expect(isDemoSessionId(id)).toBe(true);
		}
	});
});
