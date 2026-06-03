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
	/** per-exercise progression increment in kg (e.g. barbell 2.5, dumbbell-per-side 1, machine pin 5) */
	weightStep?: number;
	defaultRestSec?: number;
	/** machine/cable setup memo, e.g. "Fly High 16/18" */
	setupNote?: string;
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
	// weight unit is always kg (fixed) — no field needed
}
