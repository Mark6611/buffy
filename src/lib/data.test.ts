// Backup round-trip. The case that matters most is BODY WEIGHT: it is local-only
// health data that never rides iCloud sync, so the JSON backup is its ONLY recovery
// path — and it used to be missing from the file entirely.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BodyWeightEntry, Exercise, Settings, Template, WorkoutSession } from '$lib/types';

// In-memory stand-in for the repository. Mirrors the real semantics the importer
// depends on: addBodyWeight is a put (id-keyed), deleteBodyWeight hard-deletes, and
// clearAll wipes exercises/templates/sessions but NOT bodyweights — exactly like
// DexieRepository, which is the whole reason replace-mode has to clear it by hand.
const tables = {
	exercises: [] as Exercise[],
	templates: [] as Template[],
	sessions: [] as WorkoutSession[],
	bodyweights: [] as BodyWeightEntry[],
	settings: { defaultRestSec: 90 } as unknown as Settings
};

const fakeRepo = {
	listExercises: async () => [...tables.exercises],
	listTemplates: async () => [...tables.templates],
	listSessions: async () => [...tables.sessions],
	listExercisesForSync: async () => [...tables.exercises],
	listTemplatesForSync: async () => [...tables.templates],
	listSessionsForSync: async () => [...tables.sessions],
	getSettings: async () => tables.settings,
	saveSettings: async (s: Settings) => void (tables.settings = s),
	upsertExercise: async (e: Exercise) => void put(tables.exercises, e),
	upsertTemplate: async (t: Template) => void put(tables.templates, t),
	upsertSession: async (s: WorkoutSession) => void put(tables.sessions, s),
	listBodyWeights: async () => [...tables.bodyweights].sort((a, b) => a.at.localeCompare(b.at)),
	addBodyWeight: async (e: BodyWeightEntry) => void put(tables.bodyweights, e),
	deleteBodyWeight: async (id: string) => {
		tables.bodyweights = tables.bodyweights.filter((e) => e.id !== id);
	},
	clearAll: async () => {
		tables.exercises = [];
		tables.templates = [];
		tables.sessions = [];
	}
};

function put<T extends { id: string }>(arr: T[], rec: T) {
	const i = arr.findIndex((x) => x.id === rec.id);
	if (i < 0) arr.push(rec);
	else arr[i] = rec;
}

vi.mock('$lib/db', () => ({ getRepository: () => fakeRepo }));
vi.mock('$lib/native', () => ({
	saveTextFile: async () => undefined,
	writeAutoBackup: async () => true
}));

const { buildBackup, parseBackup, importBackup } = await import('$lib/data');

const bw = (id: string, at: string, kg: number): BodyWeightEntry => ({ id, at, kg });
const session = (id: string): WorkoutSession => ({
	id,
	startedAt: '2026-01-01T08:00:00.000Z',
	endedAt: '2026-01-01T09:00:00.000Z',
	exercises: []
});

beforeEach(() => {
	tables.exercises = [];
	tables.templates = [];
	tables.sessions = [];
	tables.bodyweights = [];
	tables.settings = { defaultRestSec: 90 } as unknown as Settings;
});

describe('buildBackup', () => {
	it('carries the body-weight series', async () => {
		tables.bodyweights = [bw('b1', '2026-01-01T00:00:00.000Z', 80), bw('b2', '2026-02-01T00:00:00.000Z', 79)];
		const b = await buildBackup();
		expect(b.bodyweights).toEqual(tables.bodyweights);
	});
});

describe('parseBackup', () => {
	const base = { app: 'buffy', version: 1, exportedAt: 'x', exercises: [], templates: [], sessions: [] };

	it('accepts a backup written before bodyweights existed', () => {
		const parsed = parseBackup(JSON.stringify(base));
		expect(parsed.bodyweights).toBeUndefined();
	});

	it('rejects a bodyweights key that is not an array of records', () => {
		expect(() => parseBackup(JSON.stringify({ ...base, bodyweights: { id: 'b1' } }))).toThrow();
		expect(() => parseBackup(JSON.stringify({ ...base, bodyweights: [{ at: 'x', kg: 80 }] }))).toThrow();
	});
});

describe('importBackup — body weight', () => {
	it('round-trips the series through export → import on an empty device', async () => {
		tables.bodyweights = [bw('b1', '2026-01-01T00:00:00.000Z', 80), bw('b2', '2026-02-01T00:00:00.000Z', 79)];
		const file = JSON.parse(JSON.stringify(await buildBackup()));
		tables.bodyweights = []; // as if reinstalled

		const res = await importBackup(parseBackup(JSON.stringify(file)), 'merge');

		expect(res.bodyweights).toBe(2);
		expect(await fakeRepo.listBodyWeights()).toEqual([
			bw('b1', '2026-01-01T00:00:00.000Z', 80),
			bw('b2', '2026-02-01T00:00:00.000Z', 79)
		]);
	});

	it('merge keeps entries the device already has and adds only the missing ones', async () => {
		tables.bodyweights = [bw('b1', '2026-01-01T00:00:00.000Z', 80)];
		const backup = {
			app: 'buffy' as const,
			version: 1 as const,
			exportedAt: 'x',
			exercises: [],
			templates: [],
			sessions: [],
			settings: tables.settings,
			bodyweights: [bw('b1', '2026-01-01T00:00:00.000Z', 999), bw('b2', '2026-02-01T00:00:00.000Z', 79)]
		};

		const res = await importBackup(backup, 'merge');

		expect(res.bodyweights).toBe(1);
		// the local reading wins — merge never overwrites what's already here
		expect((await fakeRepo.listBodyWeights()).map((e) => e.kg)).toEqual([80, 79]);
	});

	it('replace empties the series first, even though clearAll does not touch it', async () => {
		tables.bodyweights = [bw('old1', '2025-01-01T00:00:00.000Z', 95), bw('old2', '2025-02-01T00:00:00.000Z', 94)];
		const backup = {
			app: 'buffy' as const,
			version: 1 as const,
			exportedAt: 'x',
			exercises: [],
			templates: [],
			sessions: [],
			settings: tables.settings,
			bodyweights: [bw('b1', '2026-01-01T00:00:00.000Z', 80)]
		};

		const res = await importBackup(backup, 'replace');

		expect(res.bodyweights).toBe(1);
		expect(await fakeRepo.listBodyWeights()).toEqual([bw('b1', '2026-01-01T00:00:00.000Z', 80)]);
	});

	it('leaves the series alone when restoring a backup file that predates the field', async () => {
		const oldFile = JSON.stringify({
			app: 'buffy',
			version: 1,
			exportedAt: 'x',
			exercises: [],
			templates: [],
			sessions: [session('s1')]
		});

		for (const mode of ['merge', 'replace'] as const) {
			tables.bodyweights = [bw('b1', '2026-01-01T00:00:00.000Z', 80)];
			const res = await importBackup(parseBackup(oldFile), mode);
			expect(res.bodyweights).toBe(0);
			// an absent key must never be read as "you have no body weight"
			expect(await fakeRepo.listBodyWeights()).toHaveLength(1);
		}
	});
});
