// Backup / restore service — export & import all Buffy data via the repository.
import { getRepository } from '$lib/db';
import { setVolume } from '$lib/compute';
import { saveTextFile, writeAutoBackup } from '$lib/native';
import type { Exercise, Template, WorkoutSession, Settings } from '$lib/types';

export interface BuffyBackup {
	app: 'buffy';
	version: 1;
	exportedAt: string;
	exercises: Exercise[];
	templates: Template[];
	sessions: WorkoutSession[];
	settings: Settings;
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
	const [exercises, templates, sessions, settings] = await Promise.all([
		repo.listExercises(),
		repo.listTemplates(),
		repo.listSessions(),
		repo.getSettings()
	]);
	return { app: 'buffy', version: 1, exportedAt: new Date().toISOString(), exercises, templates, sessions, settings };
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
	if (!b || b.app !== 'buffy' || !Array.isArray(b.sessions) || !Array.isArray(b.exercises)) {
		throw new Error('That doesn’t look like a Buffy backup.');
	}
	return b;
}

export interface ImportResult {
	exercises: number;
	templates: number;
	sessions: number;
}

export async function importBackup(b: BuffyBackup, mode: ImportMode): Promise<ImportResult> {
	const repo = getRepository();
	if (mode === 'replace') await repo.clearAll();

	const [exEx, exTp, exSe] = await Promise.all([repo.listExercises(), repo.listTemplates(), repo.listSessions()]);
	const exIds = new Set(exEx.map((e) => e.id));
	const tpIds = new Set(exTp.map((t) => t.id));
	const seIds = new Set(exSe.map((s) => s.id));

	const res: ImportResult = { exercises: 0, templates: 0, sessions: 0 };
	for (const e of b.exercises ?? []) if (mode === 'replace' || !exIds.has(e.id)) (await repo.upsertExercise(e), res.exercises++);
	for (const t of b.templates ?? []) if (mode === 'replace' || !tpIds.has(t.id)) (await repo.upsertTemplate(t), res.templates++);
	for (const s of b.sessions ?? []) if (mode === 'replace' || !seIds.has(s.id)) (await repo.upsertSession(s), res.sessions++);
	if (mode === 'replace' && b.settings) await repo.saveSettings(b.settings);
	return res;
}
