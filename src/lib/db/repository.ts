// The repository boundary.
//
// Every component and store talks to THIS interface — never to Dexie/IndexedDB
// directly. That keeps storage swappable: phase 2 can drop in a Supabase-backed
// implementation without touching any UI. (Same boundary pattern as the coffee app.)
//
// The concrete Dexie implementation lives in ./dexie.ts; get the singleton via ./index.ts.

import type { Exercise, Template, WorkoutSession, Settings, ID } from '$lib/types';

export interface Repository {
	// Deletes are TOMBSTONES, not row removals: deleteX stamps deletedAt (and bumps
	// updatedAt) so the deletion itself syncs across devices via the same
	// last-write-wins path as any edit — a hard row delete would just get
	// resurrected by the next pull. listX/getX hide tombstoned records; only the
	// listXForSync methods below still see them.

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

	// --- iCloud sync only ---
	// Sync needs the raw truth including tombstones: a tombstoned record must still
	// be pushed (that's how the delete reaches other devices), and a tombstone that
	// were invisible here would make the remote's live copy look "locally missing"
	// and resurrect it. Never use these for UI.
	listExercisesForSync(): Promise<Exercise[]>;
	listTemplatesForSync(): Promise<Template[]>;
	listSessionsForSync(): Promise<WorkoutSession[]>;

	// Every upsertX above always stamps updatedAt = now, because a normal write IS a
	// fresh local edit. Applying a record PULLED from iCloud is different: its
	// updatedAt is the very thing last-write-wins compares across devices, so writing
	// it through upsertX would re-stamp it "now" on every device and make every synced
	// record look like it just changed everywhere — breaking the comparison it's meant
	// to power. These three preserve the timestamp exactly as given.
	//
	// They also enforce freshness AT THE WRITE: the record is only stored if it is
	// strictly newer than whatever is in the DB at that moment. The sync pass plans
	// its merge against a snapshot taken before a network round trip; without this
	// guard, an edit made during that window could be clobbered by a remote record
	// that beat the snapshot but is older than the edit.
	applySyncedExercise(ex: Exercise): Promise<void>;
	applySyncedTemplate(t: Template): Promise<void>;
	applySyncedSession(s: WorkoutSession): Promise<void>;
}
