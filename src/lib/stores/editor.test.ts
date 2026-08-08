// Template editor draft store: draft survival across the picker/custom-exercise
// detours, superset group integrity, reorder, and the pure duplicate helper.
//
// Group integrity is the subtle part: BOTH consumers (the template detail screen and
// the live workout's groupBounds) define a superset as a maximal run of CONSECUTIVE
// exercises sharing a groupId, so every structural edit has to leave the draft in a
// state where "shares a groupId" and "is adjacent" still mean the same thing.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Exercise, Template, WorkoutSession } from '$lib/types';

const h = vi.hoisted(() => {
	const templates = new Map<string, Template>();
	const exercises: Exercise[] = [];
	const lastSession: { value: WorkoutSession | undefined } = { value: undefined };
	return {
		templates,
		exercises,
		lastSession,
		repo: {
			listExercises: async () => exercises,
			getTemplate: async (id: string) => templates.get(id),
			upsertTemplate: async (t: Template) => {
				templates.set(t.id, t);
			},
			lastSessionForExercise: async () => lastSession.value
		}
	};
});
vi.mock('$lib/db', () => ({ getRepository: () => h.repo, ensureSeeded: async () => {} }));

import { editor, duplicateTemplate } from '$lib/stores/editor.svelte';

function ex(id: string, over: Partial<Exercise> = {}): Exercise {
	return {
		id,
		name: id,
		equipment: 'dumbbell',
		primaryMuscles: ['Chest'],
		secondaryMuscles: [],
		trackingType: 'weight_reps',
		loadType: 'total',
		defaultTargetReps: 8,
		weightStep: 1,
		defaultRestSec: 60,
		...over
	};
}

const A = ex('a');
const B = ex('b');
const C = ex('c');
const D = ex('d');

/** Flush the detached primeWeightFrom() promise chain. */
async function flush() {
	for (let i = 0; i < 6; i++) await Promise.resolve();
}

/** Compact shape of the draft: [exerciseId, groupLabel] per row + the group entries. */
function shape() {
	const d = editor.draft!;
	const labels = new Map<string, string>();
	const label = (g: string | null | undefined) => {
		if (g == null) return '-';
		if (!labels.has(g)) labels.set(g, String.fromCharCode(103 + labels.size)); // g, h, i…
		return labels.get(g)!;
	};
	const rows = d.exercises.map((e) => `${e.exerciseId}:${label(e.groupId)}`);
	return { rows, groups: d.groups.map((g) => label(g.id)).sort() };
}

/** Every groups entry is referenced by a run of >= 2 CONSECUTIVE members, and every
 *  groupId carried by an exercise has an entry. This is the invariant both consumers
 *  assume; assert it after every structural edit. */
function assertGroupsCoherent() {
	const d = editor.draft!;
	const entries = new Set(d.groups.map((g) => g.id));
	expect(d.groups.length).toBe(entries.size); // no duplicate entries
	const runs = new Map<string, number[]>();
	let i = 0;
	while (i < d.exercises.length) {
		const g = d.exercises[i].groupId ?? null;
		if (g == null) {
			i++;
			continue;
		}
		let end = i;
		while (end + 1 < d.exercises.length && (d.exercises[end + 1].groupId ?? null) === g) end++;
		runs.set(g, [...(runs.get(g) ?? []), end - i + 1]);
		i = end + 1;
	}
	for (const [gid, lens] of runs) {
		expect(entries.has(gid), `group ${gid} has members but no entry`).toBe(true);
		expect(lens.length, `group ${gid} is split into ${lens.length} runs`).toBe(1);
		expect(lens[0], `group ${gid} is a run of one`).toBeGreaterThanOrEqual(2);
	}
	for (const gid of entries)
		expect(runs.has(gid), `orphan group entry ${gid} with no members`).toBe(true);
}

beforeEach(async () => {
	h.templates.clear();
	h.exercises.length = 0;
	h.exercises.push(A, B, C, D);
	h.lastSession.value = undefined;
	editor.keepDraft = false;
	await editor.load('new');
});

describe('load / draft survival', () => {
	it('keeps the in-progress draft across the picker round-trip (route id stays "new")', async () => {
		editor.addExercise(A);
		editor.keepDraft = true;
		await editor.load('new');
		expect(editor.draft?.exercises).toHaveLength(1);
	});

	it('keeps the draft when the custom-exercise detour returns via the draft UUID', async () => {
		// REGRESSION (P0): /template/new/edit → picker → "Custom exercise" → the new-
		// exercise page navigates to /template/<draft uuid>/edit, so load() is called
		// with an id the DB has never seen. Matching only the route id wiped the draft.
		editor.addExercise(A);
		editor.addExercise(B);
		editor.draft!.name = 'Push Day';
		const uuid = editor.draft!.id;
		expect(uuid).not.toBe('new');

		editor.keepDraft = true;
		await editor.load(uuid);

		expect(editor.draft).not.toBeNull();
		expect(editor.draft!.id).toBe(uuid);
		expect(editor.draft!.name).toBe('Push Day');
		expect(editor.draft!.exercises.map((e) => e.exerciseId)).toEqual(['a', 'b']);
		// and the screen must still call itself "New Template" — the route id is a uuid now
		expect(editor.isNew).toBe(true);
	});

	it('reports isNew=false once the editor is opened on a stored template', async () => {
		editor.addExercise(A);
		const uuid = editor.draft!.id;
		await editor.save();
		await editor.load(uuid);
		expect(editor.isNew).toBe(false);
	});

	it('still rebuilds from the DB when keepDraft is false, so a saved draft is not revived', async () => {
		editor.addExercise(A);
		const uuid = editor.draft!.id;
		await editor.save();

		// re-entering without keepDraft must re-read, not reuse the singleton
		editor.draft!.name = 'edited in memory only';
		await editor.load(uuid);
		expect(editor.draft!.name).toBe('New Template');

		// and "New" mints a genuinely new template rather than reopening the last one
		await editor.load('new');
		expect(editor.draft!.id).not.toBe(uuid);
		expect(editor.draft!.exercises).toHaveLength(0);
	});
});

describe('defaultSets weight', () => {
	it('leaves the weight blank instead of inventing 20 kg', async () => {
		editor.addExercise(A);
		await flush();
		const sets = editor.draft!.exercises[0].plannedSets;
		expect(sets).toHaveLength(4);
		expect(sets.every((s) => s.targetWeight === undefined)).toBe(true);
		expect(sets[0].targetReps).toBe(8); // the exercise's own default, not 10
	});

	it('primes the weight from the top working set of the last session', async () => {
		h.lastSession.value = {
			id: 's1',
			startedAt: '2026-08-01T10:00:00.000Z',
			endedAt: '2026-08-01T11:00:00.000Z',
			exercises: [
				{
					exerciseId: 'a',
					sets: [
						{ index: 0, completed: true, weight: 40, reps: 8 },
						{ index: 1, completed: true, weight: 42.5, reps: 6 },
						{ index: 2, completed: false, weight: 60, reps: 1 } // never logged
					]
				}
			],
			createdAt: '2026-08-01T10:00:00.000Z',
			updatedAt: '2026-08-01T11:00:00.000Z'
		} as WorkoutSession;

		editor.addExercise(A);
		await flush();
		expect(editor.draft!.exercises[0].plannedSets.every((s) => s.targetWeight === 42.5)).toBe(true);
	});

	it('never overwrites a weight the user already typed', async () => {
		h.lastSession.value = {
			id: 's1',
			startedAt: '2026-08-01T10:00:00.000Z',
			endedAt: '2026-08-01T11:00:00.000Z',
			exercises: [{ exerciseId: 'a', sets: [{ index: 0, completed: true, weight: 40, reps: 8 }] }],
			createdAt: '2026-08-01T10:00:00.000Z',
			updatedAt: '2026-08-01T11:00:00.000Z'
		} as WorkoutSession;

		editor.addExercise(A);
		editor.draft!.exercises[0].plannedSets[0].targetWeight = 12.5; // typed before it lands
		await flush();
		const sets = editor.draft!.exercises[0].plannedSets;
		expect(sets[0].targetWeight).toBe(12.5);
		expect(sets[1].targetWeight).toBe(40);
	});

	it('does not prime bodyweight or non weight_reps exercises', async () => {
		h.lastSession.value = {
			id: 's1',
			startedAt: '2026-08-01T10:00:00.000Z',
			endedAt: '2026-08-01T11:00:00.000Z',
			exercises: [{ exerciseId: 'bw', sets: [{ index: 0, completed: true, weight: 80, reps: 8 }] }],
			createdAt: '2026-08-01T10:00:00.000Z',
			updatedAt: '2026-08-01T11:00:00.000Z'
		} as WorkoutSession;
		const bw = ex('bw', { loadType: 'bodyweight' });
		editor.addExercise(bw);
		await flush();
		expect(editor.draft!.exercises[0].plannedSets.every((s) => s.targetWeight == null)).toBe(true);
	});
});

describe('group integrity', () => {
	async function draftOf(...list: Exercise[]) {
		await editor.load('new');
		for (const e of list) editor.addExercise(e);
	}

	it('removing a grouped exercise clears the orphaned group entry', async () => {
		await draftOf(A, B, C);
		editor.toggleSelect(0);
		editor.toggleSelect(1);
		editor.groupSelected();
		expect(editor.draft!.groups).toHaveLength(1);

		editor.removeExercise(0); // one member left → not a superset any more
		expect(editor.draft!.groups).toHaveLength(0);
		expect(editor.draft!.exercises[0].groupId).toBeNull();
		assertGroupsCoherent();
	});

	it('removing BOTH members leaves no unreachable group entry', async () => {
		await draftOf(A, B, C);
		editor.toggleSelect(0);
		editor.toggleSelect(1);
		editor.groupSelected();
		editor.removeExercise(0);
		editor.removeExercise(0);
		expect(editor.draft!.groups).toHaveLength(0);
		expect(editor.draft!.exercises.map((e) => e.exerciseId)).toEqual(['c']);
		assertGroupsCoherent();
	});

	it('removing the middle of a three-member group keeps the group intact', async () => {
		await draftOf(A, B, C, D);
		editor.toggleSelect(0);
		editor.toggleSelect(1);
		editor.toggleSelect(2);
		editor.groupSelected();
		editor.removeExercise(1);
		expect(editor.draft!.groups).toHaveLength(1);
		expect(shape().rows).toEqual(['a:g', 'c:g', 'd:-']);
		assertGroupsCoherent();
	});

	it('grouping a selection that straddles an existing superset absorbs it whole', async () => {
		// [A B C] grouped, then select B and D. Selecting B alone used to pull it out of
		// the run, leaving A and C sharing a group id but no longer adjacent — two
		// one-member "supersets" that no chip could ever clear.
		await draftOf(A, B, C, D);
		editor.toggleSelect(0);
		editor.toggleSelect(1);
		editor.toggleSelect(2);
		editor.groupSelected();

		editor.toggleSelect(1); // B
		editor.toggleSelect(3); // D
		editor.groupSelected();

		const s = shape();
		expect(s.rows).toEqual(['a:g', 'b:g', 'c:g', 'd:g']);
		expect(s.groups).toEqual(['g']);
		assertGroupsCoherent();
	});

	it('groups a plain non-adjacent selection by pulling the members together', async () => {
		await draftOf(A, B, C, D);
		editor.toggleSelect(0);
		editor.toggleSelect(2);
		editor.groupSelected();
		expect(shape().rows).toEqual(['a:g', 'c:g', 'b:-', 'd:-']);
		assertGroupsCoherent();
	});

	it('ungroup still clears both the members and the entry', async () => {
		await draftOf(A, B, C);
		editor.toggleSelect(0);
		editor.toggleSelect(1);
		editor.groupSelected();
		editor.ungroup(editor.draft!.groups[0].id);
		expect(editor.draft!.groups).toHaveLength(0);
		expect(editor.draft!.exercises.every((e) => e.groupId == null)).toBe(true);
		assertGroupsCoherent();
	});

	it('save() repairs a stored template that already carries an orphan group', async () => {
		const iso = '2026-01-01T00:00:00.000Z';
		h.templates.set('t1', {
			id: 't1',
			name: 'Legacy',
			exercises: [
				{ exerciseId: 'a', groupId: 'ghost', plannedSets: [{ targetReps: 8 }] },
				{ exerciseId: 'b', groupId: null, plannedSets: [{ targetReps: 8 }] }
			],
			groups: [
				{ id: 'ghost', restSec: 60 },
				{ id: 'gone', restSec: 60 }
			],
			createdAt: iso,
			updatedAt: iso
		});
		await editor.load('t1');
		await editor.save();
		const saved = h.templates.get('t1')!;
		expect(saved.groups).toHaveLength(0);
		expect(saved.exercises[0].groupId).toBeNull();
		assertGroupsCoherent();
	});
});

describe('reorder', () => {
	async function draftOf(...list: Exercise[]) {
		await editor.load('new');
		for (const e of list) editor.addExercise(e);
	}

	it('swaps two standalone exercises and is reversible', async () => {
		await draftOf(A, B, C);
		editor.moveExercise(0, 1);
		expect(shape().rows).toEqual(['b:-', 'a:-', 'c:-']);
		editor.moveExercise(1, -1);
		expect(shape().rows).toEqual(['a:-', 'b:-', 'c:-']);
	});

	it('is a no-op at the ends', async () => {
		await draftOf(A, B);
		editor.moveExercise(0, -1);
		editor.moveExercise(1, 1);
		expect(shape().rows).toEqual(['a:-', 'b:-']);
	});

	it('moves a superset block as a unit and never scatters it', async () => {
		await draftOf(A, B, C, D); // group B+C
		editor.toggleSelect(1);
		editor.toggleSelect(2);
		editor.groupSelected();
		expect(shape().rows).toEqual(['a:-', 'b:g', 'c:g', 'd:-']);

		editor.moveExercise(1, -1); // grab a member — the whole block jumps A
		expect(shape().rows).toEqual(['b:g', 'c:g', 'a:-', 'd:-']);
		assertGroupsCoherent();

		editor.moveExercise(2, -1); // A moves back up over the whole block
		expect(shape().rows).toEqual(['a:-', 'b:g', 'c:g', 'd:-']);
		assertGroupsCoherent();
	});

	it('jumps a neighbouring group whole rather than landing inside it', async () => {
		await draftOf(A, B, C, D); // group A+B
		editor.toggleSelect(0);
		editor.toggleSelect(1);
		editor.groupSelected();
		editor.moveExercise(2, -1); // C moves up past the A+B block
		expect(shape().rows).toEqual(['c:-', 'a:g', 'b:g', 'd:-']);
		assertGroupsCoherent();
	});

	it('canMove reports the block edges, not the row index', async () => {
		await draftOf(A, B, C); // group B+C at the tail
		editor.toggleSelect(1);
		editor.toggleSelect(2);
		editor.groupSelected();
		expect(editor.canMove(0, -1)).toBe(false);
		expect(editor.canMove(0, 1)).toBe(true);
		expect(editor.canMove(1, -1)).toBe(true); // block edge, not row 1
		expect(editor.canMove(1, 1)).toBe(false); // block already ends the list
		expect(editor.canMove(2, 1)).toBe(false);
		expect(editor.canMove(9, 1)).toBe(false);
	});

	it('clears the index-based selection so it cannot point at the wrong rows', async () => {
		await draftOf(A, B, C);
		editor.toggleSelect(0);
		editor.moveExercise(0, 1);
		expect(editor.selection.size).toBe(0);
	});
});

describe('duplicateTemplate', () => {
	const iso = '2026-01-01T00:00:00.000Z';
	const source: Template = {
		id: 't-src',
		name: 'Push Day',
		exercises: [
			{ exerciseId: 'a', groupId: 'g1', plannedSets: [{ targetReps: 8, targetWeight: 40 }] },
			{ exerciseId: 'b', groupId: 'g1', plannedSets: [{ targetReps: 10, targetWeight: 20 }] },
			{ exerciseId: 'c', groupId: null, plannedSets: [{ targetReps: 12 }] }
		],
		groups: [{ id: 'g1', restSec: 90 }],
		createdAt: iso,
		updatedAt: iso
	};

	it('mints a new id, a "<name> copy" name and fresh timestamps', () => {
		const copy = duplicateTemplate(source);
		expect(copy.id).not.toBe(source.id);
		expect(copy.name).toBe('Push Day copy');
		expect(copy.createdAt).not.toBe(iso);
		expect(copy.updatedAt).toBe(copy.createdAt);
		expect(copy.deletedAt).toBeUndefined();
	});

	it('deep-copies plannedSets so editing the copy cannot touch the original', () => {
		const copy = duplicateTemplate(source);
		copy.exercises[0].plannedSets[0].targetWeight = 999;
		copy.exercises[0].plannedSets.push({ targetReps: 5 });
		expect(source.exercises[0].plannedSets[0].targetWeight).toBe(40);
		expect(source.exercises[0].plannedSets).toHaveLength(1);
	});

	it('remaps superset group ids so the two templates share none', () => {
		const copy = duplicateTemplate(source);
		expect(copy.groups).toHaveLength(1);
		expect(copy.groups[0].id).not.toBe('g1');
		expect(copy.groups[0].restSec).toBe(90);
		// members still point at the copy's OWN group, and the run stays adjacent
		expect(copy.exercises[0].groupId).toBe(copy.groups[0].id);
		expect(copy.exercises[1].groupId).toBe(copy.groups[0].id);
		expect(copy.exercises[2].groupId).toBeNull();
		expect(source.exercises[0].groupId).toBe('g1');
	});

	it('copying a copy stacks the suffix rather than colliding', () => {
		const once = duplicateTemplate(source);
		const twice = duplicateTemplate(once);
		expect(twice.name).toBe('Push Day copy copy');
		expect(twice.id).not.toBe(once.id);
	});
});
