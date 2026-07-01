import { describe, it, expect } from 'vitest';
import { mergeRecords } from '$lib/cloudSync';

interface Row {
	id: string;
	updatedAt?: string;
	name: string;
}

const row = (id: string, updatedAt: string | undefined, name: string): Row => ({ id, updatedAt, name });
const cloud = (id: string, updatedAt: string, row: Row) => ({ id, updatedAt, json: JSON.stringify(row) });

describe('mergeRecords', () => {
	it('pulls a remote record that is newer than the local one', () => {
		const local = [row('a', '2026-01-01T00:00:00Z', 'old name')];
		const remote = [cloud('a', '2026-01-02T00:00:00Z', row('a', '2026-01-02T00:00:00Z', 'new name'))];
		const plan = mergeRecords(local, remote);
		expect(plan.toWriteLocally).toEqual([row('a', '2026-01-02T00:00:00Z', 'new name')]);
		expect(plan.toPushRemotely).toEqual([]);
	});

	it('pushes a local record that is newer than the remote one', () => {
		const local = [row('a', '2026-01-02T00:00:00Z', 'new name')];
		const remote = [cloud('a', '2026-01-01T00:00:00Z', row('a', '2026-01-01T00:00:00Z', 'old name'))];
		const plan = mergeRecords(local, remote);
		expect(plan.toWriteLocally).toEqual([]);
		expect(plan.toPushRemotely).toEqual([{ id: 'a', updatedAt: '2026-01-02T00:00:00Z', json: JSON.stringify(local[0]) }]);
	});

	it('does nothing when both sides have the same timestamp — already in sync', () => {
		const same = row('a', '2026-01-01T00:00:00Z', 'name');
		const plan = mergeRecords([same], [cloud('a', '2026-01-01T00:00:00Z', same)]);
		expect(plan.toWriteLocally).toEqual([]);
		expect(plan.toPushRemotely).toEqual([]);
	});

	it('pulls a remote-only record (never seen on this device)', () => {
		const remoteOnly = row('b', '2026-01-01T00:00:00Z', 'from another device');
		const plan = mergeRecords<Row>([], [cloud('b', '2026-01-01T00:00:00Z', remoteOnly)]);
		expect(plan.toWriteLocally).toEqual([remoteOnly]);
	});

	it('pushes a local-only record (never synced before)', () => {
		const localOnly = row('c', '2026-01-01T00:00:00Z', 'new on this device');
		const plan = mergeRecords([localOnly], []);
		expect(plan.toPushRemotely).toEqual([{ id: 'c', updatedAt: '2026-01-01T00:00:00Z', json: JSON.stringify(localOnly) }]);
	});

	it('treats a local record with no updatedAt as older than any remote copy', () => {
		const local = [row('a', undefined, 'untimestamped')];
		const remote = [cloud('a', '2026-01-01T00:00:00Z', row('a', '2026-01-01T00:00:00Z', 'from cloud'))];
		const plan = mergeRecords(local, remote);
		expect(plan.toWriteLocally).toHaveLength(1);
		expect(plan.toPushRemotely).toEqual([]);
	});

	it('resolves a mixed batch independently per record', () => {
		const local = [
			row('newer-local', '2026-01-05T00:00:00Z', 'local wins'),
			row('newer-remote', '2026-01-01T00:00:00Z', 'stale'),
			row('in-sync', '2026-01-03T00:00:00Z', 'same')
		];
		const remote = [
			cloud('newer-local', '2026-01-01T00:00:00Z', row('newer-local', '2026-01-01T00:00:00Z', 'stale')),
			cloud('newer-remote', '2026-01-05T00:00:00Z', row('newer-remote', '2026-01-05T00:00:00Z', 'remote wins')),
			cloud('in-sync', '2026-01-03T00:00:00Z', row('in-sync', '2026-01-03T00:00:00Z', 'same'))
		];
		const plan = mergeRecords(local, remote);
		expect(plan.toWriteLocally.map((r) => r.id)).toEqual(['newer-remote']);
		expect(plan.toPushRemotely.map((r) => r.id)).toEqual(['newer-local']);
	});
});
