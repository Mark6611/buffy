// Today's recovery state, read from Apple Health (where a Whoop strap or watch
// deposits HRV / resting HR / sleep). One store so the home badge, the workout
// screen and auto-progression all agree on the same number. Native-only and
// opt-in — on web or with the setting off, `current` simply stays null and
// every consumer renders as if the feature doesn't exist.
import { computeReadiness, type Readiness } from '$lib/readiness';
import { isNative, readRecoverySignals, type RecoverySignals } from '$lib/native';
import { settings } from './settings.svelte';

// Health data moves slowly (Whoop syncs sleep/HRV once, mornings) — refetching
// more often than this just burns bridge round-trips for identical answers.
const MIN_REFRESH_INTERVAL_MS = 15 * 60_000;

class RecoveryStore {
	current = $state<Readiness | null>(null);
	/** raw signals behind `current` — workout intensity reuses restingHr */
	signals = $state<RecoverySignals>({});
	private lastFetchMs = 0;
	private inFlight: Promise<void> | null = null;

	/** Refresh from Health if due. Cheap to call from any screen; concurrent
	 *  callers await the same pass, so "await refresh()" genuinely means the
	 *  signals are as fresh as they're going to get. */
	async refresh(force = false) {
		if (!isNative) return;
		if (this.inFlight) return this.inFlight;
		await settings.load();
		if (!settings.current.readRecoveryFromHealth) {
			this.current = null;
			this.signals = {};
			return;
		}
		if (!force && Date.now() - this.lastFetchMs < MIN_REFRESH_INTERVAL_MS) return;
		this.inFlight = (async () => {
			try {
				const signals = await readRecoverySignals();
				this.signals = signals;
				this.current = computeReadiness(signals);
				// Stamp only after a fetch that returned data — an empty answer (Health
				// still indexing, wearable not synced) shouldn't lock in 15 min of null.
				if (Object.keys(signals).length) this.lastFetchMs = Date.now();
			} finally {
				this.inFlight = null;
			}
		})();
		return this.inFlight;
	}
}

export const recovery = new RecoveryStore();
