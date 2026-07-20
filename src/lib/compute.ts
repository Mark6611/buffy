// Read-time derivations. Per the brief, these are NEVER stored — always computed
// from the logged/planned data when needed.
import type { Exercise, LoggedSet, Template, WorkoutSession } from "$lib/types";

/** kg lifted in one set = weight × reps × (2 if loaded per side). */
export function setVolume(s: LoggedSet): number {
  if (s.weight == null || s.reps == null) return 0;
  return s.weight * s.reps * (s.perSide ? 2 : 1);
}

export function exerciseVolume(sets: LoggedSet[]): number {
  return sets.reduce((a, s) => a + setVolume(s), 0);
}

export function sessionVolume(s: WorkoutSession): number {
  return s.exercises.reduce((a, e) => a + exerciseVolume(e.sets), 0);
}

/** completed sets only */
export function sessionSetCount(s: WorkoutSession): number {
  return s.exercises.reduce(
    (a, e) => a + e.sets.filter((x) => x.completed).length,
    0
  );
}

export function sessionDurationSec(s: WorkoutSession): number | undefined {
  if (!s.endedAt) return undefined;
  return Math.max(0, (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000);
}

/** Distance covered in a cardio set, km. Prefers directly-logged metres (erg / rower /
 *  bike — distance mode); else derives from speed(km/h) × time (treadmill). Never stored. */
export function cardioDistanceKm(s: LoggedSet): number | undefined {
  if (s.distanceMeters != null) return s.distanceMeters / 1000;
  if (s.speed != null && s.timeSec != null) return (s.speed * s.timeSec) / 3600;
  return undefined;
}

/** Seconds per 500 m — the canonical rowing/erg split — from time + distance. */
export function cardioSplit500Sec(s: LoggedSet): number | undefined {
  const km = cardioDistanceKm(s);
  if (km == null || km <= 0 || s.timeSec == null || s.timeSec <= 0)
    return undefined;
  return (s.timeSec * 0.5) / km; // 0.5 km = 500 m
}

/** Seconds per km — running pace — from time + distance. */
export function cardioPaceSecPerKm(s: LoggedSet): number | undefined {
  const km = cardioDistanceKm(s);
  if (km == null || km <= 0 || s.timeSec == null || s.timeSec <= 0)
    return undefined;
  return s.timeSec / km;
}

export interface TemplateDerived {
  muscles: string[];
  equipment: Exercise["equipment"][];
  setCount: number;
  estDurationSec: number;
}

/** Muscles / equipment / estimated duration derived from a template's exercises. */
export function templateDerived(
  t: Template,
  byId: Map<string, Exercise>
): TemplateDerived {
  const muscles = new Set<string>();
  const equipment = new Set<Exercise["equipment"]>();
  let setCount = 0;
  let seconds = 0;
  const WORK_PER_SET_SEC = 35;

  for (const te of t.exercises) {
    const ex = byId.get(te.exerciseId);
    if (!ex) continue;
    ex.primaryMuscles.forEach((m) => muscles.add(m));
    equipment.add(ex.equipment);
    for (const ps of te.plannedSets) {
      setCount++;
      seconds +=
        WORK_PER_SET_SEC + (ps.targetRestSec ?? ex.defaultRestSec ?? 60);
    }
  }
  return {
    muscles: [...muscles],
    equipment: [...equipment],
    setCount,
    estDurationSec: seconds,
  };
}
