// Attach a measured heart-rate intensity summary to a finished session, from
// the HR samples a wearable (Whoop, watch) wrote into Apple Health during the
// workout window. Called best-effort right after finishing AND lazily when a
// session is viewed later — wearables often sync to Health minutes-to-hours
// after the workout, so the finish-time attempt legitimately finds nothing.
import { getRepository } from '$lib/db';
import { computeWorkoutIntensity } from '$lib/intensity';
import { isNative, readWorkoutHeartRate } from '$lib/native';
import { recovery } from '$lib/stores/recovery.svelte';
import { settings } from '$lib/stores/settings.svelte';
import type { WorkoutSession } from '$lib/types';

/** Returns the updated session when intensity was captured and saved, else null
 *  (feature off, already captured, no samples yet, …). Never throws. */
export async function captureSessionIntensity(session: WorkoutSession): Promise<WorkoutSession | null> {
	try {
		if (!isNative || !session.endedAt || session.intensity) return null;
		await settings.load();
		if (!settings.current.readRecoveryFromHealth) return null;
		const samples = await readWorkoutHeartRate(Date.parse(session.startedAt), Date.parse(session.endedAt));
		if (!samples.length) return null;
		await recovery.refresh(); // rate-limited — just makes restingHr likely-present
		await settings.load();
		const wi = computeWorkoutIntensity({
			samples,
			restingHr: recovery.signals.restingHr,
			maxHr: settings.current.maxHr
		});
		if (!wi) return null;
		// Re-read and patch ONLY the measured field: the copy we were handed is
		// seconds old by now (HealthKit round trip), and writing it back whole
		// would clobber anything saved meanwhile — e.g. a note typed while the
		// history page's backfill was in flight.
		const repo = getRepository();
		const fresh = await repo.getSession(session.id);
		if (!fresh || fresh.intensity) return null;
		const updated: WorkoutSession = {
			...fresh,
			intensity: { score: wi.score, band: wi.band, avgHr: wi.avgHr, peakHr: wi.peakHr, zones: wi.zones }
		};
		await repo.upsertSession(updated);
		return updated;
	} catch {
		return null;
	}
}
