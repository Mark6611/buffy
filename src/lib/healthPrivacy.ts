// App Review Guideline 5.1.3(ii): "[apps] may not store personal health
// information in iCloud." CloudKit IS iCloud, so these HealthKit-derived /
// Whoop-sourced health fields on a WorkoutSession are:
//   - STRIPPED from every record pushed to CloudKit, and
//   - never applied FROM a pulled record (health never rides sync, either way).
// Each device reconstructs them locally from Apple Health / the Whoop API (see
// sessionIntensity.ts). The loggable workout — exercises, sets, reps, weights,
// notes, timestamps — syncs normally; only the health metrics stay on-device.
import type { WorkoutSession } from '$lib/types';

const HEALTH_FIELDS = ['intensity', 'whoop', 'calories'] as const;

/** A shallow copy of the session with health-derived fields removed — for push. */
export function stripSessionHealth(s: WorkoutSession): WorkoutSession {
	const copy = { ...s } as unknown as Record<string, unknown>;
	for (const f of HEALTH_FIELDS) delete copy[f];
	return copy as unknown as WorkoutSession;
}

/** Apply a pulled session while KEEPING this device's local health data. `local`
 *  is undefined for a session first seen via sync. Remote health (only possible
 *  on legacy records pushed before this rule) is dropped, not adopted. */
export function preserveLocalHealth(
	remote: WorkoutSession,
	local: WorkoutSession | undefined
): WorkoutSession {
	const base = stripSessionHealth(remote);
	if (local?.intensity !== undefined) base.intensity = local.intensity;
	if (local?.whoop !== undefined) base.whoop = local.whoop;
	if (local?.calories !== undefined) base.calories = local.calories;
	return base;
}
