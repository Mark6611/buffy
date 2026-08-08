import { describe, it, expect } from 'vitest';
import { templateStats } from '$lib/templateStats';
import type { WorkoutSession } from '$lib/types';

const sess = (
	id: string,
	tplId: string | null,
	startedAt: string,
	extra: Partial<WorkoutSession> = {}
): WorkoutSession => ({
	id,
	startedAt,
	endedAt: startedAt,
	sourceTemplateId: tplId,
	title: 'W',
	exercises: [],
	...extra
});

describe('templateStats', () => {
	it('counts finished sessions per template and keeps the most recent date', () => {
		const stats = templateStats([
			sess('1', 'a', '2026-06-01T08:00:00Z'),
			sess('2', 'a', '2026-06-10T08:00:00Z'),
			sess('3', 'a', '2026-06-05T08:00:00Z'),
			sess('4', 'b', '2026-06-02T08:00:00Z')
		]);
		expect(stats.get('a')).toEqual({
			timesCompleted: 3,
			lastPerformedAt: '2026-06-10T08:00:00Z',
			lastPerformedMs: Date.parse('2026-06-10T08:00:00Z')
		});
		expect(stats.get('b')?.timesCompleted).toBe(1);
	});

	it('leaves a never-trained template out of the map entirely', () => {
		const stats = templateStats([sess('1', 'a', '2026-06-01T08:00:00Z')]);
		expect(stats.has('b')).toBe(false);
		expect(stats.get('b')?.timesCompleted ?? 0).toBe(0);
	});

	it('ignores ad-hoc quick logs (no sourceTemplateId)', () => {
		const stats = templateStats([sess('1', null, '2026-06-01T08:00:00Z')]);
		expect(stats.size).toBe(0);
	});

	it('ignores unfinished sessions — "completed" must mean completed', () => {
		const stats = templateStats([
			sess('1', 'a', '2026-06-01T08:00:00Z'),
			sess('2', 'a', '2026-06-09T08:00:00Z', { endedAt: undefined })
		]);
		expect(stats.get('a')?.timesCompleted).toBe(1);
		expect(stats.get('a')?.lastPerformedAt).toBe('2026-06-01T08:00:00Z');
	});

	it('ignores tombstoned sessions', () => {
		const stats = templateStats([
			sess('1', 'a', '2026-06-01T08:00:00Z'),
			sess('2', 'a', '2026-06-09T08:00:00Z', { deletedAt: '2026-06-09T09:00:00Z' })
		]);
		expect(stats.get('a')?.timesCompleted).toBe(1);
		expect(stats.get('a')?.lastPerformedAt).toBe('2026-06-01T08:00:00Z');
	});

	it('does not let an unparseable date latch the last-performed slot', () => {
		// NaN loses every comparison, so an early bad date used to win the slot and
		// then refuse to be beaten by any real one.
		const stats = templateStats([
			sess('1', 'a', 'not-a-date'),
			sess('2', 'a', '2026-06-09T08:00:00Z')
		]);
		expect(stats.get('a')?.timesCompleted).toBe(2);
		expect(stats.get('a')?.lastPerformedAt).toBe('2026-06-09T08:00:00Z');
	});

	it('reports never-dated history as null rather than NaN', () => {
		const stats = templateStats([sess('1', 'a', 'not-a-date')]);
		expect(stats.get('a')?.lastPerformedAt).toBe(null);
		expect(stats.get('a')?.lastPerformedMs).toBe(-Infinity);
	});

	it('is empty for no sessions', () => {
		expect(templateStats([]).size).toBe(0);
	});
});
