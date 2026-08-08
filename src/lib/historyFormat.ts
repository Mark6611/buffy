// History-screen date labels.
//
// relativeDay() (format.ts) ends at "Sat 31 May" — no year — so once a user has more
// than a year of training, a session from January 2025 and one from January 2026 read
// identically in a list that has no separators either. This WRAPS relativeDay rather
// than changing it: the year is only wanted where a long history is scanned, and the
// relative branches ("Today", "Yesterday", "3 days ago") already place a date
// unambiguously and must keep their exact wording everywhere else in the app.
import { relativeDay } from '$lib/format';

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * ISO → relativeDay(), with the year appended when the date falls outside the current
 * calendar year AND relativeDay has dropped to its absolute "Sat 31 May" fallback.
 */
export function dayWithYear(iso: string, now: Date = new Date()): string {
	const label = relativeDay(iso, now);
	const d = new Date(iso);
	const year = d.getFullYear();
	if (!Number.isFinite(year) || year === now.getFullYear()) return label;
	if (label.includes(String(year))) return label; // relativeDay already carries it
	// relativeDay is relative for 0..6 days ago; anything else is the absolute branch.
	const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
	if (days >= 0 && days < 7) return label;
	return `${label} ${year}`;
}
