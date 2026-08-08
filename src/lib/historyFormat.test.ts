import { describe, it, expect } from 'vitest';
import { dayWithYear } from '$lib/historyFormat';

// Local-midnight fixtures so the assertions hold in any timezone.
const at = (y: number, m: number, d: number) => new Date(y, m, d, 9, 0, 0).toISOString();
const now = new Date(2026, 0, 20, 9, 0, 0); // 20 Jan 2026

describe('dayWithYear', () => {
	it('disambiguates the same calendar day in different years', () => {
		const thisYear = dayWithYear(at(2026, 0, 5), now);
		const lastYear = dayWithYear(at(2025, 0, 5), now);
		expect(thisYear).not.toBe(lastYear);
		expect(lastYear).toContain('2025');
		expect(thisYear).not.toContain('2026'); // the current year stays implicit
	});

	it('leaves the relative labels untouched', () => {
		expect(dayWithYear(at(2026, 0, 20), now)).toBe('Today');
		expect(dayWithYear(at(2026, 0, 19), now)).toBe('Yesterday');
		expect(dayWithYear(at(2026, 0, 17), now)).toBe('3 days ago');
	});

	it('keeps a relative label that crosses the new year', () => {
		// 30 Dec is a different year but still inside relativeDay's relative window
		const nye = new Date(2026, 0, 1, 9, 0, 0);
		expect(dayWithYear(at(2025, 11, 30), nye)).toBe('2 days ago');
	});

	it('appends the year to the absolute fallback', () => {
		expect(dayWithYear(at(2025, 4, 31), now)).toBe('Sat 31 May 2025');
	});

	it('returns relativeDay unchanged for an unparseable date', () => {
		expect(dayWithYear('not-a-date', now)).toBe(relativeDayFallback());
	});
});

// relativeDay('not-a-date') produces "undefined NaN undefined"; the point of the test
// is only that dayWithYear passes it through instead of appending "NaN".
function relativeDayFallback(): string {
	return `${undefined} ${NaN} ${undefined}`;
}
