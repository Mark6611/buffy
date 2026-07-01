// First-run seed: the real catalog, the four templates, and ~12 weeks of generated
// session history (so history, KPIs, trends, and auto-progression have real data).
// Seeding is idempotent (skips if non-empty).
import type {
	Exercise,
	Template,
	TemplateExercise,
	PlannedSet,
	WorkoutSession,
	LoggedExercise,
	Settings,
	ID
} from '$lib/types';
import type { Repository } from './repository';

export const DEFAULT_SETTINGS: Settings = {
	defaultRestSec: 90,
	autoProgression: true,
	increments: { barbell: 2.5, dumbbellPerSide: 1, machinePin: 5 },
	hapticAtRestEnd: true,
	writeToHealth: false, // opt-in — first toggle triggers the iOS permission prompt
	cloudSyncEnabled: false // opt-in — checks iCloud availability before turning on
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
const PER_SIDE_IDS = new Set(['fly-high', 'fly-low', 'bicep-curl', 'shoulder-press']);
function isPerSide(id: ID): boolean {
	return PER_SIDE_IDS.has(id);
}

function daysAgoIso(now: number, days: number, plusMin = 0): string {
	return new Date(now - days * 86_400_000 + plusMin * 60_000).toISOString();
}

/** Logged exercises from a template's planned sets, with progressive overload applied. */
function loggedProgression(t: Template, bumps: number, exById: Map<string, Exercise>): LoggedExercise[] {
	return t.exercises.map((tex) => {
		const ex = exById.get(tex.exerciseId);
		const step = ex?.weightStep ?? 2.5;
		return {
			exerciseId: tex.exerciseId,
			groupId: tex.groupId ?? null,
			setupNote: tex.setupNote,
			sets: tex.plannedSets.map((ps, i) => ({
				index: i,
				completed: true,
				reps: ps.targetReps,
				weight: ps.targetWeight != null ? Math.round((ps.targetWeight + step * bumps) * 10) / 10 : undefined,
				durationSec: ps.targetDurationSec != null ? ps.targetDurationSec + bumps * 3 : undefined,
				perSide: ps.targetWeight != null ? isPerSide(tex.exerciseId) : undefined,
				restTakenSec: ps.targetRestSec
			}))
		};
	});
}

/** ~12 weeks of history — 3 sessions/week cycling the four templates, weights climbing over time. */
function buildSessions(now: number, templates: Template[], exById: Map<string, Exercise>): WorkoutSession[] {
	const tplById = new Map(templates.map((t) => [t.id, t]));
	const order = ['chest-tricep', 'back-bicep', 'shoulder-core', 'legs'];
	const dayOffsets = [2, 4, 6]; // three days within each week
	const sessions: WorkoutSession[] = [];
	let idx = 0;
	for (let w = 11; w >= 0; w--) {
		for (const off of dayOffsets) {
			const tpl = tplById.get(order[idx % order.length]);
			idx++;
			if (!tpl) continue;
			const daysAgo = w * 7 + (7 - off);
			const bumps = Math.floor((11 - w) / 3); // climbs 0 → 3 across the window
			sessions.push({
				id: `sess-${tpl.id}-w${w}-d${off}`,
				startedAt: daysAgoIso(now, daysAgo),
				endedAt: daysAgoIso(now, daysAgo, 45),
				sourceTemplateId: tpl.id,
				title: tpl.name,
				exercises: loggedProgression(tpl, bumps, exById)
			});
		}
	}
	return sessions;
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

	for (const s of buildSessions(now, templates, new Map(EXERCISES.map((e) => [e.id, e])))) await repo.upsertSession(s);
}
