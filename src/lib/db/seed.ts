// First-run seed: the real catalog, the four templates, and a few logged sessions
// (so history, KPIs, and auto-progression "last time" anchors have real data).
// Values echo the reference screenshots. Seeding is idempotent (skips if non-empty).
import type {
	Exercise,
	Template,
	TemplateExercise,
	PlannedSet,
	WorkoutSession,
	LoggedExercise,
	LoggedSet,
	Settings,
	ID
} from '$lib/types';
import type { Repository } from './repository';
import { parseMmss } from '$lib/format';

export const DEFAULT_SETTINGS: Settings = {
	defaultRestSec: 90,
	autoProgression: true,
	increments: { barbell: 2.5, dumbbellPerSide: 1, machinePin: 5 },
	hapticAtRestEnd: true
};

// ---- Catalog ----------------------------------------------------------------
const EXERCISES: Exercise[] = [
	ex('inc-bench', 'Barbell Incline Bench Press', 'barbell', ['Chest'], ['Triceps', 'Shoulders'], 'weight_reps', 'total', { reps: 8, step: 2.5, rest: 90 }),
	ex('fly-high', 'Cable Fly High', 'cable', ['Chest'], [], 'weight_reps', 'per_side', { reps: 12, step: 1, rest: 60, uni: true, setup: 'Fly High 16/18' }),
	ex('fly-low', 'Cable Fly Low', 'cable', ['Chest'], [], 'weight_reps', 'per_side', { reps: 11, step: 1, rest: 60, uni: true, setup: 'Low Fly 4' }),
	ex('chest-press', 'Machine Seated Chest Press', 'machine', ['Chest'], ['Triceps'], 'weight_reps', 'total', { reps: 11, step: 5, rest: 120 }),
	ex('tricep-pushdown', 'Cable Rope Tricep Pushdown', 'cable', ['Triceps'], [], 'weight_reps', 'total', { reps: 10, step: 1, rest: 60 }),
	ex('lat-pulldown', 'Machine Lat Pull Down Wide-Grip', 'machine', ['Lats'], ['Biceps'], 'weight_reps', 'total', { reps: 8, step: 5, rest: 90 }),
	ex('seated-row', 'Cable V-Handle Seated Row', 'cable', ['Lats'], ['Biceps'], 'weight_reps', 'total', { reps: 10, step: 2.5, rest: 75 }),
	ex('straight-arm', 'Cable Bar Straight Arm Pull Down', 'cable', ['Lats'], [], 'weight_reps', 'total', { reps: 9, step: 2.5, rest: 75 }),
	ex('bicep-curl', 'Dumbbell Bicep Curl', 'dumbbell', ['Biceps'], [], 'weight_reps', 'per_side', { reps: 9, step: 1, rest: 90, uni: true }),
	ex('shoulder-press', 'Dumbbell Shoulder Press', 'dumbbell', ['Shoulders'], ['Triceps'], 'weight_reps', 'per_side', { reps: 10, step: 1, rest: 90, uni: true }),
	ex('lateral-raise', 'Cable Lateral Raise', 'cable', ['Shoulders'], [], 'weight_reps', 'total', { reps: 12, step: 1, rest: 45 }),
	ex('face-pull', 'Cable Face Pull', 'cable', ['Shoulders'], ['Traps'], 'weight_reps', 'total', { reps: 15, step: 1, rest: 45 }),
	ex('plank', 'Plank', 'bodyweight', ['Abs'], [], 'time_hold', 'bodyweight', { rest: 60 }),
	ex('leg-press', 'Leg press', 'machine', ['Quads'], ['Glutes'], 'weight_reps', 'total', { reps: 10, step: 5, rest: 120 }),
	ex('leg-extension', 'Leg Extension', 'machine', ['Quads'], [], 'weight_reps', 'total', { reps: 12, step: 5, rest: 75 }),
	ex('calf-raise', 'Calves raise', 'machine', ['Calves'], [], 'weight_reps', 'total', { reps: 12, step: 5, rest: 60 }),
	ex('kb-squat', 'Kettlebell squat', 'kettlebell', ['Quads'], ['Glutes', 'Adductors'], 'weight_reps', 'total', { reps: 12, step: 2, rest: 90 }),
	ex('pullups', 'Pull-ups', 'bodyweight', ['Lats'], ['Biceps'], 'weight_reps', 'bodyweight', { reps: 10, rest: 90 }),
	ex('treadmill', 'Treadmill', 'cardio', ['Cardio'], [], 'cardio', 'total', { rest: 0 })
];

function ex(
	id: ID,
	name: string,
	equipment: Exercise['equipment'],
	primaryMuscles: string[],
	secondaryMuscles: string[],
	trackingType: Exercise['trackingType'],
	loadType: Exercise['loadType'],
	o: { reps?: number; step?: number; rest?: number; uni?: boolean; setup?: string }
): Exercise {
	return {
		id,
		name,
		equipment,
		primaryMuscles,
		secondaryMuscles,
		trackingType,
		loadType,
		unilateral: o.uni,
		defaultTargetReps: o.reps,
		weightStep: o.step,
		defaultRestSec: o.rest,
		setupNote: o.setup
	};
}

// ---- Templates --------------------------------------------------------------
function planned(n: number, reps: number, weight: number, rest: number): PlannedSet[] {
	return Array.from({ length: n }, () => ({ targetReps: reps, targetWeight: weight, targetRestSec: rest }));
}
function plannedTime(n: number, durationSec: number, rest: number): PlannedSet[] {
	return Array.from({ length: n }, () => ({ targetDurationSec: durationSec, targetRestSec: rest }));
}
function te(exerciseId: ID, plannedSets: PlannedSet[], groupId?: ID, setupNote?: string): TemplateExercise {
	return { exerciseId, plannedSets, groupId: groupId ?? null, setupNote };
}

function buildTemplates(iso: string): Template[] {
	const base = (id: ID, name: string, exercises: TemplateExercise[], groups: Template['groups']): Template => ({
		id,
		name,
		exercises,
		groups,
		createdAt: iso,
		updatedAt: iso
	});

	return [
		base(
			'chest-tricep',
			'Chest Tricep',
			[
				te('inc-bench', planned(4, 8, 40, 90)),
				te('fly-high', planned(4, 12, 12.5, 60), 'ss1', 'Fly High 16/18'),
				te('fly-low', planned(4, 11, 5.7, 60), 'ss1', 'Low Fly 4'),
				te('chest-press', planned(4, 11, 40, 120)),
				te('tricep-pushdown', planned(4, 10, 17, 60))
			],
			[{ id: 'ss1', restSec: 60 }]
		),
		base(
			'back-bicep',
			'Back Bicep',
			[
				te('lat-pulldown', planned(4, 8, 45, 90)),
				te('seated-row', planned(4, 10, 45, 75)),
				te('straight-arm', planned(4, 9, 23, 75)),
				te('bicep-curl', planned(3, 9, 12, 90))
			],
			[]
		),
		base(
			'shoulder-core',
			'Shoulder Core',
			[
				te('shoulder-press', planned(4, 10, 12, 90)),
				te('lateral-raise', planned(4, 12, 7, 45), 'ssh'),
				te('face-pull', planned(4, 15, 9, 45), 'ssh'),
				te('plank', plannedTime(3, 45, 60))
			],
			[{ id: 'ssh', restSec: 45 }]
		),
		base(
			'legs',
			'Legs',
			[
				te('leg-press', planned(4, 10, 160, 120)),
				te('leg-extension', planned(4, 12, 55, 75)),
				te('calf-raise', planned(4, 12, 120, 60)),
				te('kb-squat', planned(3, 12, 20, 90))
			],
			[]
		)
	];
}

// ---- Sessions (history) -----------------------------------------------------
type Row = [rest: string, reps: number, weight?: number];

function loggedFromRows(exerciseId: ID, rows: Row[], perSide: boolean, groupId?: ID, setupNote?: string): LoggedExercise {
	const sets: LoggedSet[] = rows.map((r, i) => ({
		index: i,
		completed: true,
		reps: r[1],
		weight: r[2],
		perSide: r[2] != null ? perSide : undefined,
		restTakenSec: parseMmss(r[0])
	}));
	return { exerciseId, groupId: groupId ?? null, setupNote, sets };
}

/** Build a logged session straight from a template's planned sets (all completed at target). */
function loggedFromTemplate(t: Template): LoggedExercise[] {
	return t.exercises.map((tex) => ({
		exerciseId: tex.exerciseId,
		groupId: tex.groupId ?? null,
		setupNote: tex.setupNote,
		sets: tex.plannedSets.map((ps, i) => ({
			index: i,
			completed: true,
			reps: ps.targetReps,
			weight: ps.targetWeight,
			durationSec: ps.targetDurationSec,
			perSide: ps.targetWeight != null ? isPerSide(tex.exerciseId) : undefined,
			restTakenSec: ps.targetRestSec
		}))
	}));
}
const PER_SIDE_IDS = new Set(['fly-high', 'fly-low', 'bicep-curl', 'shoulder-press']);
function isPerSide(id: ID): boolean {
	return PER_SIDE_IDS.has(id);
}

function daysAgoIso(now: number, days: number, plusMin = 0): string {
	return new Date(now - days * 86_400_000 + plusMin * 60_000).toISOString();
}

function buildSessions(now: number, templates: Template[]): WorkoutSession[] {
	const byId = new Map(templates.map((t) => [t.id, t]));

	// 1) Chest Tricep — full actuals from the reference logs (powers auto-progression)
	const chest: WorkoutSession = {
		id: 'sess-chest-1',
		startedAt: daysAgoIso(now, 5),
		endedAt: daysAgoIso(now, 5, 47),
		sourceTemplateId: 'chest-tricep',
		title: 'Chest Tricep',
		note: 'Felt strong — PR on incline. Cable height ok.',
		exercises: [
			loggedFromRows('inc-bench', [['—', 13, 20], ['01:00', 8, 40], ['01:45', 8, 40], ['01:15', 8, 40]], false),
			loggedFromRows('fly-high', [['—', 12, 12.5], ['00:59', 11, 12.5], ['00:59', 11, 12.5], ['01:00', 12, 12.5]], true, 'ss1', 'Fly High 16/18'),
			loggedFromRows('fly-low', [['00:59', 13, 3.7], ['00:55', 10, 5.7], ['01:00', 10, 5.7], ['01:00', 9, 5.7]], true, 'ss1', 'Low Fly 4'),
			loggedFromRows('chest-press', [['06:00', 12, 40], ['04:30', 8, 40], ['—', 11, 40], ['01:30', 11, 40]], false),
			loggedFromRows('tricep-pushdown', [['04:59', 10, 14.7], ['00:59', 10, 17], ['01:09', 8, 17], ['00:45', 8, 7.9]], false)
		]
	};

	// 2) Back Bicep — at target
	const back: WorkoutSession = {
		id: 'sess-back-1',
		startedAt: daysAgoIso(now, 2),
		endedAt: daysAgoIso(now, 2, 32),
		sourceTemplateId: 'back-bicep',
		title: 'Back Bicep',
		exercises: loggedFromTemplate(byId.get('back-bicep')!)
	};

	// 3) Legs — at target, last week
	const legs: WorkoutSession = {
		id: 'sess-legs-1',
		startedAt: daysAgoIso(now, 8),
		endedAt: daysAgoIso(now, 8, 72),
		sourceTemplateId: 'legs',
		title: 'Legs',
		exercises: loggedFromTemplate(byId.get('legs')!)
	};

	return [chest, back, legs];
}

// ---- Entry point ------------------------------------------------------------
export async function seedDatabase(repo: Repository): Promise<void> {
	const existing = await repo.listExercises();
	if (existing.length > 0) return; // already seeded

	for (const e of EXERCISES) await repo.upsertExercise(e);

	const now = Date.now();
	const iso = new Date(now).toISOString();
	const templates = buildTemplates(iso);
	for (const t of templates) await repo.upsertTemplate(t);

	for (const s of buildSessions(now, templates)) await repo.upsertSession(s);
}
