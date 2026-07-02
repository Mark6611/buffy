// Pair a Buffy session with the Whoop workout covering the same stretch of
// time. Whoop's auto-detected windows never line up exactly with when the user
// tapped Start/Finish, so exact matching is useless — instead score candidates
// by overlap and demand the overlap be meaningful for BOTH records, so a long
// Whoop "activity" that merely brushes the session can't win.
export interface TimeWindow {
	/** ISO */
	start: string;
	/** ISO */
	end: string;
}

/** Overlap in ms between two windows (0 when disjoint or unparseable). */
export function overlapMs(a: TimeWindow, b: TimeWindow): number {
	const aS = Date.parse(a.start);
	const aE = Date.parse(a.end);
	const bS = Date.parse(b.start);
	const bE = Date.parse(b.end);
	if (!Number.isFinite(aS) || !Number.isFinite(aE) || !Number.isFinite(bS) || !Number.isFinite(bE)) return 0;
	return Math.max(0, Math.min(aE, bE) - Math.max(aS, bS));
}

/**
 * The candidate that best matches `session`, or null when nothing overlaps
 * convincingly: the shared time must cover ≥ half of the SHORTER of the two
 * windows (a strict-both-sides rule punishes wildly different durations).
 */
export function bestOverlap<T extends TimeWindow>(session: TimeWindow, candidates: T[]): T | null {
	let best: T | null = null;
	let bestMs = 0;
	for (const c of candidates) {
		const ms = overlapMs(session, c);
		if (ms > bestMs) {
			bestMs = ms;
			best = c;
		}
	}
	if (!best) return null;
	const shorter = Math.min(
		Date.parse(session.end) - Date.parse(session.start),
		Date.parse(best.end) - Date.parse(best.start)
	);
	return shorter > 0 && bestMs >= shorter * 0.5 ? best : null;
}
