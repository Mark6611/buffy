// The repository boundary.
//
// Every component and store talks to THIS interface — never to Dexie/IndexedDB
// directly. That keeps storage swappable: phase 2 can drop in a Supabase-backed
// implementation without touching any UI. (Same boundary pattern as the coffee app.)
//
// The concrete Dexie implementation lives in ./dexie.ts; get the singleton via ./index.ts.

import type { Exercise, Template, WorkoutSession, Settings, ID } from '$lib/types';

export interface Repository {
	// --- exercises (catalog) ---
	listExercises(): Promise<Exercise[]>;
	getExercise(id: ID): Promise<Exercise | undefined>;
	upsertExercise(ex: Exercise): Promise<void>;
	deleteExercise(id: ID): Promise<void>;

	// --- templates ---
	listTemplates(): Promise<Template[]>;
	getTemplate(id: ID): Promise<Template | undefined>;
	upsertTemplate(t: Template): Promise<void>;
	deleteTemplate(id: ID): Promise<void>;

	// --- workout sessions (history) ---
	/** newest first */
	listSessions(): Promise<WorkoutSession[]>;
	getSession(id: ID): Promise<WorkoutSession | undefined>;
	upsertSession(s: WorkoutSession): Promise<void>;
	deleteSession(id: ID): Promise<void>;
	/** most recent session that logged this exercise — powers auto-progression "last time" anchors */
	lastSessionForExercise(exerciseId: ID): Promise<WorkoutSession | undefined>;

	// --- settings (singleton) ---
	getSettings(): Promise<Settings>;
	saveSettings(s: Settings): Promise<void>;

	/** wipe all exercises, templates and sessions (used by restore → replace) */
	clearAll(): Promise<void>;
}
