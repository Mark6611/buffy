// Builds the small summary pushed to the native home-screen widget. Pure and
// testable; the actual native write happens in $lib/native (no-ops on web).
import { kpis } from '$lib/analytics';
import { writeWidgetSnapshot } from '$lib/native';
import type { Template, WorkoutSession } from '$lib/types';

export interface WidgetSnapshot {
	streakDays: number;
	volumeThisWeekKg: number;
	sessionsThisWeek: number;
	nextOrLastTitle: string;
	isNext: boolean;
}

/** "Next" = the template least recently trained (or never); falls back to the
 *  last logged workout's title if there are no templates to suggest. */
export function buildWidgetSnapshot(sessions: WorkoutSession[], templates: Template[]): WidgetSnapshot {
	const k = kpis(sessions);
	let nextOrLastTitle = '';
	let isNext = false;

	if (templates.length > 0) {
		const lastUsed = new Map<string, number>();
		for (const s of sessions) {
			if (!s.sourceTemplateId) continue;
			const t = Date.parse(s.startedAt);
			const prev = lastUsed.get(s.sourceTemplateId);
			if (prev == null || t > prev) lastUsed.set(s.sourceTemplateId, t);
		}
		let pick: Template | null = null;
		let pickTime = Infinity;
		for (const t of templates) {
			const t0 = lastUsed.get(t.id) ?? -Infinity;
			if (t0 < pickTime) {
				pickTime = t0;
				pick = t;
			}
		}
		if (pick) {
			nextOrLastTitle = pick.name;
			isNext = true;
		}
	} else if (sessions.length > 0) {
		const last = [...sessions].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
		nextOrLastTitle = last.title ?? '';
		isNext = false;
	}

	return { streakDays: k.streakDays, volumeThisWeekKg: k.volThisWeek, sessionsThisWeek: k.sessionsThisWeek, nextOrLastTitle, isNext };
}

export async function syncWidget(sessions: WorkoutSession[], templates: Template[]): Promise<void> {
	await writeWidgetSnapshot(buildWidgetSnapshot(sessions, templates));
}
