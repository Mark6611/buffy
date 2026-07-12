// Display formatting helpers. Keep data mono + tabular per the design.
import type { Equipment } from '$lib/types';

/** seconds → "mm:ss"; negative (overage) → "+mm:ss" */
export function mmss(totalSec: number): string {
	const neg = totalSec < 0;
	const s = Math.abs(Math.round(totalSec));
	const m = Math.floor(s / 60);
	const r = s % 60;
	return `${neg ? '+' : ''}${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** "mm:ss" or "m:ss" → seconds (0 on blank/dash) */
export function parseMmss(v: string): number {
	const t = v.trim();
	if (!t || t === '—' || t === '-') return 0;
	const parts = t.split(':').map((n) => parseInt(n, 10) || 0);
	return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
}

/** kg number → trimmed string (40, 12.5, 5.7) */
export function kg(n: number | undefined | null): string {
	if (n == null) return '';
	return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
}

/** volume in kg → compact ("6.4K", "940") */
export function volK(n: number): string {
	if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
	return String(Math.round(n));
}

export function equipLabel(e: Equipment): string {
	return e.charAt(0).toUpperCase() + e.slice(1);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** ISO → "Today" / "Yesterday" / "Sat 31 May" */
export function relativeDay(iso: string, now: Date = new Date()): string {
	const d = new Date(iso);
	const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
	const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
	if (days === 0) return 'Today';
	if (days === 1) return 'Yesterday';
	if (days > 1 && days < 7) return `${days} days ago`;
	return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** ISO → "15:24" */
export function hhmm(iso: string): string {
	const d = new Date(iso);
	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** seconds → "H:MM" clock. Rounds to whole minutes and carries — never "1:60". */
export function hoursMinutes(sec: number): string {
	const m = Math.round(sec / 60);
	return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** seconds → "45 min" / "1 hr 15 min" */
export function durationLabel(sec: number): string {
	const m = Math.round(sec / 60);
	if (m < 60) return `${m} min`;
	const h = Math.floor(m / 60);
	const rem = m % 60;
	return rem ? `${h} hr ${rem} min` : `${h} hr`;
}
