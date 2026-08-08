// Backup / restore service — export & import all Buffy data via the repository.
import { getRepository } from '$lib/db';
import { setVolume } from '$lib/compute';
import { saveTextFile, writeAutoBackup } from '$lib/native';
import type { Exercise, Template, WorkoutSession, Settings, BodyWeightEntry } from '$lib/types';

export interface BuffyBackup {
	app: 'buffy';
	version: 1;
	exportedAt: string;
	exercises: Exercise[];
	templates: Template[];
	sessions: WorkoutSession[];
	settings: Settings;
	/**
	 * Body-weight series. OPTIONAL because every backup written before this field
	 * existed simply omits it — the importer must keep loading those unchanged, so
	 * this stays additive and `version` stays 1 (nothing reads it, and an older
	 * build handed a newer file just ignores the extra key).
	 *
	 * Body weight is health data and is deliberately kept OUT of iCloud/CloudKit
	 * sync (5.1.3(ii), see repository.ts) — but that left it as the only dataset with
	 * no recovery path at all, while this screen promises an export keeps you safe.
	 * The backup is a user-initiated, on-device file, not a sync channel, so it is in.
	 * That also means it rides autoBackup()'s Documents write (and therefore the
	 * device's own iCloud backup, per native.ts) — same as the session-level health
	 * fields the backup has always carried.
	 */
	bodyweights?: BodyWeightEntry[];
}

export type ImportMode = 'merge' | 'replace';

function stamp(): string {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
function csv(s: string): string {
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function n(x: number | undefined): string {
	return x == null ? '' : String(x);
}

export async function buildBackup(): Promise<BuffyBackup> {
	const repo = getRepository();
	const [exercises, templates, sessions, settings, bodyweights] = await Promise.all([
		repo.listExercises(),
		repo.listTemplates(),
		repo.listSessions(),
		repo.getSettings(),
		repo.listBodyWeights()
	]);
	return {
		app: 'buffy',
		version: 1,
		exportedAt: new Date().toISOString(),
		exercises,
		templates,
		sessions,
		settings,
		bodyweights
	};
}

/** Automatic post-workout backup — native only (web/PWA uses manual export). */
export async function autoBackup(): Promise<void> {
	try {
		const ok = await writeAutoBackup(JSON.stringify(await buildBackup()));
		if (ok && typeof localStorage !== 'undefined') {
			localStorage.setItem('buffy:lastAutoBackup', new Date().toISOString());
		}
	} catch {
		/* best-effort */
	}
}

export async function exportJSON() {
	const data = await buildBackup();
	await saveTextFile(`buffy-backup-${stamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
}

// Per-SET rows; session-level measured intensity (WorkoutSession.intensity) is
// deliberately omitted — it doesn't repeat per set. The JSON backup carries it.
export async function exportCSV() {
	const repo = getRepository();
	const [sessions, exAll] = await Promise.all([repo.listSessions(), repo.listExercises()]);
	const byId = new Map(exAll.map((e) => [e.id, e]));
	const rows: string[] = [
		'date,workout,exercise,equipment,set,reps,weight_kg,per_side,duration_s,rest_s,volume_kg'
	];
	for (const s of sessions) {
		for (const le of s.exercises) {
			const ex = byId.get(le.exerciseId);
			le.sets.forEach((set, i) => {
				rows.push(
					[
						s.startedAt,
						csv(s.title ?? ''),
						csv(ex?.name ?? le.exerciseId),
						ex?.equipment ?? '',
						String(i + 1),
						n(set.reps),
						n(set.weight),
						set.perSide ? 'y' : '',
						n(set.durationSec),
						n(set.restTakenSec),
						String(Math.round(setVolume(set)))
					].join(',')
				);
			});
		}
	}
	await saveTextFile(`buffy-sessions-${stamp()}.csv`, rows.join('\n'), 'text/csv');
}

/** Parse + validate a Buffy backup file. Throws on anything that isn't one. */
export function parseBackup(text: string): BuffyBackup {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error('That file isn’t valid JSON.');
	}
	const b = data as BuffyBackup;
	// Validate shapes BEFORE any caller wipes the DB (replace-mode import calls
	// clearAll first): every record must have a string id, and templates — if present
	// — must be an array. A truthy non-array `templates` used to pass and then throw
	// `not iterable` AFTER clearAll had already erased everything.
	const isRecordArray = (v: unknown): boolean =>
		Array.isArray(v) && v.every((r) => !!r && typeof (r as { id?: unknown }).id === 'string');
	if (
		!b ||
		b.app !== 'buffy' ||
		!isRecordArray(b.sessions) ||
		!isRecordArray(b.exercises) ||
		(b.templates !== undefined && !isRecordArray(b.templates)) ||
		// same optional-array guard as templates: absent is fine (older backups),
		// present-but-not-an-array must fail HERE, before replace-mode wipes anything
		(b.bodyweights !== undefined && !isRecordArray(b.bodyweights))
	) {
		throw new Error('That doesn’t look like a Buffy backup.');
	}
	return b;
}

export interface ImportResult {
	exercises: number;
	templates: number;
	sessions: number;
	bodyweights: number;
}

export async function importBackup(b: BuffyBackup, mode: ImportMode): Promise<ImportResult> {
	const repo = getRepository();
	if (mode === 'replace') await repo.clearAll();

	// Dedupe against the RAW tables (tombstones included), not the live lists — a
	// record the user has since deleted must count as "already present" so a merge
	// import doesn't re-upsert it, resurrect the deletion, and re-propagate it to every
	// synced device.
	const [exEx, exTp, exSe] = await Promise.all([
		repo.listExercisesForSync(),
		repo.listTemplatesForSync(),
		repo.listSessionsForSync()
	]);
	const exIds = new Set(exEx.map((e) => e.id));
	const tpIds = new Set(exTp.map((t) => t.id));
	const seIds = new Set(exSe.map((s) => s.id));

	const res: ImportResult = { exercises: 0, templates: 0, sessions: 0, bodyweights: 0 };
	for (const e of b.exercises ?? []) if (mode === 'replace' || !exIds.has(e.id)) (await repo.upsertExercise(e), res.exercises++);
	for (const t of b.templates ?? []) if (mode === 'replace' || !tpIds.has(t.id)) (await repo.upsertTemplate(t), res.templates++);
	for (const s of b.sessions ?? []) if (mode === 'replace' || !seIds.has(s.id)) (await repo.upsertSession(s), res.sessions++);

	// Body weight is restored HERE rather than alongside the three tables above,
	// because clearAll() deliberately doesn't touch it: the bodyweights table sits
	// outside the synced set (local-only health data), so a replace has to empty it
	// explicitly or "replace" would silently degrade into a merge for this one series.
	// Merge mode dedupes by id; addBodyWeight is a put(), so re-importing the same
	// file is idempotent either way.
	//
	// A file written BEFORE the field existed has no `bodyweights` key at all — that
	// is "this backup says nothing about body weight", not "this backup says you have
	// none", so replace leaves the existing series alone rather than destroying the
	// one dataset the old file could never have carried.
	if (b.bodyweights !== undefined) {
		if (mode === 'replace') {
			for (const e of await repo.listBodyWeights()) await repo.deleteBodyWeight(e.id);
			for (const e of b.bodyweights) (await repo.addBodyWeight(e), res.bodyweights++);
		} else {
			const bwIds = new Set((await repo.listBodyWeights()).map((e) => e.id));
			for (const e of b.bodyweights) if (!bwIds.has(e.id)) (await repo.addBodyWeight(e), res.bodyweights++);
		}
	}

	if (mode === 'replace' && b.settings) await repo.saveSettings(b.settings);
	return res;
}
