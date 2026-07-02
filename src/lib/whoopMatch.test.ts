import { describe, it, expect } from 'vitest';
import { overlapMs, bestOverlap } from '$lib/whoopMatch';

const w = (start: string, end: string, id = '') => ({ start, end, id });

describe('overlapMs', () => {
	it('computes the shared span', () => {
		expect(overlapMs(w('2026-07-02T10:00:00Z', '2026-07-02T11:00:00Z'), w('2026-07-02T10:30:00Z', '2026-07-02T11:30:00Z'))).toBe(
			30 * 60_000
		);
	});
	it('zero when disjoint', () => {
		expect(overlapMs(w('2026-07-02T10:00:00Z', '2026-07-02T11:00:00Z'), w('2026-07-02T12:00:00Z', '2026-07-02T13:00:00Z'))).toBe(0);
	});
	it('zero on unparseable timestamps', () => {
		expect(overlapMs(w('nope', '2026-07-02T11:00:00Z'), w('2026-07-02T10:00:00Z', '2026-07-02T11:00:00Z'))).toBe(0);
	});
});

describe('bestOverlap', () => {
	const session = w('2026-07-02T10:00:00Z', '2026-07-02T11:00:00Z');

	it('picks the candidate sharing the most time', () => {
		const near = w('2026-07-02T10:05:00Z', '2026-07-02T11:10:00Z', 'near');
		const far = w('2026-07-02T08:00:00Z', '2026-07-02T10:10:00Z', 'far');
		expect(bestOverlap(session, [far, near])?.id).toBe('near');
	});

	it('null when nothing overlaps', () => {
		expect(bestOverlap(session, [w('2026-07-02T12:00:00Z', '2026-07-02T13:00:00Z')])).toBeNull();
	});

	it('rejects a graze: overlap must cover half the shorter window', () => {
		// 10-minute brush against the hour-long session
		const graze = w('2026-07-02T10:50:00Z', '2026-07-02T12:00:00Z', 'graze');
		expect(bestOverlap(session, [graze])).toBeNull();
	});

	it('a short whoop workout fully inside the session still matches', () => {
		// 20-minute detected activity inside the hour: covers 100% of the shorter window
		const inside = w('2026-07-02T10:20:00Z', '2026-07-02T10:40:00Z', 'inside');
		expect(bestOverlap(session, [inside])?.id).toBe('inside');
	});

	it('empty candidate list → null', () => {
		expect(bestOverlap(session, [])).toBeNull();
	});
});
