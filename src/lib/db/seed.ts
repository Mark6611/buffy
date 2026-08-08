// First-run seed: the real catalog and the four templates. Seeding is idempotent
// (skips once a run has completed).
//
// It USED to also write ~12 weeks of generated session history, so that history,
// KPIs, trends and auto-progression had something to draw. That backfired: the
// fabricated sessions are indistinguishable from real ones in History, and every
// stat, PR delta and progression curve a new user sees is measured against invented
// weights. New installs now start with an empty history and earn their charts.
// Existing installs still hold those 36 sessions, so the deterministic id set they
// were minted with is kept below to power Settings → "Remove sample data".
import type {
  Exercise,
  Template,
  TemplateExercise,
  PlannedSet,
  Settings,
  ID,
} from "$lib/types";
import type { Repository } from "./repository";

export const DEFAULT_SETTINGS: Settings = {
  defaultRestSec: 90,
  autoProgression: true,
  increments: { barbell: 2.5, dumbbellPerSide: 1, machinePin: 5 },
  hapticAtRestEnd: true,
  trackRpe: false, // opt-in: RPE (6–10) column on weight/reps sets
  writeToHealth: false, // opt-in — first toggle triggers the iOS permission prompt
  readRecoveryFromHealth: false, // opt-in — readiness + intensity from Health data
  cloudSyncEnabled: false, // opt-in — checks iCloud availability before turning on
};

// ---- Catalog ----------------------------------------------------------------
const EXERCISES: Exercise[] = [
  ex(
    "inc-bench",
    "Barbell Incline Bench Press",
    "barbell",
    ["Chest"],
    ["Triceps", "Shoulders"],
    "weight_reps",
    "total",
    { reps: 8, step: 2.5, rest: 90 }
  ),
  ex(
    "fly-high",
    "Cable Fly High",
    "cable",
    ["Chest"],
    [],
    "weight_reps",
    "per_side",
    { reps: 12, step: 1, rest: 60, uni: true, setup: "Fly High 16/18" }
  ),
  ex(
    "fly-low",
    "Cable Fly Low",
    "cable",
    ["Chest"],
    [],
    "weight_reps",
    "per_side",
    { reps: 11, step: 1, rest: 60, uni: true, setup: "Low Fly 4" }
  ),
  ex(
    "chest-press",
    "Machine Seated Chest Press",
    "machine",
    ["Chest"],
    ["Triceps"],
    "weight_reps",
    "total",
    { reps: 11, step: 5, rest: 120 }
  ),
  ex(
    "tricep-pushdown",
    "Cable Rope Tricep Pushdown",
    "cable",
    ["Triceps"],
    [],
    "weight_reps",
    "total",
    { reps: 10, step: 1, rest: 60 }
  ),
  ex(
    "lat-pulldown",
    "Machine Lat Pull Down Wide-Grip",
    "machine",
    ["Lats"],
    ["Biceps"],
    "weight_reps",
    "total",
    { reps: 8, step: 5, rest: 90 }
  ),
  ex(
    "seated-row",
    "Cable V-Handle Seated Row",
    "cable",
    ["Lats"],
    ["Biceps"],
    "weight_reps",
    "total",
    { reps: 10, step: 2.5, rest: 75 }
  ),
  ex(
    "straight-arm",
    "Cable Bar Straight Arm Pull Down",
    "cable",
    ["Lats"],
    [],
    "weight_reps",
    "total",
    { reps: 9, step: 2.5, rest: 75 }
  ),
  ex(
    "bicep-curl",
    "Dumbbell Bicep Curl",
    "dumbbell",
    ["Biceps"],
    [],
    "weight_reps",
    "per_side",
    { reps: 9, step: 1, rest: 90, uni: true }
  ),
  ex(
    "shoulder-press",
    "Dumbbell Shoulder Press",
    "dumbbell",
    ["Shoulders"],
    ["Triceps"],
    "weight_reps",
    "per_side",
    { reps: 10, step: 1, rest: 90, uni: true }
  ),
  ex(
    "lateral-raise",
    "Cable Lateral Raise",
    "cable",
    ["Shoulders"],
    [],
    "weight_reps",
    "total",
    { reps: 12, step: 1, rest: 45 }
  ),
  ex(
    "face-pull",
    "Cable Face Pull",
    "cable",
    ["Shoulders"],
    ["Traps"],
    "weight_reps",
    "total",
    { reps: 15, step: 1, rest: 45 }
  ),
  ex("plank", "Plank", "bodyweight", ["Abs"], [], "time_hold", "bodyweight", {
    rest: 60,
  }),
  ex(
    "leg-press",
    "Leg press",
    "machine",
    ["Quads"],
    ["Glutes"],
    "weight_reps",
    "total",
    { reps: 10, step: 5, rest: 120 }
  ),
  ex(
    "leg-extension",
    "Leg Extension",
    "machine",
    ["Quads"],
    [],
    "weight_reps",
    "total",
    { reps: 12, step: 5, rest: 75 }
  ),
  ex(
    "calf-raise",
    "Calves raise",
    "machine",
    ["Calves"],
    [],
    "weight_reps",
    "total",
    { reps: 12, step: 5, rest: 60 }
  ),
  ex(
    "kb-squat",
    "Kettlebell squat",
    "kettlebell",
    ["Quads"],
    ["Glutes", "Adductors"],
    "weight_reps",
    "total",
    { reps: 12, step: 2, rest: 90 }
  ),
  ex(
    "pullups",
    "Pull-ups",
    "bodyweight",
    ["Lats"],
    ["Biceps"],
    "weight_reps",
    "bodyweight",
    { reps: 10, rest: 90 }
  ),
  ex("treadmill", "Treadmill", "cardio", ["Cardio"], [], "cardio", "total", {
    rest: 0,
  }),
  // distance-mode cardio: logs metres + time, derives the /500m split
  ex(
    "rower",
    "Rowing Machine",
    "cardio",
    ["Lats"],
    ["Quads", "Biceps"],
    "cardio",
    "total",
    { rest: 60, cardio: "distance" }
  ),
];

function ex(
  id: ID,
  name: string,
  equipment: Exercise["equipment"],
  primaryMuscles: string[],
  secondaryMuscles: string[],
  trackingType: Exercise["trackingType"],
  loadType: Exercise["loadType"],
  o: {
    reps?: number;
    step?: number;
    rest?: number;
    uni?: boolean;
    setup?: string;
    cardio?: "speed" | "distance";
  }
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
    cardioMetric: o.cardio,
    weightStep: o.step,
    defaultRestSec: o.rest,
    setupNote: o.setup,
  };
}

// ---- Templates --------------------------------------------------------------
function planned(
  n: number,
  reps: number,
  weight: number,
  rest: number
): PlannedSet[] {
  return Array.from({ length: n }, () => ({
    targetReps: reps,
    targetWeight: weight,
    targetRestSec: rest,
  }));
}
function plannedTime(
  n: number,
  durationSec: number,
  rest: number
): PlannedSet[] {
  return Array.from({ length: n }, () => ({
    targetDurationSec: durationSec,
    targetRestSec: rest,
  }));
}
function te(
  exerciseId: ID,
  plannedSets: PlannedSet[],
  groupId?: ID,
  setupNote?: string
): TemplateExercise {
  return { exerciseId, plannedSets, groupId: groupId ?? null, setupNote };
}

function buildTemplates(iso: string): Template[] {
  const base = (
    id: ID,
    name: string,
    exercises: TemplateExercise[],
    groups: Template["groups"]
  ): Template => ({
    id,
    name,
    exercises,
    groups,
    createdAt: iso,
    updatedAt: iso,
  });

  return [
    base(
      "chest-tricep",
      "Chest Tricep",
      [
        te("inc-bench", planned(4, 8, 40, 90)),
        te("fly-high", planned(4, 12, 12.5, 60), "ss1", "Fly High 16/18"),
        te("fly-low", planned(4, 11, 5.7, 60), "ss1", "Low Fly 4"),
        te("chest-press", planned(4, 11, 40, 120)),
        te("tricep-pushdown", planned(4, 10, 17, 60)),
      ],
      [{ id: "ss1", restSec: 60 }]
    ),
    base(
      "back-bicep",
      "Back Bicep",
      [
        te("lat-pulldown", planned(4, 8, 45, 90)),
        te("seated-row", planned(4, 10, 45, 75)),
        te("straight-arm", planned(4, 9, 23, 75)),
        te("bicep-curl", planned(3, 9, 12, 90)),
      ],
      []
    ),
    base(
      "shoulder-core",
      "Shoulder Core",
      [
        te("shoulder-press", planned(4, 10, 12, 90)),
        te("lateral-raise", planned(4, 12, 7, 45), "ssh"),
        te("face-pull", planned(4, 15, 9, 45), "ssh"),
        te("plank", plannedTime(3, 45, 60)),
      ],
      [{ id: "ssh", restSec: 45 }]
    ),
    base(
      "legs",
      "Legs",
      [
        te("leg-press", planned(4, 10, 160, 120)),
        te("leg-extension", planned(4, 12, 55, 75)),
        te("calf-raise", planned(4, 12, 120, 60)),
        te("kb-squat", planned(3, 12, 20, 90)),
      ],
      []
    ),
  ];
}

// ---- Retired demo history ---------------------------------------------------
// No longer written (see the file header), but existing installs are full of it, so
// Settings needs to identify it EXACTLY in order to purge it without ever touching a
// real workout. Ids are the only reliable marker: a genuine session gets a newId(),
// and `sess-<template>-w<week>-d<day>` was only ever minted by the generator below.
//
// The loop must mirror the original generator exactly — it walked the four templates
// in round-robin across 12 weeks × 3 days, so only 36 of the 4×12×3 name combinations
// were ever produced (e.g. `sess-legs-w11-d2` never existed).
const DEMO_TEMPLATE_ORDER = [
  "chest-tricep",
  "back-bicep",
  "shoulder-core",
  "legs",
];
const DEMO_DAY_OFFSETS = [2, 4, 6]; // three days within each week

/** The 36 session ids the retired ~12-week demo history used to create. */
export function demoSessionIds(): ID[] {
  const ids: ID[] = [];
  let idx = 0;
  for (let w = 11; w >= 0; w--)
    for (const off of DEMO_DAY_OFFSETS)
      ids.push(
        `sess-${
          DEMO_TEMPLATE_ORDER[idx++ % DEMO_TEMPLATE_ORDER.length]
        }-w${w}-d${off}`
      );
  return ids;
}

const DEMO_SESSION_IDS = new Set<ID>(demoSessionIds());

/** True only for a session minted by the retired demo-history seed. */
export function isDemoSessionId(id: ID): boolean {
  return DEMO_SESSION_IDS.has(id);
}

// Every seed record shares this fixed, ancient updatedAt so that ANY genuine user
// action — always stamped `now` — beats it in last-write-wins, on both push and pull.
// Without this, a fresh install's seed (deterministic ids + updatedAt=now) would be
// "newer" than the same ids already in a user's iCloud from their first device, and
// would clobber real edits / resurrect deleted demo history on every device migration
// or reinstall. Written through applySynced* (the only path that preserves a caller's
// updatedAt); on the empty DB the seed runs against, those always write.
const SEED_EPOCH = "2000-01-01T00:00:00.000Z";

/** Marks a seed that ran to COMPLETION. The old guard — "are there any exercises?"
 *  — was true as soon as the first of the write phases finished, so a reload or
 *  app kill mid-seed left the catalog populated but the templates permanently
 *  missing: every later launch short-circuited on that guard.
 *  Re-running the seed is safe, so the fast path is allowed to be wrong-but-rare in
 *  only one direction (re-run), never in the other (skip an unfinished seed).
 *  The key stays at v1: bumping it would re-run the seed on every existing install,
 *  which achieves nothing now that only the catalog and templates are written. */
const SEED_DONE_KEY = "buffy:seeded:v1";

export async function seedDatabase(repo: Repository): Promise<void> {
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem(SEED_DONE_KEY))
      return;
  } catch {
    /* storage unavailable — fall through and re-run, which is harmless */
  }

  // Everything below is written through applySynced*, which only writes a record
  // that is strictly NEWER than what is stored. With SEED_EPOCH that means a
  // re-run fills in whatever is missing while never resurrecting a template the
  // user deleted (its tombstone is newer) and never clobbering an edit.

  for (const e of EXERCISES)
    await repo.applySyncedExercise({ ...e, updatedAt: SEED_EPOCH });

  const iso = new Date().toISOString();
  for (const t of buildTemplates(iso))
    await repo.applySyncedTemplate({ ...t, updatedAt: SEED_EPOCH });

  // NO sample sessions: history starts empty and is filled by real workouts.

  // Only now is the seed complete. Set last, so an interrupted run is retried.
  try {
    if (typeof localStorage !== "undefined")
      localStorage.setItem(SEED_DONE_KEY, "1");
  } catch {
    /* storage unavailable — the next launch simply re-runs the seed */
  }
}
