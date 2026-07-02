// Syncing a finished workout back into its source template (or saving a fresh
// one from a quick-log session). Pure and testable — the route wires these into
// repo.upsertTemplate; nothing here touches storage directly.
import type { Exercise, LoggedExercise, PlannedSet, Template, TemplateExercise, WorkoutSession } from '$lib/types';
import { newId } from '$lib/id';

/** Map a finished session's logged (completed-only) sets into template shape.
 *  Rest target prefers what was actually taken; falls back to the exercise's
 *  default for sets that never triggered a rest (e.g. mid-superset-round). */
function loggedExerciseToTemplateExercise(le: LoggedExercise, exById: Map<string, Exercise>): TemplateExercise {
	const ex = exById.get(le.exerciseId);
	const plannedSets: PlannedSet[] = le.sets.map((s) => ({
		targetReps: s.reps,
		targetWeight: s.weight,
		targetDurationSec: s.durationSec,
		targetTimeSec: s.timeSec,
		targetIncline: s.incline,
		targetSpeed: s.speed,
		targetRestSec: s.restTakenSec ?? ex?.defaultRestSec
	}));
	return { exerciseId: le.exerciseId, groupId: le.groupId ?? null, setupNote: le.setupNote, plannedSets };
}

/** "Update whole template" — replace the exercise/set structure with exactly what was
 *  done this session. Superset groupings are preserved via the template's existing
 *  `groups` (workouts can only drop group members mid-session, never invent new ones). */
export function applyFullSync(template: Template, session: WorkoutSession, exById: Map<string, Exercise>): Template {
	return {
		...template,
		exercises: session.exercises.map((le) => loggedExerciseToTemplateExercise(le, exById)),
		updatedAt: new Date().toISOString()
	};
}

/** "Update weights only" — touch numeric targets on sets that still exist in the
 *  template, matched by exercise + set index. Never changes the exercise list, set
 *  counts, rest targets, or grouping — those stay exactly as the template had them. */
export function applyWeightsOnlySync(template: Template, session: WorkoutSession): Template {
	// The same exercise can appear twice in a session (the workout store allows
	// it), so pair by occurrence order — 1st template occurrence takes the 1st
	// session occurrence's numbers, 2nd takes the 2nd — never collapse by id.
	const queues = new Map<string, LoggedExercise[]>();
	for (const le of session.exercises) {
		const q = queues.get(le.exerciseId);
		if (q) q.push(le);
		else queues.set(le.exerciseId, [le]);
	}
	const exercises = template.exercises.map((tex) => {
		const le = queues.get(tex.exerciseId)?.shift();
		if (!le) return tex;
		const plannedSets = tex.plannedSets.map((ps, i) => {
			const set = le.sets[i];
			if (!set) return ps;
			return {
				...ps,
				targetReps: set.reps ?? ps.targetReps,
				targetWeight: set.weight ?? ps.targetWeight,
				targetDurationSec: set.durationSec ?? ps.targetDurationSec,
				targetTimeSec: set.timeSec ?? ps.targetTimeSec,
				targetIncline: set.incline ?? ps.targetIncline,
				targetSpeed: set.speed ?? ps.targetSpeed
			};
		});
		return { ...tex, plannedSets };
	});
	return { ...template, exercises, updatedAt: new Date().toISOString() };
}

/** Build a brand-new template from a finished quick-log session. */
export function buildTemplateFromSession(session: WorkoutSession, exById: Map<string, Exercise>, name: string): Template {
	const now = new Date().toISOString();
	return {
		id: newId(),
		name,
		exercises: session.exercises.map((le) => loggedExerciseToTemplateExercise(le, exById)),
		groups: [], // quick-log never groups exercises today — no UI path creates a groupId
		createdAt: now,
		updatedAt: now
	};
}
