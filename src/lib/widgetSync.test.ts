import { describe, it, expect, vi } from 'vitest';
import { buildWidgetSnapshot } from '$lib/widgetSync';
import type { Template, WorkoutSession } from '$lib/types';

vi.mock('$lib/native', () => ({ writeWidgetSnapshot: async () => {} }));

const tpl = (id: string, name: string): Template => ({
	id,
	name,
	exercises: [],
	groups: [],
	createdAt: '2026-01-01T00:00:00Z',
	updatedAt: '2026-01-01T00:00:00Z'
});
const sess = (id: string, tplId: string | null, startedAt: string): WorkoutSession => ({
	id,
	startedAt,
	endedAt: startedAt,
	sourceTemplateId: tplId,
	title: 'W',
	exercises: []
});

describe('buildWidgetSnapshot', () => {
	it('suggests the never-trained template as next', () => {
		const templates = [tpl('a', 'Legs'), tpl('b', 'Push')];
		const sessions = [sess('1', 'a', '2026-06-01T00:00:00Z')];
		const snap = buildWidgetSnapshot(sessions, templates);
		expect(snap.nextOrLastTitle).toBe('Push');
		expect(snap.isNext).toBe(true);
	});

	it('suggests the least-recently-trained template when all have history', () => {
		const templates = [tpl('a', 'Legs'), tpl('b', 'Push')];
		const sessions = [
			sess('1', 'a', '2026-06-10T00:00:00Z'),
			sess('2', 'b', '2026-06-01T00:00:00Z') // b trained longest ago
		];
		expect(buildWidgetSnapshot(sessions, templates).nextOrLastTitle).toBe('Push');
	});

	it('falls back to the last logged session when there are no templates', () => {
		const sessions = [sess('1', null, '2026-06-01T00:00:00Z'), sess('2', null, '2026-06-05T00:00:00Z')];
		sessions[1].title = 'Quick log';
		const snap = buildWidgetSnapshot(sessions, []);
		expect(snap.nextOrLastTitle).toBe('Quick log');
		expect(snap.isNext).toBe(false);
	});

	it('empty state: no templates, no sessions', () => {
		const snap = buildWidgetSnapshot([], []);
		expect(snap.nextOrLastTitle).toBe('');
		expect(snap.streakDays).toBe(0);
	});
});
