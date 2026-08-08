import { describe, it, expect } from 'vitest';
import { streakDays, weeklyVolume, heatmap, progression, recentPRs } from './analytics';
import type { Exercise, WorkoutSession } from '$lib/types';

// Fixed reference point; fixtures are positioned relative to it via calendar steps
// (setDate), so these hold in any timezone. The DST-boundary cases the calendar-math
// fix targets need a TZ-pinned runner (TZ=America/New_York) to reproduce; these pin
// the everyday behaviour and the bodyweight-day regression.
const now = new Date(2026, 5, 15, 9, 0, 0);
function daysAgo(n: number, hour = 8): string {
	const d = new Date(now);
	d.setDate(d.getDate() - n);
	d.setHours(hour, 0, 0, 0);
	return d.toISOString();
}
function sess(startedAt: string, sets: Array<{ reps?: number; weight?: number }>): WorkoutSession {
	return {
		id: 'sess-' + startedAt,
		startedAt,
		endedAt: startedAt,
		exercises: [{ exerciseId: 'x', groupId: null, sets: sets.map((s, i) => ({ index: i, completed: true, ...s })) }]
	} as WorkoutSession;
}

describe('streakDays', () => {
	it('counts consecutive training days ending today', () => {
		const s = [0, 1, 2].map((n) => sess(daysAgo(n), [{ reps: 5, weight: 10 }]));
		expect(streakDays(s, now)).toBe(3);
	});
	it('counts a streak ending yesterday when today is a rest day', () => {
		const s = [1, 2].map((n) => sess(daysAgo(n), [{ reps: 5, weight: 10 }]));
		expect(streakDays(s, now)).toBe(2);
	});
	it('breaks on a gap', () => {
		const s = [sess(daysAgo(0), [{ reps: 5, weight: 10 }]), sess(daysAgo(2), [{ reps: 5, weight: 10 }])];
		expect(streakDays(s, now)).toBe(1);
	});
});

describe('weeklyVolume', () => {
	it('buckets this week into the most recent bucket', () => {
		const wv = weeklyVolume([sess(daysAgo(0), [{ reps: 10, weight: 20 }])], '4w', now); // 200 kg
		expect(wv.weeks.length).toBe(4);
		expect(wv.weeks[3].v).toBeCloseTo(0.2, 5);
		expect(wv.weeks[0].v).toBe(0);
	});
});

describe('heatmap', () => {
	it('marks a bodyweight-only day (zero volume) as trained, not a rest day', () => {
		const h = heatmap([sess(daysAgo(0), [{ reps: 10 }])], '4w', now); // no weight → volume 0
		expect(h.sessions).toBe(1);
		expect(h.weeks.flat().filter((c) => c >= 1).length).toBe(1);
	});
	it('leaves genuinely untrained days at 0', () => {
		const h = heatmap([sess(daysAgo(0), [{ reps: 10, weight: 20 }])], '4w', now);
		// 4 weeks × 7 days = 28 cells, exactly one trained
		expect(h.weeks.flat().filter((c) => c === 0).length).toBe(27);
	});
});

// A "personal record" that changes when you flip the window control isn't a record.
// The chart stays windowed; the PR block reports all-time and says so in its labels.
const bench: Exercise = {
	id: 'x',
	name: 'Bench',
	equipment: 'barbell',
	primaryMuscles: ['Chest'],
	secondaryMuscles: [],
	trackingType: 'weight_reps',
	loadType: 'total'
};

describe('progression PRs', () => {
	// peaked at 100 kg six months ago, back to 60 kg last week — the heavy lift is
	// outside every window except 'all'
	const sessions = [
		sess(daysAgo(180), [{ reps: 3, weight: 80 }]),
		sess(daysAgo(170), [{ reps: 3, weight: 100 }]),
		sess(daysAgo(5), [{ reps: 5, weight: 60 }])
	];

	it('reports the same heaviest lift in every window', () => {
		for (const win of ['4w', '12w', 'all'] as const) {
			const heaviest = progression(sessions, bench, win, now).prs.find((p) => p.l.includes('heaviest'));
			expect(heaviest?.v).toBe('100 kg');
		}
	});

	it('labels the records all-time so they do not read as claims about the chart', () => {
		const p = progression(sessions, bench, '4w', now);
		expect(p.prs.length).toBeGreaterThan(0);
		for (const pr of p.prs) expect(pr.l.startsWith('All-time')).toBe(true);
	});

	it('still windows the chart series', () => {
		// only the recent session is inside 4 weeks
		expect(progression(sessions, bench, '4w', now).topset).toEqual([60]);
		expect(progression(sessions, bench, 'all', now).topset).toEqual([80, 100, 60]);
	});

	it('agrees with the all-time number the Trends PR feed shows', () => {
		const feed = recentPRs(sessions, new Map([[bench.id, bench]]), now);
		const windowed = progression(sessions, bench, '4w', now).prs.find((p) => p.l.includes('heaviest'));
		expect(feed[0].v).toBe(windowed?.v);
	});
});
