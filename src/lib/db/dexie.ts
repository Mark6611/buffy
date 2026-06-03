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
		this.version(1).stores({
			exercises: 'id, name, equipment, trackingType',
			templates: 'id, name, updatedAt',
			sessions: 'id, startedAt, sourceTemplateId',
			settings: 'id'
		});
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
		await this.db.exercises.put(ex);
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
		await this.db.templates.put(t);
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
		await this.db.sessions.put(s);
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
		const { id: _id, ...rest } = row;
		return rest;
	}
	async saveSettings(s: Settings) {
		await this.db.settings.put({ ...s, id: SETTINGS_KEY });
	}

	async clearAll() {
		await Promise.all([this.db.exercises.clear(), this.db.templates.clear(), this.db.sessions.clear()]);
	}
}
