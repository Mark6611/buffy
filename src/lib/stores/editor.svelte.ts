// Draft state for the template editor. Edits a working copy; commits via save().
import { getRepository } from '$lib/db';
import type { Exercise, PlannedSet, Template } from '$lib/types';

function nid(): string {
	return crypto.randomUUID();
}

function defaultSets(ex: Exercise): PlannedSet[] {
	const rest = ex.defaultRestSec ?? 90;
	if (ex.trackingType === 'time_hold')
		return Array.from({ length: 3 }, () => ({ targetDurationSec: 45, targetRestSec: rest }));
	if (ex.trackingType === 'cardio')
		return Array.from({ length: 1 }, () => ({ targetTimeSec: 600, targetIncline: 6, targetSpeed: 6, targetRestSec: 0 }));
	return Array.from({ length: 4 }, () => ({
		targetReps: ex.defaultTargetReps ?? 10,
		targetWeight: 20,
		targetRestSec: rest
	}));
}

class EditorStore {
	draft = $state<Template | null>(null);
	meta = $state<Record<string, Exercise>>({});
	selection = $state<Set<number>>(new Set());
	private loadedFor: string | null = null;

	async load(id: string) {
		if (this.draft && this.loadedFor === id) return; // keep draft across picker round-trips
		const repo = getRepository();
		const exAll = await repo.listExercises();
		this.meta = Object.fromEntries(exAll.map((e) => [e.id, e]));
		this.selection = new Set();
		this.loadedFor = id;
		if (id === 'new') {
			const iso = new Date().toISOString();
			this.draft = { id: nid(), name: 'New Template', exercises: [], groups: [], createdAt: iso, updatedAt: iso };
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
			plannedSets: defaultSets(ex)
		});
	}

	removeExercise(i: number) {
		this.draft?.exercises.splice(i, 1);
		this.selection = new Set();
	}

	addSet(i: number) {
		const e = this.draft?.exercises[i];
		if (!e) return;
		const last = e.plannedSets.at(-1);
		e.plannedSets.push({ ...(last ?? { targetReps: 10, targetWeight: 20, targetRestSec: 90 }) });
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
		const idxs = [...this.selection].sort((a, b) => a - b);
		const gid = nid();
		const picked = idxs.map((i) => this.draft!.exercises[i]);
		picked.forEach((p) => (p.groupId = gid));
		const first = idxs[0];
		const rebuilt: typeof this.draft.exercises = [];
		this.draft.exercises.forEach((e, i) => {
			if (this.selection.has(i)) {
				if (i === first) rebuilt.push(...picked);
			} else rebuilt.push(e);
		});
		this.draft.exercises = rebuilt;
		this.draft.groups.push({ id: gid, restSec: 60 });
		this.selection = new Set();
	}

	ungroup(groupId: string) {
		if (!this.draft) return;
		this.draft.exercises.forEach((e) => {
			if (e.groupId === groupId) e.groupId = null;
		});
		this.draft.groups = this.draft.groups.filter((g) => g.id !== groupId);
	}

	async save(): Promise<string | null> {
		if (!this.draft) return null;
		this.draft.updatedAt = new Date().toISOString();
		await getRepository().upsertTemplate($state.snapshot(this.draft));
		return this.draft.id;
	}
}

export const editor = new EditorStore();
