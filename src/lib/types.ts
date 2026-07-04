// Buffy data model.
// Storage-agnostic on purpose: these types describe what the repository reads and
// writes, independent of IndexedDB/Dexie — so the phase-2 swap stays a clean boundary.
//
// Conventions (from the design brief):
//  - timestamps are ISO strings, never Date objects
//  - weight is kg (decimals allowed); unit is fixed (no toggle)
//  - computed values (set/session volume, est. duration, cardio distance) are derived
//    at read time, never stored (see lib/compute.ts)

export type ID = string;

export type Equipment =
	| 'barbell'
	| 'dumbbell'
	| 'cable'
	| 'machine'
	| 'kettlebell'
	| 'bodyweight'
	| 'cardio';

export type TrackingType = 'weight_reps' | 'time_hold' | 'cardio';

/** For weight_reps exercises. `per_side` is the kg ×2 notation; `bodyweight` = reps only, no weight. */
export type LoadType = 'total' | 'per_side' | 'bodyweight';

export interface Exercise {
	id: ID;
	name: string;
	equipment: Equipment;
	primaryMuscles: string[];
	secondaryMuscles: string[];
	trackingType: TrackingType;
	loadType: LoadType; // meaningful for weight_reps; ignored for time_hold/cardio
	unilateral?: boolean;
	defaultTargetReps?: number;
	/** time_hold exercises: target hold duration — gates progression like defaultTargetReps */
	defaultTargetDurationSec?: number;
	/** per-exercise progression increment in kg (e.g. barbell 2.5, dumbbell-per-side 1, machine pin 5) */
	weightStep?: number;
	defaultRestSec?: number;
	/** machine/cable setup memo, e.g. "Fly High 16/18" */
	setupNote?: string;
	/** ISO — stamped by the repository on every write; powers iCloud sync merge */
	updatedAt?: string;
	/** ISO tombstone — set instead of hard-deleting so deletes propagate through
	 *  sync (last-write-wins) instead of resurrecting. Hidden from all lists. */
	deletedAt?: string;
}

/** A planned set inside a template. Which fields apply depends on the exercise's trackingType. */
export interface PlannedSet {
	targetReps?: number; // weight_reps
	targetWeight?: number; // weight_reps (kg)
	targetDurationSec?: number; // time_hold
	targetTimeSec?: number; // cardio
	targetIncline?: number; // cardio (%)
	targetSpeed?: number; // cardio (km/h, optional)
	targetRestSec?: number; // seeds the rest countdown
}

export interface TemplateExercise {
	exerciseId: ID;
	/** superset membership; null/undefined = standalone */
	groupId?: ID | null;
	/** per-template override of the exercise's setup note */
	setupNote?: string;
	plannedSets: PlannedSet[];
}

/** A superset group: members run as a round with NO within-round rest; rest fires only after the round. */
export interface SupersetGroup {
	id: ID;
	restSec: number;
}

export interface Template {
	id: ID;
	name: string;
	coverImage?: string;
	notes?: string;
	exercises: TemplateExercise[];
	groups: SupersetGroup[];
	createdAt: string; // ISO
	updatedAt: string; // ISO
	/** ISO tombstone — see Exercise.deletedAt */
	deletedAt?: string;
	// muscles / equipment / estimated duration are DERIVED at read time (compute.ts)
}

export interface LoggedSet {
	index: number;
	completed: boolean;
	// weight_reps
	weight?: number;
	reps?: number;
	perSide?: boolean;
	// time_hold
	durationSec?: number;
	// cardio (distance is derived from speed × time, never stored)
	timeSec?: number;
	incline?: number;
	speed?: number;
	// shared
	restTakenSec?: number; // measured by the rest timer, including overage
	note?: string;
}

export interface LoggedExercise {
	exerciseId: ID;
	groupId?: ID | null;
	setupNote?: string;
	sets: LoggedSet[];
}

export interface WorkoutSession {
	id: ID;
	startedAt: string; // ISO
	endedAt?: string; // ISO
	/** source template, or null for an ad-hoc (quick-log) session */
	sourceTemplateId?: ID | null;
	title?: string;
	exercises: LoggedExercise[];
	note?: string;
	/** Measured heart-rate summary for this session (from Apple Health, e.g. a Whoop
	 *  strap) — stored, not derived: Buffy's own records can't reproduce it. Absent
	 *  when HR reading is off or no samples covered the workout window. */
	intensity?: {
		/** avg % heart-rate reserve, 0–100 */
		score: number;
		band: 'easy' | 'moderate' | 'hard' | 'maximal';
		avgHr: number;
		peakHr: number;
		/** fraction of time per %HRR zone */
		zones: { z1: number; z2: number; z3: number; z4: number; z5: number };
	};
	/** Matched Whoop workout (official API) — measured externally, so stored.
	 *  strain is Whoop's 0–21 scale; kilojoule is gross session energy. */
	whoop?: { strain: number; avgHr: number; maxHr: number; kilojoule?: number; durationSec?: number };
	/** Estimated active calories for the session — stored with its method so the
	 *  UI can label provenance ('whoop' measured > 'hr' Keytel > 'met' floor). */
	calories?: { kcal: number; method: 'whoop' | 'hr' | 'met' };
	/** ISO — stamped by the repository on every write; powers iCloud sync merge */
	updatedAt?: string;
	/** ISO tombstone — see Exercise.deletedAt */
	deletedAt?: string;
}

export interface ProgressionIncrements {
	barbell: number;
	dumbbellPerSide: number;
	machinePin: number;
}

export interface Settings {
	defaultRestSec: number;
	autoProgression: boolean;
	increments: ProgressionIncrements;
	hapticAtRestEnd: boolean;
	writeToHealth: boolean;
	/** read HRV / resting HR / sleep / workout heart rate from Apple Health (e.g.
	 *  written there by Whoop) to power readiness + workout intensity */
	readRecoveryFromHealth: boolean;
	/** max heart rate for intensity zones — unset falls back to an estimate */
	maxHr?: number;
	/** profile for calorie estimation (all optional — estimates degrade gracefully) */
	sex?: 'male' | 'female';
	birthYear?: number;
	/** manual body-weight override; unset prefers the latest Health sample */
	bodyWeightKg?: number;
	cloudSyncEnabled: boolean;
	// weight unit is always kg (fixed) — no field needed
}
