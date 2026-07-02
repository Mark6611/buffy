// iCloud sync — bidirectional merge of Exercise/Template/WorkoutSession against
// CloudKit's private database. Native only (see $lib/native for the bridge).
//
// Model: last-write-wins by `updatedAt`, decided here (pure, testable) — the
// native side just moves opaque {id, updatedAt, json} records. Deletes travel as
// tombstones (deletedAt inside the record), so they win/lose by the same rule as
// any edit. Settings is deliberately excluded: those are per-device preferences
// (haptics, etc.), not data worth reconciling across devices.
import { getRepository } from '$lib/db';
import { cloudSyncIsAvailable, cloudSyncPull, cloudSyncPush, type CloudRecord } from '$lib/native';
import type { Exercise, Template, WorkoutSession } from '$lib/types';

type Syncable = { id: string; updatedAt?: string };

/** localStorage key for the last successful sync (ISO) — written here, read by the UI. */
export const LAST_CLOUD_SYNC_KEY = 'buffy:lastCloudSync';

export interface MergePlan<T> {
	/** remote records that are newer (or local-missing) — write these in locally */
	toWriteLocally: T[];
	/** local records that are newer (or remote-missing) — push these up */
	toPushRemotely: CloudRecord[];
}

/** Pure: decide, per id, which side wins. Equal timestamps mean already in sync.
 *  A remote record whose json doesn't parse is skipped outright — one corrupt
 *  record must not poison the rest of its type (and we never push blind over it,
 *  since we can't know what it held). */
export function mergeRecords<T extends Syncable>(local: T[], remote: CloudRecord[]): MergePlan<T> {
	const localById = new Map(local.map((l) => [l.id, l]));
	const remoteById = new Map(remote.map((r) => [r.id, r]));
	const toWriteLocally: T[] = [];
	const toPushRemotely: CloudRecord[] = [];

	for (const r of remote) {
		const loc = localById.get(r.id);
		const localTime = loc?.updatedAt ? Date.parse(loc.updatedAt) : -Infinity;
		const remoteTime = Date.parse(r.updatedAt) || -Infinity;
		if (!loc || remoteTime > localTime) {
			try {
				toWriteLocally.push(JSON.parse(r.json) as T);
			} catch {
				// corrupt remote json — skip this record, sync everything else
			}
		} else if (localTime > remoteTime) {
			toPushRemotely.push({ id: loc.id, updatedAt: loc.updatedAt!, json: JSON.stringify(loc) });
		}
	}
	for (const loc of local) {
		if (!remoteById.has(loc.id)) {
			// Records predating the updatedAt backfill get stamped INSIDE the json too,
			// not just on the envelope — otherwise every other device pulls a record
			// whose inner timestamp never matches the envelope and re-syncs it forever.
			const stamped = loc.updatedAt ? loc : { ...loc, updatedAt: new Date().toISOString() };
			toPushRemotely.push({ id: stamped.id, updatedAt: stamped.updatedAt!, json: JSON.stringify(stamped) });
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

// One pass at a time: every entry point (app foreground, finish(), the Settings
// button) awaits the same in-flight pass instead of starting a second one that
// would race the first's pulls against its pushes.
let inFlight: Promise<SyncResult> | null = null;

/** Run one full sync pass across all three entity types. Best-effort per type —
 *  one type failing doesn't block the others. A failed PULL aborts that type's
 *  whole pass (no push): an error is indistinguishable from an empty cloud, and
 *  pushing the full local set against "empty" would overwrite newer remote data. */
export function runCloudSync(): Promise<SyncResult> {
	if (inFlight) return inFlight;
	inFlight = doSync().finally(() => {
		inFlight = null;
	});
	return inFlight;
}

async function doSync(): Promise<SyncResult> {
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
		let local: T[];
		let remote: CloudRecord[];
		try {
			[local, remote] = await Promise.all([list(), cloudSyncPull(type)]);
		} catch {
			anyFailure = true;
			return; // pull failed — do NOT treat as empty and do NOT push
		}
		try {
			const { toWriteLocally, toPushRemotely } = mergeRecords(local, remote);
			for (const rec of toWriteLocally) await applySynced(rec);
			pulled += toWriteLocally.length;
			if (toPushRemotely.length) {
				await cloudSyncPush(type, toPushRemotely);
				pushed += toPushRemotely.length;
			}
		} catch {
			anyFailure = true;
		}
	}

	await syncOne<Exercise>('Exercise', () => repo.listExercisesForSync(), (r) => repo.applySyncedExercise(r));
	await syncOne<Template>('Template', () => repo.listTemplatesForSync(), (r) => repo.applySyncedTemplate(r));
	await syncOne<WorkoutSession>('WorkoutSession', () => repo.listSessionsForSync(), (r) => repo.applySyncedSession(r));

	const ok = !anyFailure;
	if (ok && typeof localStorage !== 'undefined') {
		localStorage.setItem(LAST_CLOUD_SYNC_KEY, new Date().toISOString());
	}
	return { ok, reason: ok ? undefined : 'one or more record types failed to sync', pulled, pushed };
}
