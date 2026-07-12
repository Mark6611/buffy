// Trends engine — pure derivations from sessions + the exercise catalog.
// Everything is computed at read time; nothing here is stored.
import type { WorkoutSession, Exercise } from '$lib/types';
import { setVolume, sessionVolume, sessionDurationSec } from '$lib/compute';
import { kg, volK, mmss, relativeDay } from '$lib/format';

export type TrendWindow = '4w' | '12w' | 'all';
export const WINDOW_WEEKS: Record<TrendWindow, number> = { '4w': 4, '12w': 12, all: 9999 };

const DAY = 86_400_000;
const WEEK = 7 * DAY;

export function est1RM(weight: number, reps: number): number {
	return weight * (1 + reps / 30);
}

function startOfDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfWeek(d: Date): Date {
	const s = startOfDay(d);
	s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); // Monday
	return s;
}
// Calendar-safe day arithmetic. Adding a fixed 86_400_000 ms to a local-midnight
// epoch lands an hour off across a DST transition (local midnights are 23 or 25 h
// apart), which shifts week/day buckets by one and silently drops sessions or breaks
// streaks. setDate() steps by calendar days regardless of DST, so all week/day
// indices below are derived through this, never through ± DAY/WEEK on raw epochs.
function addDays(d: Date, days: number): Date {
	const r = new Date(d);
	r.setDate(r.getDate() + days);
	return r;
}
// whole weeks from base (a local-midnight Monday) to the week of `date`; round
// absorbs the ±1 h DST drift that would make floor land on the wrong bucket.
function weekIndex(date: Date, base: Date): number {
	return Math.round((startOfWeek(date).getTime() - base.getTime()) / WEEK);
}
function md(d: Date): string {
	return `${d.getMonth() + 1}/${d.getDate()}`;
}

function weeksInWindow(sessions: WorkoutSession[], win: TrendWindow, now: Date): number {
	if (win !== 'all') return WINDOW_WEEKS[win];
	const first = sessions.reduce((min, s) => Math.min(min, Date.parse(s.startedAt)), now.getTime());
	return Math.max(1, Math.round((startOfWeek(now).getTime() - startOfWeek(new Date(first)).getTime()) / WEEK) + 1);
}
function windowStart(n: number, now: Date): Date {
	return addDays(startOfWeek(now), -(n - 1) * 7); // local-midnight Monday of the oldest week
}
function inWindow(sessions: WorkoutSession[], win: TrendWindow, now: Date): WorkoutSession[] {
	const n = weeksInWindow(sessions, win, now);
	const cut = windowStart(n, now).getTime();
	return sessions
		.filter((s) => Date.parse(s.startedAt) >= cut)
		.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

// ---- KPIs (this week vs last) -----------------------------------------------
export interface Kpis {
	streakDays: number;
	volThisWeek: number;
	volDeltaPct: number | null;
	sessionsThisWeek: number;
	sessionsDelta: number;
	timeThisWeekSec: number;
	timeDeltaPct: number | null;
}
export function kpis(sessions: WorkoutSession[], now = new Date()): Kpis {
	const tw0d = startOfWeek(now);
	const tw0 = tw0d.getTime();
	const lw0 = addDays(tw0d, -7).getTime();
	const nw0 = addDays(tw0d, 7).getTime();
	const between = (from: number, to: number) =>
		sessions.filter((s) => {
			const t = Date.parse(s.startedAt);
			return t >= from && t < to;
		});
	const tw = between(tw0, nw0);
	const lw = between(lw0, tw0);
	const vol = (a: WorkoutSession[]) => a.reduce((x, s) => x + sessionVolume(s), 0);
	const time = (a: WorkoutSession[]) => a.reduce((x, s) => x + (sessionDurationSec(s) ?? 0), 0);
	const pct = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
	return {
		streakDays: streakDays(sessions, now),
		volThisWeek: vol(tw),
		volDeltaPct: pct(vol(tw), vol(lw)),
		sessionsThisWeek: tw.length,
		sessionsDelta: tw.length - lw.length,
		timeThisWeekSec: time(tw),
		timeDeltaPct: pct(time(tw), time(lw))
	};
}

/** Consecutive days (ending today/yesterday) with at least one session. */
export function streakDays(sessions: WorkoutSession[], now = new Date()): number {
	const days = new Set(sessions.map((s) => startOfDay(new Date(s.startedAt)).getTime()));
	let cursor = startOfDay(now);
	if (!days.has(cursor.getTime())) cursor = startOfDay(addDays(cursor, -1)); // today may be a rest day
	let streak = 0;
	while (days.has(cursor.getTime())) {
		streak++;
		cursor = startOfDay(addDays(cursor, -1)); // calendar step — DST-safe, never lands at 23:00/01:00
	}
	return streak;
}

// ---- Weekly volume (thousands of kg) ----------------------------------------
export interface WeeklyVolume {
	weeks: { l: string; v: number }[];
	totalK: number;
}
export function weeklyVolume(sessions: WorkoutSession[], win: TrendWindow, now = new Date()): WeeklyVolume {
	const n = weeksInWindow(sessions, win, now);
	const base = windowStart(n, now);
	const buckets = Array.from({ length: n }, () => 0);
	for (const s of inWindow(sessions, win, now)) {
		const wi = weekIndex(new Date(s.startedAt), base);
		if (wi >= 0 && wi < n) buckets[wi] += sessionVolume(s);
	}
	return {
		weeks: buckets.map((v, i) => ({ l: md(addDays(base, i * 7)), v: Math.round((v / 1000) * 10) / 10 })),
		totalK: Math.round(buckets.reduce((a, b) => a + b, 0) / 1000)
	};
}

// ---- Consistency heatmap: weeks × 7 (Mon..Sun), intensity 0..3 --------------
export interface Heat {
	weeks: number[][];
	sessions: number;
	perWeek: number;
}
export function heatmap(sessions: WorkoutSession[], win: TrendWindow, now = new Date()): Heat {
	const n = weeksInWindow(sessions, win, now);
	const base = windowStart(n, now);
	const list = inWindow(sessions, win, now);
	const dayVol = new Map<number, number>();
	const daysTrained = new Set<number>();
	for (const s of list) {
		const d = startOfDay(new Date(s.startedAt)).getTime();
		dayVol.set(d, (dayVol.get(d) ?? 0) + sessionVolume(s));
		daysTrained.add(d); // a bodyweight-only day has 0 volume but is still a trained day
	}
	const max = Math.max(1, ...dayVol.values());
	const weeks: number[][] = [];
	for (let w = 0; w < n; w++) {
		const row: number[] = [];
		for (let d = 0; d < 7; d++) {
			const key = startOfDay(addDays(base, w * 7 + d)).getTime();
			const v = dayVol.get(key) ?? 0;
			// floor any trained day to 1 so calisthenics-only sessions (volume 0) never
			// render identical to a rest day while still counting in the header/streak.
			row.push(v > max * 0.66 ? 3 : v > max * 0.33 ? 2 : v > 0 || daysTrained.has(key) ? 1 : 0);
		}
		weeks.push(row);
	}
	return { weeks, sessions: list.length, perWeek: Math.round((list.length / n) * 10) / 10 };
}

// ---- Per-exercise progression + PRs -----------------------------------------
export interface PR {
	ic: string;
	l: string;
	v: string;
	when: string;
}
export interface Progression {
	labels: string[];
	topset: number[];
	e1rm: number[];
	reps: number[];
	hasWeight: boolean;
	isTime: boolean;
	bw: boolean;
	sessionCount: number;
	prs: PR[];
	summary: string;
}
export function progression(sessions: WorkoutSession[], ex: Exercise, win: TrendWindow, now = new Date()): Progression {
	const list = inWindow(sessions, win, now).filter((s) => s.exercises.some((e) => e.exerciseId === ex.id));
	const bw = ex.loadType === 'bodyweight';
	const isTime = ex.trackingType === 'time_hold';
	const isCardio = ex.trackingType === 'cardio';
	const hasWeight = ex.trackingType === 'weight_reps' && !bw;

	const labels: string[] = [];
	const topset: number[] = [];
	const e1rm: number[] = [];
	const reps: number[] = [];

	let bestW = 0,
		bestWDate = '',
		best1 = 0,
		best1Date = '',
		bestReps = 0,
		bestRepsW = 0,
		bestRepsDate = '',
		bestVol = 0,
		bestVolDate = '',
		bestHold = 0,
		bestHoldDate = '';

	for (const s of list) {
		const le = s.exercises.find((e) => e.exerciseId === ex.id)!;
		const sets = le.sets.filter((x) => x.completed);
		if (!sets.length) continue;
		labels.push(md(new Date(s.startedAt)));
		if (isTime) {
			const hold = Math.max(...sets.map((x) => x.durationSec ?? 0));
			topset.push(hold);
			reps.push(0);
			e1rm.push(0);
			if (hold > bestHold) ((bestHold = hold), (bestHoldDate = s.startedAt));
		} else if (bw) {
			const r = Math.max(...sets.map((x) => x.reps ?? 0));
			const total = sets.reduce((a, x) => a + (x.reps ?? 0), 0);
			topset.push(r);
			reps.push(r);
			e1rm.push(0);
			if (r > bestReps) ((bestReps = r), (bestRepsDate = s.startedAt));
			if (total > bestVol) ((bestVol = total), (bestVolDate = s.startedAt));
		} else if (isCardio) {
			topset.push(Math.round(Math.max(...sets.map((x) => x.timeSec ?? 0)) / 60));
			reps.push(0);
			e1rm.push(0);
		} else {
			let topW = 0,
				topWReps = 0,
				e = 0,
				vol = 0,
				mReps = 0,
				mRepsW = 0;
			for (const x of sets) {
				const w = x.weight ?? 0,
					r = x.reps ?? 0;
				vol += setVolume(x);
				if (w > topW) ((topW = w), (topWReps = r));
				const e1 = est1RM(w, r);
				if (e1 > e) e = e1;
				if (r > mReps) ((mReps = r), (mRepsW = w));
			}
			topset.push(topW);
			e1rm.push(Math.round(e));
			reps.push(topWReps);
			if (topW > bestW) ((bestW = topW), (bestWDate = s.startedAt));
			if (e > best1) ((best1 = e), (best1Date = s.startedAt));
			if (mReps > bestReps) ((bestReps = mReps), (bestRepsW = mRepsW), (bestRepsDate = s.startedAt));
			if (vol > bestVol) ((bestVol = vol), (bestVolDate = s.startedAt));
		}
	}

	const prs: PR[] = [];
	if (hasWeight) {
		if (bestW) prs.push({ ic: 'dumbbell', l: 'Heaviest weight', v: `${kg(bestW)} kg`, when: relativeDay(bestWDate, now) });
		if (best1) prs.push({ ic: 'trend', l: 'Best est. 1RM', v: `${Math.round(best1)} kg`, when: relativeDay(best1Date, now) });
		if (bestReps) prs.push({ ic: 'arrowU', l: 'Most reps', v: `${bestReps} @ ${kg(bestRepsW)} kg`, when: relativeDay(bestRepsDate, now) });
		if (bestVol) prs.push({ ic: 'chart', l: 'Top session volume', v: `${volK(bestVol)} kg`, when: relativeDay(bestVolDate, now) });
	} else if (bw) {
		if (bestReps) prs.push({ ic: 'arrowU', l: 'Most reps', v: `${bestReps} reps`, when: relativeDay(bestRepsDate, now) });
		if (bestVol) prs.push({ ic: 'chart', l: 'Most reps in a session', v: `${bestVol} reps`, when: relativeDay(bestVolDate, now) });
	} else if (isTime) {
		if (bestHold) prs.push({ ic: 'clock', l: 'Longest hold', v: mmss(bestHold), when: relativeDay(bestHoldDate, now) });
	}

	const first = topset[0] ?? 0;
	const last = topset.at(-1) ?? 0;
	const pct = first > 0 ? Math.round(((last - first) / first) * 100) : 0;
	const fmt = (n: number) => (hasWeight ? `${kg(n)}` : isTime ? mmss(n) : `${n}`);
	const unit = hasWeight ? ' kg' : bw ? ' reps' : '';
	const summary = topset.length
		? `${fmt(first)} → ${fmt(last)}${unit} · ${pct >= 0 ? '+' : ''}${pct}%`
		: 'no data yet';

	return { labels, topset, e1rm, reps, hasWeight, isTime, bw, sessionCount: labels.length, prs, summary };
}

// ---- Recent PRs feed --------------------------------------------------------
export interface PRFeed {
	ex: string;
	equipment: Exercise['equipment'];
	kind: string;
	v: string;
	delta: string;
	when: string;
	date: string;
}
export function recentPRs(sessions: WorkoutSession[], byId: Map<string, Exercise>, now = new Date()): PRFeed[] {
	const asc = [...sessions].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
	const ids = new Set<string>();
	for (const s of sessions) for (const e of s.exercises) ids.add(e.exerciseId);
	const out: PRFeed[] = [];
	for (const id of ids) {
		const ex = byId.get(id);
		if (!ex || ex.trackingType === 'cardio') continue;
		const bw = ex.loadType === 'bodyweight';
		const isTime = ex.trackingType === 'time_hold';
		let best = 0,
			prev = 0,
			date = '';
		for (const s of asc) {
			const le = s.exercises.find((e) => e.exerciseId === id);
			if (!le) continue;
			const sets = le.sets.filter((x) => x.completed);
			if (!sets.length) continue;
			const m = isTime
				? Math.max(...sets.map((x) => x.durationSec ?? 0))
				: bw
					? Math.max(...sets.map((x) => x.reps ?? 0))
					: Math.max(...sets.map((x) => x.weight ?? 0));
			if (m > best) ((prev = best), (best = m), (date = s.startedAt));
		}
		if (!date || prev === 0) continue; // needs a prior best to count as a PR
		const d = best - prev;
		out.push({
			ex: ex.name,
			equipment: ex.equipment,
			kind: isTime ? 'Longest hold' : bw ? 'Reps' : 'Weight',
			v: isTime ? mmss(best) : bw ? `${best} reps` : `${kg(best)} kg`,
			delta: isTime ? `+${Math.round(d)}s` : bw ? `+${d}` : `+${kg(d)}`,
			when: relativeDay(date, now),
			date
		});
	}
	return out.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 6);
}

/** Best weight_reps exercise (most sessions) for the overview sparkline preview. */
export function progressionPreview(sessions: WorkoutSession[], byId: Map<string, Exercise>, win: TrendWindow, now = new Date()) {
	const counts = new Map<string, number>();
	for (const s of inWindow(sessions, win, now)) for (const e of s.exercises) counts.set(e.exerciseId, (counts.get(e.exerciseId) ?? 0) + 1);
	let bestId = '';
	let bestN = 1;
	for (const [id, n] of counts) {
		const ex = byId.get(id);
		if (ex && ex.trackingType === 'weight_reps' && ex.loadType !== 'bodyweight' && n >= bestN) ((bestN = n), (bestId = id));
	}
	const ex = byId.get(bestId);
	if (!ex) return null;
	const p = progression(sessions, ex, win, now);
	if (p.topset.length < 2) return null;
	return { exercise: ex, summary: p.summary, spark: p.topset };
}

// ---- Muscle balance ---------------------------------------------------------
export function muscleSets(sessions: WorkoutSession[], byId: Map<string, Exercise>, win: TrendWindow, now = new Date()): { l: string; v: number; low: boolean }[] {
	const m = new Map<string, number>();
	for (const s of inWindow(sessions, win, now))
		for (const le of s.exercises) {
			const ex = byId.get(le.exerciseId);
			if (!ex) continue;
			const sets = le.sets.filter((x) => x.completed).length;
			for (const mus of ex.primaryMuscles) m.set(mus, (m.get(mus) ?? 0) + sets);
		}
	const arr = [...m.entries()].map(([l, v]) => ({ l, v })).sort((a, b) => b.v - a.v);
	const max = arr[0]?.v ?? 1;
	return arr.map((d) => ({ ...d, low: d.v < max * 0.5 }));
}

const FRONT = ['Shoulders', 'Chest', 'Abs', 'Biceps', 'Quads'];
const BACK = ['Traps', 'Shoulders', 'Back', 'Triceps', 'Glutes', 'Hamstrings', 'Calves'];
const ALIAS: Record<string, string> = { Lats: 'Back' };
export function bodyMap(sessions: WorkoutSession[], byId: Map<string, Exercise>, win: TrendWindow, now = new Date()) {
	const sets = new Map<string, number>();
	for (const s of inWindow(sessions, win, now))
		for (const le of s.exercises) {
			const ex = byId.get(le.exerciseId);
			if (!ex) continue;
			const n = le.sets.filter((x) => x.completed).length;
			for (const mus of ex.primaryMuscles) {
				const k = ALIAS[mus] ?? mus;
				sets.set(k, (sets.get(k) ?? 0) + n);
			}
		}
	const max = Math.max(1, ...sets.values());
	const norm = (k: string) => Math.min(1, (sets.get(k) ?? 0) / max);
	const front: Record<string, number> = {};
	const back: Record<string, number> = {};
	FRONT.forEach((k) => (front[k] = norm(k)));
	BACK.forEach((k) => (back[k] = norm(k)));
	return { front, back };
}

const PUSH = new Set(['Chest', 'Shoulders', 'Triceps', 'Quads', 'Calves']);
const PULL = new Set(['Lats', 'Back', 'Biceps', 'Hamstrings', 'Traps']);
/** Weekly push vs pull set counts (last up-to-8 weeks) — for the balance trend line. */
export function pushPull(sessions: WorkoutSession[], byId: Map<string, Exercise>, win: TrendWindow, now = new Date()) {
	const n = weeksInWindow(sessions, win, now);
	const base = windowStart(n, now);
	const push = Array.from({ length: n }, () => 0);
	const pull = Array.from({ length: n }, () => 0);
	for (const s of inWindow(sessions, win, now)) {
		const wi = weekIndex(new Date(s.startedAt), base);
		if (wi < 0 || wi >= n) continue;
		for (const le of s.exercises) {
			const ex = byId.get(le.exerciseId);
			if (!ex) continue;
			const sets = le.sets.filter((x) => x.completed).length;
			for (const m of ex.primaryMuscles) {
				if (PUSH.has(m)) push[wi] += sets;
				if (PULL.has(m)) pull[wi] += sets;
			}
		}
	}
	const labels = Array.from({ length: n }, (_, i) => md(addDays(base, i * 7)));
	const start = Math.max(0, n - 8);
	return { labels: labels.slice(start), push: push.slice(start), pull: pull.slice(start) };
}
