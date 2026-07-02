// Attach measured effort data to a finished session, from two independent
// sources: heart-rate samples in Apple Health (→ Buffy's %HRR intensity) and
// the matched Whoop workout via the official API (→ real Whoop strain).
// Called best-effort right after finishing AND lazily when a session is viewed
// later — wearables sync minutes-to-hours after the workout, so the finish-time
// attempt legitimately finds nothing.
import { getRepository } from '$lib/db';
import { computeWorkoutIntensity } from '$lib/intensity';
import { isNative, readWorkoutHeartRate } from '$lib/native';
import { recovery } from '$lib/stores/recovery.svelte';
import { settings } from '$lib/stores/settings.svelte';
import { whoop } from '$lib/stores/whoop.svelte';
import type { WorkoutSession } from '$lib/types';

// finish() fires a capture and immediately navigates to the history page, whose
// mount fires another — single-flight per session so the second call awaits the
// first instead of double-fetching and racing the patch write.
const inFlight = new Map<string, Promise<WorkoutSession | null>>();

/** Returns the updated session when anything new was captured and saved, else
 *  null (nothing enabled, already captured, no data yet, …). Never throws. */
export function captureSessionIntensity(session: WorkoutSession): Promise<WorkoutSession | null> {
	const existing = inFlight.get(session.id);
	if (existing) return existing;
	const run = doCapture(session).finally(() => inFlight.delete(session.id));
	inFlight.set(session.id, run);
	return run;
}

async function doCapture(session: WorkoutSession): Promise<WorkoutSession | null> {
	try {
		if (!isNative || !session.endedAt) return null;
		if (session.intensity && session.whoop) return null;
		await settings.load();

		// Source 1 — HR samples from Health → %HRR intensity summary.
		let intensityPatch: WorkoutSession['intensity'] | null = null;
		if (!session.intensity && settings.current.readRecoveryFromHealth) {
			const samples = await readWorkoutHeartRate(Date.parse(session.startedAt), Date.parse(session.endedAt));
			if (samples.length) {
				await recovery.refresh(); // rate-limited — just makes restingHr likely-present
				const wi = computeWorkoutIntensity({
					samples,
					restingHr: recovery.signals.restingHr,
					maxHr: settings.current.maxHr
				});
				if (wi) intensityPatch = { score: wi.score, band: wi.band, avgHr: wi.avgHr, peakHr: wi.peakHr, zones: wi.zones };
			}
		}

		// Source 2 — the Whoop workout covering this session's window.
		let whoopPatch: WorkoutSession['whoop'] | null = null;
		if (!session.whoop && whoop.connected) {
			const w = await whoop.workoutFor(session.startedAt, session.endedAt);
			if (w) whoopPatch = { strain: w.strain, avgHr: w.avgHr, maxHr: w.maxHr };
		}

		if (!intensityPatch && !whoopPatch) return null;

		// Re-read and patch ONLY the measured fields: the copy we were handed is
		// seconds old by now (network round trips), and writing it back whole
		// would clobber anything saved meanwhile — e.g. a note typed while the
		// history page's backfill was in flight.
		const repo = getRepository();
		const fresh = await repo.getSession(session.id);
		if (!fresh) return null;
		const updated: WorkoutSession = { ...fresh };
		let changed = false;
		if (intensityPatch && !fresh.intensity) {
			updated.intensity = intensityPatch;
			changed = true;
		}
		if (whoopPatch && !fresh.whoop) {
			updated.whoop = whoopPatch;
			changed = true;
		}
		if (!changed) return null;
		await repo.upsertSession(updated);
		return updated;
	} catch {
		return null;
	}
}
