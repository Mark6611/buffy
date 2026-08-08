// Draft state for the template editor. Edits a working copy; commits via save().
import { getRepository } from "$lib/db";
import { newId } from "$lib/id";
import type {
  Exercise,
  PlannedSet,
  Template,
  TemplateExercise,
} from "$lib/types";

function defaultSets(ex: Exercise): PlannedSet[] {
  const rest = ex.defaultRestSec ?? 90;
  if (ex.trackingType === "time_hold")
    return Array.from({ length: 3 }, () => ({
      targetDurationSec: 45,
      targetRestSec: rest,
    }));
  if (ex.trackingType === "cardio")
    return ex.cardioMetric === "distance"
      ? [
          {
            targetTimeSec: 480,
            targetDistanceMeters: 2000,
            targetRestSec: rest,
          },
        ]
      : [
          {
            targetTimeSec: 600,
            targetIncline: 6,
            targetSpeed: 6,
            targetRestSec: 0,
          },
        ];
  // Deliberately NO targetWeight. This used to be a flat 20 kg for every exercise,
  // which reads as a recommendation the app never actually made. Blank is honest;
  // addExercise then fills it in from the last session that logged this exercise,
  // if there is one.
  return Array.from({ length: 4 }, () => ({
    targetReps: ex.defaultTargetReps ?? 10,
    targetRestSec: rest,
  }));
}

/**
 * Deep-copy a template into a new, independent one ("<name> copy").
 *
 * plannedSets AND superset group ids are copied fresh: a shallow copy would leave
 * both templates sharing the same PlannedSet objects — editing the copy's weights
 * would silently edit the original's — and sharing group ids means an ungroup in one
 * template reuses an id the other still owns.
 */
export function duplicateTemplate(t: Template): Template {
  const iso = new Date().toISOString();
  const src = structuredClone(t) as Template;
  const gid = new Map(src.groups.map((g) => [g.id, newId()]));
  const copy: Template = {
    ...src,
    id: newId(),
    name: `${src.name} copy`,
    createdAt: iso,
    updatedAt: iso,
    exercises: src.exercises.map((e) => ({
      ...e,
      groupId: e.groupId ? (gid.get(e.groupId) ?? e.groupId) : e.groupId,
    })),
    groups: src.groups.map((g) => ({ ...g, id: gid.get(g.id)! })),
  };
  delete copy.deletedAt; // a copy is a live template, never born tombstoned
  return copy;
}

class EditorStore {
  draft = $state<Template | null>(null);
  meta = $state<Record<string, Exercise>>({});
  selection = $state<Set<number>>(new Set());
  /** True while the draft has never been written to the DB. The "create a custom
   *  exercise" detour re-enters the editor under the draft's OWN uuid rather than
   *  'new', so the route id alone no longer tells the screen which mode it is in. */
  isNew = $state(false);
  private loadedFor: string | null = null;
  /**
   * Set true ONLY right before navigating to the picker (see the edit page), so the
   * in-progress draft survives that one round-trip. Every other re-entry into the
   * editor rebuilds from the DB (or fresh for 'new') — otherwise the singleton draft
   * persists after save/abandon and the next "New" reopens (and Save overwrites) the
   * previous template instead of creating a second one.
   */
  keepDraft = false;

  async load(id: string) {
    // Accept EITHER identity — the route id we were loaded for, OR the draft's own
    // id. A brand-new template is loaded for 'new' but carries a freshly minted
    // uuid, and the "create a custom exercise" detour comes back through
    // /template/<uuid>/edit (exercise/new/+page.svelte). Matching loadedFor alone
    // missed that re-entry and threw the whole draft away for a template the DB has
    // never seen, leaving a blank editor and a dead Save button.
    //
    // Written as nested ifs ON PURPOSE. Do NOT fold this into
    // `this.draft && this.keepDraft && (this.loadedFor === id || this.draft.id === id)`:
    // svelte 5.56's module compiler strips the parentheses around an `||` group inside
    // an `&&` chain, so that one-liner compiles to `… && this.loadedFor === id ||
    // this.draft.id === id` and dereferences a null draft. (Same compiler quirk that
    // bit this app family before.)
    if (this.draft && this.keepDraft) {
      const sameDraft = this.loadedFor === id || this.draft.id === id;
      if (sameDraft) {
        this.keepDraft = false;
        this.loadedFor = id;
        return; // returning from the picker — keep the in-progress draft
      }
    }
    this.keepDraft = false;
    const repo = getRepository();
    const exAll = await repo.listExercises();
    this.meta = Object.fromEntries(exAll.map((e) => [e.id, e]));
    this.selection = new Set();
    this.loadedFor = id;
    this.isNew = id === "new";
    if (id === "new") {
      const iso = new Date().toISOString();
      this.draft = {
        id: newId(),
        name: "New Template",
        exercises: [],
        groups: [],
        createdAt: iso,
        updatedAt: iso,
      };
    } else {
      const t = await repo.getTemplate(id);
      this.draft = t ? (structuredClone(t) as Template) : null;
    }
  }

  addExercise(ex: Exercise) {
    if (!this.draft) return;
    this.meta[ex.id] = ex;
    this.draft.exercises.push({
      exerciseId: ex.id,
      groupId: null,
      setupNote: ex.setupNote,
      plannedSets: defaultSets(ex),
    });
    // Must stay SYNCHRONOUS: the picker calls this immediately before history.back().
    // The weight prefill is therefore fired detached and patched in when it lands.
    const te = this.draft.exercises[this.draft.exercises.length - 1];
    void this.primeWeightFrom(ex, te, this.draft);
  }

  /**
   * Fill the blank weight column from the last session that actually logged this
   * exercise — the top working weight, the same anchor progression.ts uses. Only
   * touches sets that are still blank, so it can never overwrite a number the user
   * typed while this was in flight (the picker lands them on the editor instantly).
   */
  private async primeWeightFrom(
    ex: Exercise,
    te: TemplateExercise,
    draft: Template
  ) {
    if (ex.trackingType !== "weight_reps" || ex.loadType === "bodyweight") return;
    const last = await getRepository().lastSessionForExercise(ex.id);
    const done = last?.exercises
      .find((e) => e.exerciseId === ex.id)
      ?.sets.filter((s) => s.completed);
    if (!done?.length) return;
    const top = Math.max(0, ...done.map((s) => s.weight ?? 0));
    if (!top) return;
    if (this.draft !== draft) return; // a different template was loaded meanwhile
    for (const ps of te.plannedSets) if (ps.targetWeight == null) ps.targetWeight = top;
  }

  removeExercise(i: number) {
    this.draft?.exercises.splice(i, 1);
    this.pruneGroups();
    this.selection = new Set();
  }

  addSet(i: number) {
    const e = this.draft?.exercises[i];
    if (!e) return;
    const last = e.plannedSets.at(-1);
    // no targetWeight in the fallback either — see defaultSets
    e.plannedSets.push({ ...(last ?? { targetReps: 10, targetRestSec: 90 }) });
  }
  removeSet(i: number) {
    const e = this.draft?.exercises[i];
    if (e && e.plannedSets.length > 1) e.plannedSets.pop();
  }

  toggleSelect(i: number) {
    const s = new Set(this.selection);
    if (s.has(i)) s.delete(i);
    else s.add(i);
    this.selection = s;
  }

  groupSelected() {
    if (!this.draft || this.selection.size < 2) return;
    // Expand the selection to WHOLE groups first. A selection that straddles an
    // existing superset (pick B out of A-B-C, plus a D further down) used to pull
    // only B out of the run, leaving A and C sharing a group id but no longer
    // adjacent — and both consumers read a group as a maximal CONSECUTIVE run, so
    // that old group came back as two one-member "supersets".
    const taken = new Set(this.selection);
    for (const i of this.selection) {
      const g = this.draft.exercises[i]?.groupId;
      if (g == null) continue;
      this.draft.exercises.forEach((e, j) => {
        if (e.groupId === g) taken.add(j);
      });
    }
    const idxs = [...taken]
      .filter((i) => this.draft!.exercises[i])
      .sort((a, b) => a - b);
    if (idxs.length < 2) return;
    const gid = newId();
    const picked = idxs.map((i) => this.draft!.exercises[i]);
    picked.forEach((p) => (p.groupId = gid));
    const first = idxs[0];
    const rebuilt: typeof this.draft.exercises = [];
    this.draft.exercises.forEach((e, i) => {
      if (taken.has(i)) {
        if (i === first) rebuilt.push(...picked);
      } else rebuilt.push(e);
    });
    this.draft.exercises = rebuilt;
    this.draft.groups.push({ id: gid, restSec: 60 });
    this.pruneGroups(); // drop any group the expansion just emptied
    this.selection = new Set();
  }

  ungroup(groupId: string) {
    if (!this.draft) return;
    this.draft.exercises.forEach((e) => {
      if (e.groupId === groupId) e.groupId = null;
    });
    this.draft.groups = this.draft.groups.filter((g) => g.id !== groupId);
  }

  /**
   * Normalise superset groups after a structural edit.
   *
   * Both consumers — the template detail screen and the live workout's groupBounds —
   * define a group as a maximal run of CONSECUTIVE exercises sharing a groupId, so a
   * run of one is not a superset. Demote those, then drop every `groups` entry
   * nobody references any more. Without this, removing a grouped exercise left an
   * entry that no UI could ever reach (the ungroup chip only renders on an exercise
   * that still carries the id), so the home card wore a permanent "Superset" badge.
   */
  private pruneGroups() {
    const d = this.draft;
    if (!d) return;
    const list = d.exercises;
    let i = 0;
    while (i < list.length) {
      const g = list[i].groupId ?? null;
      if (g == null) {
        i++;
        continue;
      }
      let end = i;
      while (end + 1 < list.length && (list[end + 1].groupId ?? null) === g) end++;
      if (end === i) list[i].groupId = null; // a run of one is not a superset
      i = end + 1;
    }
    const live = new Set(
      list.map((e) => e.groupId).filter((g): g is string => g != null)
    );
    d.groups = d.groups.filter((g) => live.has(g.id));
  }

  /** Bounds [start, end] of the superset group index i belongs to — a maximal run of
   *  consecutive exercises sharing a non-null groupId; a standalone exercise is
   *  itself. Ported from the live workout store, which is the adjacency contract the
   *  detail screen and round-cycling both assume. */
  private groupBounds(i: number): { start: number; end: number } {
    const list = this.draft?.exercises ?? [];
    const g = list[i]?.groupId ?? null;
    if (g == null) return { start: i, end: i };
    let start = i;
    let end = i;
    while (start - 1 >= 0 && (list[start - 1]?.groupId ?? null) === g) start--;
    while (end + 1 < list.length && (list[end + 1]?.groupId ?? null) === g) end++;
    return { start, end };
  }

  /** Whether moveExercise would actually move something. A superset member that
   *  isn't at its block's edge still looks movable, so the editor disables the arrow
   *  rather than shipping a button that does nothing. */
  canMove(i: number, dir: -1 | 1): boolean {
    const list = this.draft?.exercises;
    if (!list?.[i]) return false;
    const b = this.groupBounds(i);
    return dir === -1 ? b.start - 1 >= 0 : b.end + 1 < list.length;
  }

  /** Move an exercise one slot up/down. Superset blocks travel as UNITS, exactly as
   *  they do mid-workout: a grouped exercise drags its partners along and a
   *  neighbouring group is jumped over whole, so a reorder can never scatter a group. */
  moveExercise(i: number, dir: -1 | 1) {
    const list = this.draft?.exercises;
    if (!list?.[i]) return;
    const own = this.groupBounds(i);
    const neighbor = dir === -1 ? own.start - 1 : own.end + 1;
    if (neighbor < 0 || neighbor >= list.length) return;
    const other = this.groupBounds(neighbor);
    const [top, bottom] = dir === -1 ? [other, own] : [own, other];
    const block = list.splice(bottom.start, bottom.end - bottom.start + 1);
    list.splice(top.start, 0, ...block);
    // selection is index-based, so after a move it points at the wrong rows
    this.selection = new Set();
  }

  async save(): Promise<string | null> {
    if (!this.draft) return null;
    // also repairs drafts loaded from the DB that already carry orphan groups
    this.pruneGroups();
    this.draft.updatedAt = new Date().toISOString();
    await getRepository().upsertTemplate($state.snapshot(this.draft));
    return this.draft.id;
  }
}

export const editor = new EditorStore();
