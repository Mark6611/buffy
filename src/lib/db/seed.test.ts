// Seeding must survive being INTERRUPTED. It writes exercises, then templates,
// then sample sessions in separate transactions, so an app kill or reload between
// those phases leaves the database half-populated. The guard therefore has to mean
// "a seed finished", not "some data exists" — the latter short-circuits every later
// launch and the templates never arrive.
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
import { seedDatabase } from './seed';
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

	it('populates exercises, templates and sessions on a clean database', async () => {
		const f = fakeRepo();
		await seedDatabase(f.repo);
		expect(f.exercises.length).toBeGreaterThan(0);
		expect(f.templates.length).toBeGreaterThan(0);
		expect(f.sessions.length).toBeGreaterThan(0);
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

		// the old guard returned early here, so these stayed empty forever
		expect(f.templates.length).toBeGreaterThan(0);
		expect(f.sessions.length).toBeGreaterThan(0);
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
