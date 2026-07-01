// Dexie/IndexedDB implementation of the Repository interface.
// Nothing outside this file knows we use Dexie — swap freely behind the interface.
import Dexie, { type Table } from 'dexie';
import type { Exercise, Template, WorkoutSession, Settings, ID } from '$lib/types';
import type { Repository } from './repository';
import { DEFAULT_SETTINGS } from './seed';

type SettingsRow = Settings & { id: string };
const SETTINGS_KEY = 'singleton';

class BuffyDB extends Dexie {
	exercises!: Table<Exercise, ID>;
	templates!: Table<Template, ID>;
	sessions!: Table<WorkoutSession, ID>;
	settings!: Table<SettingsRow, string>;

	constructor() {
		super('buffy');
		// Schema versioning — to evolve the schema, ADD a new version() block below;
		// never edit an existing one in place (that silently drops user data). Add
		// .upgrade((tx) => …) when reshaping records; index-only changes migrate
		// automatically and preserve all data.
		this.version(1).stores({
			exercises: 'id, name, equipment, trackingType',
			templates: 'id, name, updatedAt',
			sessions: 'id, startedAt, sourceTemplateId',
			settings: 'id'
		});
		// v2: index completed sessions by endedAt (history + per-exercise lookups).
		this.version(2).stores({
			sessions: 'id, startedAt, sourceTemplateId, endedAt'
		});
		// v3: exercises + sessions gain updatedAt (iCloud sync merge key, mirrors
		// templates' existing field) — backfill existing rows so nothing is undefined.
		this.version(3)
			.stores({
				exercises: 'id, name, equipment, trackingType, updatedAt',
				sessions: 'id, startedAt, sourceTemplateId, endedAt, updatedAt'
			})
			.upgrade(async (tx) => {
				const now = new Date().toISOString();
				await tx.table('exercises').toCollection().modify((e) => {
					if (!e.updatedAt) e.updatedAt = now;
				});
				await tx.table('sessions').toCollection().modify((s) => {
					if (!s.updatedAt) s.updatedAt = now;
				});
			});
		// If another tab upgrades the schema, close this connection rather than block it.
		this.on('versionchange', () => this.close());
	}
}

export class DexieRepository implements Repository {
	readonly db = new BuffyDB();

	// --- exercises ---
	listExercises() {
		return this.db.exercises.orderBy('name').toArray();
	}
	getExercise(id: ID) {
		return this.db.exercises.get(id);
	}
	async upsertExercise(ex: Exercise) {
		// stamp centrally — sync merge depends on every write bumping this, and
		// there are too many call sites to trust each one to remember
		await this.db.exercises.put({ ...ex, updatedAt: new Date().toISOString() });
	}
	async deleteExercise(id: ID) {
		await this.db.exercises.delete(id);
	}

	// --- templates ---
	listTemplates() {
		return this.db.templates.orderBy('updatedAt').reverse().toArray();
	}
	getTemplate(id: ID) {
		return this.db.templates.get(id);
	}
	async upsertTemplate(t: Template) {
		await this.db.templates.put({ ...t, updatedAt: new Date().toISOString() });
	}
	async deleteTemplate(id: ID) {
		await this.db.templates.delete(id);
	}

	// --- sessions ---
	listSessions() {
		return this.db.sessions.orderBy('startedAt').reverse().toArray();
	}
	getSession(id: ID) {
		return this.db.sessions.get(id);
	}
	async upsertSession(s: WorkoutSession) {
		await this.db.sessions.put({ ...s, updatedAt: new Date().toISOString() });
	}
	async deleteSession(id: ID) {
		await this.db.sessions.delete(id);
	}
	async lastSessionForExercise(exerciseId: ID) {
		const all = await this.db.sessions.orderBy('startedAt').reverse().toArray();
		return all.find((s) => !!s.endedAt && s.exercises.some((e) => e.exerciseId === exerciseId));
	}

	// --- settings ---
	async getSettings() {
		const row = await this.db.settings.get(SETTINGS_KEY);
		if (!row) return { ...DEFAULT_SETTINGS };
		// merge over defaults so a row saved before a new field existed still has it
		const { id: _id, ...rest } = row;
		return { ...DEFAULT_SETTINGS, ...rest };
	}
	async saveSettings(s: Settings) {
		await this.db.settings.put({ ...s, id: SETTINGS_KEY });
	}

	async clearAll() {
		await Promise.all([this.db.exercises.clear(), this.db.templates.clear(), this.db.sessions.clear()]);
	}
}
