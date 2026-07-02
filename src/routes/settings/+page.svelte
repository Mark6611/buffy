<script lang="ts">
	import { onMount } from 'svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { mmss, parseMmss } from '$lib/format';
	import { isNative, requestHealthAuthorization, requestHealthReadAuthorization, cloudSyncIsAvailable } from '$lib/native';
	import { recovery } from '$lib/stores/recovery.svelte';
	import { whoop } from '$lib/stores/whoop.svelte';
	import { runCloudSync, LAST_CLOUD_SYNC_KEY } from '$lib/cloudSync';
	import { exportJSON } from '$lib/data';
	import { relativeDay } from '$lib/format';
	import TopBar from '$lib/components/TopBar.svelte';
	import Icon from '$lib/components/Icon.svelte';
	let syncing = $state(false);
	let syncMessage = $state('');
	let lastSync = $state<string | null>(null);

	onMount(() => {
		settings.load();
		lastSync = localStorage.getItem(LAST_CLOUD_SYNC_KEY);
	});

	const s = $derived(settings.current);

	function saveRest(v: string) {
		settings.save({ defaultRestSec: parseMmss(v) });
	}
	function saveIncrement(key: 'barbell' | 'dumbbellPerSide' | 'machinePin', v: string) {
		const n = parseFloat(v);
		if (Number.isFinite(n)) settings.save({ increments: { ...s.increments, [key]: n } });
	}

	async function toggleHealth() {
		const next = !s.writeToHealth;
		if (next) {
			const granted = await requestHealthAuthorization();
			if (!granted) return; // permission denied — leave the toggle off
		}
		settings.save({ writeToHealth: next });
	}

	function saveMaxHr(v: string) {
		const n = parseFloat(v);
		// blank (or nonsense) clears the override back to the estimate
		settings.save({ maxHr: Number.isFinite(n) && n > 0 ? n : undefined });
	}

	async function toggleRecovery() {
		const next = !s.readRecoveryFromHealth;
		if (next) {
			// iOS hides read-grant status — a completed sheet is the best signal we get.
			const ok = await requestHealthReadAuthorization();
			if (!ok) return;
		}
		await settings.save({ readRecoveryFromHealth: next });
		void recovery.refresh(true);
	}

	async function toggleCloudSync() {
		const next = !s.cloudSyncEnabled;
		if (next) {
			if (!(await cloudSyncIsAvailable())) {
				syncMessage =
					'iCloud isn’t available right now. Make sure you’re signed into iCloud in iOS Settings — if you are, this build may not have iCloud enabled yet.';
				return;
			}
			await settings.save({ cloudSyncEnabled: true });
			void syncNow(); // first sync right away
		} else {
			settings.save({ cloudSyncEnabled: false });
		}
	}

	async function syncNow() {
		if (syncing) return;
		syncing = true;
		syncMessage = '';
		const result = await runCloudSync();
		syncing = false;
		if (result.ok) {
			lastSync = localStorage.getItem(LAST_CLOUD_SYNC_KEY);
			syncMessage =
				result.pulled || result.pushed ? `Synced — ${result.pulled} pulled, ${result.pushed} pushed.` : 'Already up to date.';
		} else {
			syncMessage = result.reason ?? 'Sync failed.';
		}
	}

	// One export pipeline for the whole app ($lib/data): native-safe (an
	// <a download> click is a silent no-op inside a WebView) and produces the
	// envelope the importer on the Backup screen actually accepts.
	let exporting = $state(false);
	async function exportData() {
		if (exporting) return;
		exporting = true;
		try {
			await exportJSON();
		} finally {
			exporting = false;
		}
	}
</script>

<div class="screen">
	<TopBar title="Settings" />
	<div class="screen-body">
		<div class="pad" style="display:flex;flex-direction:column;gap:18px;padding-bottom:28px">
			<div>
				<div class="h-sec" style="margin-bottom:8px">Units</div>
				<div class="card">
					<div class="row" style="justify-content:space-between">
						<div style="font-weight:500">Weight</div>
						<span class="chip" style="font-size:12px">kg <span class="txt-sm" style="margin-left:4px">fixed</span></span>
					</div>
				</div>
			</div>

			<div>
				<div class="h-sec" style="margin-bottom:8px">Rest</div>
				<div class="card">
					<div class="row" style="justify-content:space-between">
						<div><div style="font-weight:500">Default rest</div><div class="txt-sm">seeds the countdown</div></div>
						<input class="inp" type="text" style="width:64px" value={mmss(s.defaultRestSec)} onchange={(e) => saveRest(e.currentTarget.value)} />
					</div>
				</div>
			</div>

			<div>
				<div class="h-sec" style="margin-bottom:8px">Auto-progression</div>
				<div class="card">
					<div class="row" style="justify-content:space-between">
						<div><div style="font-weight:500">Enabled</div><div class="txt-sm">+1 step on hitting target reps</div></div>
						<button class="toggle {s.autoProgression ? 'on' : ''}" aria-label="toggle" onclick={() => settings.save({ autoProgression: !s.autoProgression })}><i></i></button>
					</div>
					<div class="divider"></div>
					<div class="row" style="justify-content:space-between">
						<div style="font-weight:500">Barbell step</div>
						<input class="inp" type="number" step="0.5" style="width:64px" value={s.increments.barbell} onchange={(e) => saveIncrement('barbell', e.currentTarget.value)} />
					</div>
					<div class="divider"></div>
					<div class="row" style="justify-content:space-between">
						<div style="font-weight:500">Dumbbell step <span class="txt-sm">per side</span></div>
						<input class="inp" type="number" step="0.5" style="width:64px" value={s.increments.dumbbellPerSide} onchange={(e) => saveIncrement('dumbbellPerSide', e.currentTarget.value)} />
					</div>
					<div class="divider"></div>
					<div class="row" style="justify-content:space-between">
						<div style="font-weight:500">Machine pin step</div>
						<input class="inp" type="number" step="1" style="width:64px" value={s.increments.machinePin} onchange={(e) => saveIncrement('machinePin', e.currentTarget.value)} />
					</div>
				</div>
				<div class="txt-sm" style="margin-top:8px;padding-inline:4px">Thresholds & increments are yours to tune — nothing is hard-coded.</div>
			</div>

			<div>
				<div class="h-sec" style="margin-bottom:8px">Alerts</div>
				<div class="card">
					<div class="row" style="justify-content:space-between">
						<div><div style="font-weight:500">Haptic at rest end</div><div class="txt-sm">buzz when the timer hits zero</div></div>
						<button class="toggle {s.hapticAtRestEnd ? 'on' : ''}" aria-label="toggle" onclick={() => settings.save({ hapticAtRestEnd: !s.hapticAtRestEnd })}><i></i></button>
					</div>
				</div>
				<div class="card card-pad" style="margin-top:8px;display:flex;gap:10px;background:var(--warn-tint);border-color:transparent">
					<Icon name="bolt" size={18} color="var(--warn)" />
					<div class="txt-sm" style="color:var(--ink-2)">
						<b style="color:var(--ink)">PWA note:</b> iOS Safari has no Vibration API, so the buzz is native-only. The PWA falls back to the on-screen “Next set” cue — the in-app countdown is the source of truth.
					</div>
				</div>
			</div>

			{#if isNative}
				<div>
					<div class="h-sec" style="margin-bottom:8px">Apple Health</div>
					<div class="card">
						<div class="row" style="justify-content:space-between">
							<div><div style="font-weight:500">Write workouts to Health</div><div class="txt-sm">saves duration to Apple Health on finish</div></div>
							<button class="toggle {s.writeToHealth ? 'on' : ''}" aria-label="toggle" onclick={toggleHealth}><i></i></button>
						</div>
						<div class="divider"></div>
						<div class="row" style="justify-content:space-between">
							<div>
								<div style="font-weight:500">Read recovery from Health</div>
								<div class="txt-sm">readiness &amp; workout intensity from HRV, resting HR, sleep and heart rate (e.g. from Whoop) — on strained days, auto-progression holds the bump</div>
							</div>
							<button class="toggle {s.readRecoveryFromHealth ? 'on' : ''}" aria-label="toggle" onclick={toggleRecovery}><i></i></button>
						</div>
						{#if s.readRecoveryFromHealth}
							<div class="divider"></div>
							<div class="row" style="justify-content:space-between">
								<div style="font-weight:500">Today's readiness</div>
								{#if recovery.current}
									<span style="display:inline-flex;align-items:center;gap:6px">
										<span class="txt-sm">via {recovery.source === 'whoop' ? 'Whoop' : 'Health'}</span>
										<span class="chip {recovery.current.band === 'fresh' ? 'accent' : recovery.current.band === 'strained' ? 'warn' : ''}" style="font-size:12px;text-transform:capitalize">{recovery.current.band} · {recovery.current.score}</span>
									</span>
								{:else}
									<span class="txt-sm">no data yet — check Health → Sharing → Apps → Buffy, or wait for your wearable to sync</span>
								{/if}
							</div>
							<div class="divider"></div>
							<div class="row" style="justify-content:space-between">
								<div><div style="font-weight:500">Max heart rate</div><div class="txt-sm">for intensity zones — blank uses an estimate</div></div>
								<input class="inp" type="number" step="1" style="width:64px" placeholder="190" value={s.maxHr ?? ''} onchange={(e) => saveMaxHr(e.currentTarget.value)} />
							</div>
						{/if}
					</div>
				</div>

				<div>
					<div class="h-sec" style="margin-bottom:8px">Whoop</div>
					<div class="card">
						<div class="row" style="justify-content:space-between">
							<div>
								<div style="font-weight:500">Connect Whoop</div>
								<div class="txt-sm">your real Recovery % and workout Strain, straight from Whoop</div>
							</div>
							{#if whoop.connected}
								<span class="chip accent" style="font-size:12px">Connected</span>
							{:else}
								<button class="btn btn-ghost btn-sm" style="height:36px" onclick={() => whoop.connect()} disabled={whoop.connecting}>
									{whoop.connecting ? 'Connecting…' : 'Connect'}
								</button>
							{/if}
						</div>
						{#if whoop.connected}
							{#if whoop.today && (whoop.today.recoveryScore != null || whoop.today.dayStrain != null)}
								<div class="divider"></div>
								<div class="row" style="justify-content:space-between">
									<div style="font-weight:500">Today</div>
									<span class="txt-sm mono">
										{whoop.today.recoveryScore != null ? `recovery ${whoop.today.recoveryScore}` : 'recovery pending'}{whoop.today.dayStrain != null ? ` · strain ${whoop.today.dayStrain.toFixed(1)}` : ''}
									</span>
								</div>
							{/if}
							<div class="divider"></div>
							<button
								class="row"
								style="justify-content:space-between;width:100%;background:transparent;border:none;text-align:left"
								onclick={async () => {
									await whoop.disconnect();
									void recovery.refresh(true);
								}}
							>
								<div style="font-weight:500;color:var(--warn)">Disconnect</div>
							</button>
						{/if}
					</div>
					{#if whoop.unconfigured}
						<div class="txt-sm" style="margin-top:8px;padding-inline:4px;color:var(--ink-2)">
							Whoop isn't set up on the server yet — create an app at developer.whoop.com and set
							WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET in Vercel (steps in UAT-NATIVE.md).
						</div>
					{:else if whoop.lastError}
						<div class="txt-sm" style="margin-top:8px;padding-inline:4px;color:var(--warn)">{whoop.lastError}</div>
					{/if}
				</div>

				<div>
					<div class="h-sec" style="margin-bottom:8px">iCloud Sync</div>
					<div class="card">
						<div class="row" style="justify-content:space-between">
							<div><div style="font-weight:500">Sync with iCloud</div><div class="txt-sm">your data, mirrored to your other devices</div></div>
							<button class="toggle {s.cloudSyncEnabled ? 'on' : ''}" aria-label="toggle" onclick={toggleCloudSync}><i></i></button>
						</div>
						{#if s.cloudSyncEnabled}
							<div class="divider"></div>
							<div class="row" style="justify-content:space-between">
								<div>
									<div style="font-weight:500">Last synced</div>
									<div class="txt-sm mono">{lastSync ? relativeDay(lastSync) : 'never'}</div>
								</div>
								<button class="btn btn-ghost btn-sm" style="height:36px" onclick={syncNow} disabled={syncing}>
									{syncing ? 'Syncing…' : 'Sync now'}
								</button>
							</div>
						{/if}
					</div>
					{#if syncMessage}
						<div class="txt-sm" style="margin-top:8px;padding-inline:4px;color:var(--ink-2)">{syncMessage}</div>
					{/if}
				</div>
			{/if}

			<div>
				<div class="h-sec" style="margin-bottom:8px">Data</div>
				<div class="card">
					<div class="row" style="justify-content:space-between">
						<div><div style="font-weight:500">Storage</div><div class="txt-sm">local-first · on this device</div></div>
						<span class="chip" style="font-size:11px">IndexedDB</span>
					</div>
					<div class="divider"></div>
					<button class="row" style="justify-content:space-between;width:100%;background:transparent;border:none;text-align:left" onclick={exportData}>
						<div style="font-weight:500">Export data</div>
						<Icon name="share" size={18} color="var(--ink-3)" />
					</button>
				</div>
			</div>
		</div>
	</div>
</div>
