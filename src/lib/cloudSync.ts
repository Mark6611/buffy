// iCloud sync — bidirectional merge of Exercise/Template/WorkoutSession against
// CloudKit's private database. Native only (see $lib/native for the bridge).
//
// Model: last-write-wins by `updatedAt`, decided here (pure, testable) — the
// native side just moves opaque {id, updatedAt, json} records. Settings is
// deliberately excluded: those are per-device preferences (haptics, etc.), not
// data worth reconciling across devices.
import { getRepository } from '$lib/db';
import { cloudSyncIsAvailable, cloudSyncPull, cloudSyncPush, type CloudRecord } from '$lib/native';
import type { Exercise, Template, WorkoutSession } from '$lib/types';

type Syncable = { id: string; updatedAt?: string };

export interface MergePlan<T> {
	/** remote records that are newer (or local-missing) — write these in locally */
	toWriteLocally: T[];
	/** local records that are newer (or remote-missing) — push these up */
	toPushRemotely: CloudRecord[];
}

/** Pure: decide, per id, which side wins. Equal timestamps mean already in sync. */
export function mergeRecords<T extends Syncable>(local: T[], remote: CloudRecord[]): MergePlan<T> {
	const remoteById = new Map(remote.map((r) => [r.id, r]));
	const toWriteLocally: T[] = [];
	const toPushRemotely: CloudRecord[] = [];

	for (const r of remote) {
		const loc = local.find((l) => l.id === r.id);
		const localTime = loc?.updatedAt ? Date.parse(loc.updatedAt) : -Infinity;
		const remoteTime = Date.parse(r.updatedAt) || -Infinity;
		if (!loc || remoteTime > localTime) {
			toWriteLocally.push(JSON.parse(r.json) as T);
		} else if (localTime > remoteTime) {
			toPushRemotely.push({ id: loc.id, updatedAt: loc.updatedAt!, json: JSON.stringify(loc) });
		}
	}
	for (const loc of local) {
		if (!remoteById.has(loc.id)) {
			toPushRemotely.push({ id: loc.id, updatedAt: loc.updatedAt ?? new Date().toISOString(), json: JSON.stringify(loc) });
		}
	}
	return { toWriteLocally, toPushRemotely };
}

export interface SyncResult {
	ok: boolean;
	reason?: string;
	pulled: number;
	pushed: number;
}

/** Run one full sync pass across all three entity types. Best-effort per type —
 *  one type failing (e.g. a flaky pull) doesn't block the others. */
export async function runCloudSync(): Promise<SyncResult> {
	if (!(await cloudSyncIsAvailable())) {
		return { ok: false, reason: 'iCloud unavailable — check that iCloud is signed in on this device', pulled: 0, pushed: 0 };
	}
	const repo = getRepository();
	let pulled = 0;
	let pushed = 0;
	let anyFailure = false;

	async function syncOne<T extends Syncable>(
		type: string,
		list: () => Promise<T[]>,
		applySynced: (r: T) => Promise<void>
	) {
		try {
			const [local, remote] = await Promise.all([list(), cloudSyncPull(type)]);
			const { toWriteLocally, toPushRemotely } = mergeRecords(local, remote);
			for (const rec of toWriteLocally) await applySynced(rec);
			pulled += toWriteLocally.length;
			if (toPushRemotely.length) {
				const ok = await cloudSyncPush(type, toPushRemotely);
				if (ok) pushed += toPushRemotely.length;
				else anyFailure = true;
			}
		} catch {
			anyFailure = true;
		}
	}

	await syncOne<Exercise>('Exercise', () => repo.listExercises(), (r) => repo.applySyncedExercise(r));
	await syncOne<Template>('Template', () => repo.listTemplates(), (r) => repo.applySyncedTemplate(r));
	await syncOne<WorkoutSession>('WorkoutSession', () => repo.listSessions(), (r) => repo.applySyncedSession(r));

	return { ok: !anyFailure, reason: anyFailure ? 'one or more record types failed to sync' : undefined, pulled, pushed };
}
