// Today's recovery state. Two sources, one consumer surface:
//  1. Whoop's official API (when connected) — the REAL branded Recovery %,
//     which always wins because it's the number the user already trusts.
//  2. Apple Health signals (HRV/resting HR/sleep via the wearable's writes),
//     scored by $lib/readiness — the fallback when Whoop isn't connected.
// One store so the home badge, the workout screen and auto-progression all
// agree on the same number. Native-only and opt-in — on web or with both
// sources off, `current` stays null and consumers render nothing.
import { computeReadiness, bandFor, type Readiness } from '$lib/readiness';
import { isNative, readRecoverySignals, type RecoverySignals } from '$lib/native';
import { settings } from './settings.svelte';
import { whoop } from './whoop.svelte';

// Health data moves slowly (Whoop syncs sleep/HRV once, mornings) — refetching
// more often than this just burns round-trips for identical answers.
const MIN_REFRESH_INTERVAL_MS = 15 * 60_000;

class RecoveryStore {
	current = $state<Readiness | null>(null);
	source = $state<'whoop' | 'health' | null>(null);
	/** raw signals behind `current` — workout intensity reuses restingHr */
	signals = $state<RecoverySignals>({});
	private lastFetchMs = 0;
	private inFlight: Promise<void> | null = null;

	/** Refresh if due. Cheap to call from any screen; concurrent callers await
	 *  the same pass, so "await refresh()" genuinely means fresh signals. */
	async refresh(force = false) {
		if (!isNative) return;
		if (this.inFlight) return this.inFlight;
		await settings.load();
		if (!settings.current.readRecoveryFromHealth && !whoop.connected) {
			this.current = null;
			this.source = null;
			this.signals = {};
			return;
		}
		if (!force && Date.now() - this.lastFetchMs < MIN_REFRESH_INTERVAL_MS) return;
		this.inFlight = (async () => {
			try {
				// Source 1: Whoop's own Recovery % — authoritative when available.
				if (whoop.connected) {
					const t = await whoop.refreshToday(force);
					if (t && typeof t.recoveryScore === 'number') {
						this.current = { score: t.recoveryScore, band: bandFor(t.recoveryScore), components: {} };
						this.source = 'whoop';
						this.signals = { restingHr: t.restingHr };
						this.lastFetchMs = Date.now();
						return;
					}
					// connected but not yet scored this morning — fall through to Health
				}
				// Source 2: Health-derived readiness.
				if (!settings.current.readRecoveryFromHealth) {
					this.current = null;
					this.source = null;
					this.signals = {};
					return;
				}
				const signals = await readRecoverySignals();
				this.signals = signals;
				this.current = computeReadiness(signals);
				this.source = this.current ? 'health' : null;
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
