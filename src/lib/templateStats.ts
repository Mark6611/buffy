// Per-template usage, derived from logged sessions at read time (never stored —
// same rule as $lib/compute).
//
// This lived inline inside buildWidgetSnapshot, which needed "when was each
// template last trained" to pick the next one to suggest. The home cards want
// the same answer, so the definition moved here and widgetSync now imports it:
// one definition, one place to fix, and the widget and the library can't drift
// apart on what "last trained" means.
import type { ID, WorkoutSession } from '$lib/types';

export interface TemplateStat {
	/** finished sessions started from this template */
	timesCompleted: number;
	/** ISO startedAt of the most recent one; null if none carried a usable date */
	lastPerformedAt: string | null;
	/** …the same instant in epoch ms, for sorting. -Infinity when lastPerformedAt is null. */
	lastPerformedMs: number;
}

/**
 * template id → usage. Only FINISHED sessions count (endedAt set): an
 * in-progress session never reaches the repository, but a restored backup or an
 * iCloud pull can carry one, and "3 times completed" must mean completed.
 * Tombstoned sessions are ignored — listSessions() already hides them, but this
 * is also fed straight from sync/backup arrays, which do not.
 *
 * Templates with no history are simply absent from the map (callers decide what
 * "never" looks like) rather than carrying a zero entry for every template.
 */
export function templateStats(sessions: WorkoutSession[]): Map<ID, TemplateStat> {
	const out = new Map<ID, TemplateStat>();
	for (const s of sessions) {
		if (!s.sourceTemplateId) continue; // ad-hoc quick log — belongs to no template
		if (!s.endedAt) continue;
		if (s.deletedAt) continue;

		const cur = out.get(s.sourceTemplateId);
		const stat: TemplateStat = cur ?? { timesCompleted: 0, lastPerformedAt: null, lastPerformedMs: -Infinity };
		stat.timesCompleted++;

		// A bad date must not poison the max: NaN loses every comparison, so the
		// old inline version latched onto it forever once it won the first slot.
		const ms = Date.parse(s.startedAt);
		if (Number.isFinite(ms) && ms > stat.lastPerformedMs) {
			stat.lastPerformedMs = ms;
			stat.lastPerformedAt = s.startedAt;
		}
		if (!cur) out.set(s.sourceTemplateId, stat);
	}
	return out;
}
