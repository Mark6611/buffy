// Attach measured/estimated effort data to a finished session, from independent
// sources: heart-rate samples in Apple Health (→ Buffy's %HRR intensity), the
// matched Whoop workout via the official API (→ real Whoop strain + energy),
// and a calorie estimate tiered over whatever of those exists (see $lib/calories).
// Called best-effort right after finishing AND lazily when a session is viewed
// later — wearables sync minutes-to-hours after the workout, so the finish-time
// attempt legitimately finds nothing.
import { estimateCalories } from '$lib/calories';
import { getRepository } from '$lib/db';
import { computeWorkoutIntensity, type HrSample } from '$lib/intensity';
import { isNative, readWorkoutHeartRate, readLatestBodyWeightKg } from '$lib/native';
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
		// fully captured once calories reached the top tier — lower tiers keep the
		// door open for upgrades (met→hr when HR lands, anything→whoop on a match)
		if (session.intensity && session.whoop && session.calories?.method === 'whoop') return null;
		await settings.load();
		const durationSec = (Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 1000;

		// Source 1 — HR samples from Health → %HRR intensity summary. The stream is
		// also a calorie input, so it's fetched whenever calories still need it.
		let samples: HrSample[] = [];
		let intensityPatch: WorkoutSession['intensity'] | null = null;
		const caloriesUpgradable = !session.calories || session.calories.method === 'met';
		if ((!session.intensity || caloriesUpgradable) && settings.current.readRecoveryFromHealth) {
			samples = await readWorkoutHeartRate(Date.parse(session.startedAt), Date.parse(session.endedAt));
			if (samples.length && !session.intensity) {
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
			if (w) {
				whoopPatch = {
					strain: w.strain,
					avgHr: w.avgHr,
					maxHr: w.maxHr,
					kilojoule: w.kilojoule,
					durationSec: Math.max(0, (Date.parse(w.end) - Date.parse(w.start)) / 1000) || undefined
				};
			}
		}

		// Body weight is a native round trip → resolve it BEFORE the write so the
		// re-read-and-patch below is a single atomic transaction with no awaits inside.
		const weightKg =
			(!session.calories || session.calories.method !== 'whoop')
				? settings.current.bodyWeightKg ?? (await readLatestBodyWeightKg()) ?? undefined
				: undefined;
		const age = settings.current.birthYear ? new Date().getFullYear() - settings.current.birthYear : undefined;
		const sex = settings.current.sex;

		// Re-read and patch ONLY the measured fields, atomically. The copy we were
		// handed is seconds old (network round trips); re-reading inside the write's
		// transaction stops a note (or a record applied by a sync pass) landing in
		// that window from being clobbered. patchSessionHealth deliberately does NOT
		// bump updatedAt — health fields don't sync, so a health-only write must not
		// move the last-write-wins clock (else this stale copy could win and erase a
		// real edit on another device).
		const RANK = { whoop: 3, hr: 2, met: 1 } as const;
		const repo = getRepository();
		return await repo.patchSessionHealth(session.id, (fresh) => {
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
			// Source 3 — calories. Tiers are RANKED (whoop > hr > met) and an estimate
			// only ever replaces a strictly lower-ranked one — monotonic, so numbers
			// upgrade as better data lands and never flip-flop between recomputes.
			if (!fresh.calories || fresh.calories.method !== 'whoop') {
				const est = estimateCalories({
					durationSec,
					weightKg,
					age,
					sex,
					whoopKilojoule: updated.whoop?.kilojoule,
					whoopDurationSec: updated.whoop?.durationSec,
					hrSamples: samples,
					intensityScore: updated.intensity?.score ?? fresh.intensity?.score
				});
				if (est && (!fresh.calories || RANK[est.method] > RANK[fresh.calories.method])) {
					updated.calories = est;
					changed = true;
				}
			}
			return changed ? updated : null;
		});
	} catch {
		return null;
	}
}
