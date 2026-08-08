<script lang="ts">
	import { onMount } from 'svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { mmss, parseMmss } from '$lib/format';
	import { isNative, requestHealthAuthorization, requestHealthReadAuthorization, cloudSyncIsAvailable } from '$lib/native';
	import { recovery } from '$lib/stores/recovery.svelte';
	import { whoop } from '$lib/stores/whoop.svelte';
	import { runCloudSync, LAST_CLOUD_SYNC_KEY } from '$lib/cloudSync';
	import { exportJSON } from '$lib/data';
	import { getRepository } from '$lib/db';
	import { isDemoSessionId } from '$lib/db/seed';
	import { relativeDay } from '$lib/format';
	import TopBar from '$lib/components/TopBar.svelte';
	import Button from '$lib/components/Button.svelte';
	import Icon from '$lib/components/Icon.svelte';
	let syncing = $state(false);
	let syncMessage = $state('');
	let lastSync = $state<string | null>(null);

	onMount(() => {
		settings.load();
		lastSync = localStorage.getItem(LAST_CLOUD_SYNC_KEY);
		void countSampleSessions();
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

	function saveBirthYear(v: string) {
		const n = parseInt(v, 10);
		const y = new Date().getFullYear();
		settings.save({ birthYear: Number.isFinite(n) && n > 1900 && n <= y ? n : undefined });
	}
	function saveBodyWeight(v: string) {
		const n = parseFloat(v);
		settings.save({ bodyWeightKg: Number.isFinite(n) && n > 0 ? n : undefined });
	}
	function setSex(sex: 'male' | 'female') {
		// tapping the active chip clears it — profile stays fully optional
		settings.save({ sex: s.sex === sex ? undefined : sex });
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

	// script-level guard — see home's whoopToday note (compiler paren-drop bug)
	const whoopTodayRow = $derived.by(() => {
		const t = whoop.today;
		if (!t) return null;
		const hasAny = typeof t.recoveryScore === 'number' || typeof t.dayStrain === 'number';
		return hasAny ? t : null;
	});

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

	// --- Sample data ---------------------------------------------------------
	// Early installs were seeded with 36 fabricated workouts (the seed no longer
	// writes them). They're welded into History and skew every stat, so offer a
	// one-tap purge — but ONLY for sessions whose id came from that generator, so a
	// real workout can never be caught by it. deleteSession tombstones, which means
	// the removal also propagates to the user's other devices and survives a
	// reinstall instead of being resurrected by the next iCloud pull.
	let sampleCount = $state(0);
	let confirmSample = $state(false);
	let purging = $state(false);
	let dataMessage = $state('');
	let sampleError = $state('');

	async function countSampleSessions() {
		try {
			sampleCount = (await getRepository().listSessions()).filter((s) => isDemoSessionId(s.id)).length;
		} catch {
			sampleCount = 0; // storage unavailable — just don't offer the action
		}
	}

	async function removeSampleData() {
		if (purging) return;
		purging = true;
		sampleError = '';
		try {
			const repo = getRepository();
			const ids = (await repo.listSessions()).filter((s) => isDemoSessionId(s.id)).map((s) => s.id);
			for (const id of ids) await repo.deleteSession(id);
			dataMessage = `Removed ${ids.length} sample ${ids.length === 1 ? 'workout' : 'workouts'}.`;
			await countSampleSessions();
			confirmSample = false;
		} catch (e) {
			// keep the sheet up so the failure is visible where the tap happened
			sampleError = e instanceof Error ? e.message : 'Could not remove the sample data.';
		} finally {
			purging = false;
		}
	}

	// move focus into the confirm sheet so assistive tech lands on the dialog
	function autofocusNode(n: HTMLElement) {
		n.focus();
	}
</script>

<div class="screen">
	<TopBar title="Settings" />
	<div class="screen-body">
		<div class="pad" style="display:flex;flex-direction:column;gap:18px;padding-bottom:28px">
			<div>
				<h2 class="h-sec" style="margin-bottom:8px">Units</h2>
				<div class="card">
					<div class="row" style="justify-content:space-between">
						<div style="font-weight:500">Weight</div>
						<span class="chip" style="font-size:calc(var(--dt-base)*12/17)">kg <span class="txt-sm" style="margin-left:4px">fixed</span></span>
					</div>
				</div>
			</div>

			<div>
				<h2 class="h-sec" style="margin-bottom:8px">Rest</h2>
				<div class="card">
					<div class="row" style="justify-content:space-between">
						<div><div style="font-weight:500">Default rest</div><div class="txt-sm">seeds the countdown</div></div>
						<input class="inp" type="text" style="width:64px" aria-label="Default rest, minutes and seconds" value={mmss(s.defaultRestSec)} onchange={(e) => saveRest(e.currentTarget.value)} />
					</div>
				</div>
			</div>

			<div>
				<h2 class="h-sec" style="margin-bottom:8px">Auto-progression</h2>
				<div class="card">
					<div class="row" style="justify-content:space-between">
						<div><div style="font-weight:500">Enabled</div><div class="txt-sm">+1 step on hitting target reps</div></div>
						<button class="toggle {s.autoProgression ? 'on' : ''}" role="switch" aria-checked={s.autoProgression} aria-label="Enabled" onclick={() => settings.save({ autoProgression: !s.autoProgression })}><i></i></button>
					</div>
					<div class="divider"></div>
					<div class="row" style="justify-content:space-between">
						<div><div style="font-weight:500">Track RPE</div><div class="txt-sm">optional 6–10 effort column on sets</div></div>
						<button class="toggle {s.trackRpe ? 'on' : ''}" role="switch" aria-checked={s.trackRpe} aria-label="Track RPE" onclick={() => settings.save({ trackRpe: !s.trackRpe })}><i></i></button>
					</div>
					<div class="divider"></div>
					<div class="row" style="justify-content:space-between">
						<div style="font-weight:500">Barbell step</div>
						<input class="inp" type="number" step="0.5" style="width:64px" aria-label="Barbell step in kilograms" value={s.increments.barbell} onchange={(e) => saveIncrement('barbell', e.currentTarget.value)} />
					</div>
					<div class="divider"></div>
					<div class="row" style="justify-content:space-between">
						<div style="font-weight:500">Dumbbell step <span class="txt-sm">per side</span></div>
						<input class="inp" type="number" step="0.5" style="width:64px" aria-label="Dumbbell step per side in kilograms" value={s.increments.dumbbellPerSide} onchange={(e) => saveIncrement('dumbbellPerSide', e.currentTarget.value)} />
					</div>
					<div class="divider"></div>
					<div class="row" style="justify-content:space-between">
						<div style="font-weight:500">Machine pin step</div>
						<input class="inp" type="number" step="1" style="width:64px" aria-label="Machine pin step in kilograms" value={s.increments.machinePin} onchange={(e) => saveIncrement('machinePin', e.currentTarget.value)} />
					</div>
				</div>
				<div class="txt-sm" style="margin-top:8px;padding-inline:4px">Thresholds & increments are yours to tune — nothing is hard-coded.</div>
			</div>

			<div>
				<h2 class="h-sec" style="margin-bottom:8px">Alerts</h2>
				<div class="card">
					<div class="row" style="justify-content:space-between">
						<div><div style="font-weight:500">Haptic at rest end</div><div class="txt-sm">buzz when the timer hits zero</div></div>
						<button class="toggle {s.hapticAtRestEnd ? 'on' : ''}" role="switch" aria-checked={s.hapticAtRestEnd} aria-label="Haptic at rest end" onclick={() => settings.save({ hapticAtRestEnd: !s.hapticAtRestEnd })}><i></i></button>
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
					<h2 class="h-sec" style="margin-bottom:8px">Profile</h2>
					<div class="card">
						<div class="row" style="justify-content:space-between">
							<div><div style="font-weight:500">Sex</div><div class="txt-sm">for the heart-rate calorie formula</div></div>
							<span role="group" aria-label="Sex" style="display:inline-flex;gap:6px">
								<button class="chip {s.sex === 'male' ? 'accent' : ''}" style="padding:5px 10px" aria-pressed={s.sex === 'male'} onclick={() => setSex('male')}>male</button>
								<button class="chip {s.sex === 'female' ? 'accent' : ''}" style="padding:5px 10px" aria-pressed={s.sex === 'female'} onclick={() => setSex('female')}>female</button>
							</span>
						</div>
						<div class="divider"></div>
						<div class="row" style="justify-content:space-between">
							<div style="font-weight:500">Birth year</div>
							<input
								class="inp"
								type="number"
								style="width:74px"
								aria-label="Birth year"
								placeholder="1995"
								value={s.birthYear ?? ''}
								onchange={(e) => {
									saveBirthYear(e.currentTarget.value);
									e.currentTarget.value = String(s.birthYear ?? '');
								}}
							/>
						</div>
						<div class="divider"></div>
						<div class="row" style="justify-content:space-between">
							<div><div style="font-weight:500">Body weight <span class="txt-sm">kg</span></div><div class="txt-sm">blank uses your latest Health entry</div></div>
							<input class="inp" type="number" step="0.5" style="width:74px" aria-label="Body weight in kilograms" placeholder="auto" value={s.bodyWeightKg ?? ''} onchange={(e) => saveBodyWeight(e.currentTarget.value)} />
						</div>
					</div>
					<div class="txt-sm" style="margin-top:8px;padding-inline:4px">Used only to estimate workout calories — stays on this device.</div>
				</div>

				<div>
					<h2 class="h-sec" style="margin-bottom:8px">Apple Health</h2>
					<div class="card">
						<div class="row" style="justify-content:space-between">
							<div><div style="font-weight:500">Write workouts to Health</div><div class="txt-sm">saves duration to Apple Health on finish</div></div>
							<button class="toggle {s.writeToHealth ? 'on' : ''}" role="switch" aria-checked={s.writeToHealth} aria-label="Write workouts to Health" onclick={toggleHealth}><i></i></button>
						</div>
						<div class="divider"></div>
						<div class="row" style="justify-content:space-between">
							<div>
								<div style="font-weight:500">Read recovery from Health</div>
								<div class="txt-sm">readiness &amp; workout intensity from HRV, resting HR, sleep and heart rate (e.g. from Whoop) — on strained days, auto-progression holds the bump</div>
							</div>
							<button class="toggle {s.readRecoveryFromHealth ? 'on' : ''}" role="switch" aria-checked={s.readRecoveryFromHealth} aria-label="Read recovery from Health" onclick={toggleRecovery}><i></i></button>
						</div>
						{#if s.readRecoveryFromHealth}
							<div class="divider"></div>
							<div class="row" style="justify-content:space-between">
								<div style="font-weight:500">Today's readiness</div>
								{#if recovery.current}
									<span style="display:inline-flex;align-items:center;gap:6px">
										<span class="txt-sm">via {recovery.source === 'whoop' ? 'Whoop' : 'Health'}</span>
										<span class="chip {recovery.current.band === 'fresh' ? 'accent' : recovery.current.band === 'strained' ? 'warn' : ''}" style="font-size:calc(var(--dt-base)*12/17);text-transform:capitalize">{recovery.current.band} · {recovery.current.score}</span>
									</span>
								{:else}
									<span class="txt-sm">no data yet — check Health → Sharing → Apps → Buffy, or wait for your wearable to sync</span>
								{/if}
							</div>
							<div class="divider"></div>
							<div class="row" style="justify-content:space-between">
								<div><div style="font-weight:500">Max heart rate</div><div class="txt-sm">for intensity zones — blank uses an estimate</div></div>
								<input class="inp" type="number" step="1" style="width:64px" aria-label="Max heart rate" placeholder="190" value={s.maxHr ?? ''} onchange={(e) => saveMaxHr(e.currentTarget.value)} />
							</div>
						{/if}
					</div>
				</div>

				<div>
					<h2 class="h-sec" style="margin-bottom:8px">Whoop</h2>
					<div class="card">
						<div class="row" style="justify-content:space-between">
							<div>
								<div style="font-weight:500">Connect Whoop</div>
								<div class="txt-sm">your real Recovery % and workout Strain, straight from Whoop</div>
							</div>
							{#if whoop.connected}
								<span class="chip accent" style="font-size:calc(var(--dt-base)*12/17)">Connected</span>
							{:else}
								<Button size="regular" variant="bordered" onclick={() => whoop.connect()} disabled={whoop.connecting}>
									{whoop.connecting ? 'Connecting…' : 'Connect'}
								</Button>
							{/if}
						</div>
						{#if whoop.connected}
							{#if whoopTodayRow}
								<div class="divider"></div>
								<div class="row" style="justify-content:space-between">
									<div style="font-weight:500">Today</div>
									<span class="txt-sm mono">
										{whoopTodayRow.recoveryScore != null ? `recovery ${whoopTodayRow.recoveryScore}` : 'recovery pending'}{whoopTodayRow.dayStrain != null ? ` · strain ${whoopTodayRow.dayStrain.toFixed(1)}` : ''}{whoopTodayRow.sleepPerformancePct != null ? ` · sleep ${whoopTodayRow.sleepPerformancePct}%` : ''}
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
					<h2 class="h-sec" style="margin-bottom:8px">iCloud Sync</h2>
					<div class="card">
						<div class="row" style="justify-content:space-between">
							<div><div style="font-weight:500">Sync with iCloud</div><div class="txt-sm">your data, mirrored to your other devices</div></div>
							<button class="toggle {s.cloudSyncEnabled ? 'on' : ''}" role="switch" aria-checked={s.cloudSyncEnabled} aria-label="Sync with iCloud" onclick={toggleCloudSync}><i></i></button>
						</div>
						{#if s.cloudSyncEnabled}
							<div class="divider"></div>
							<div class="row" style="justify-content:space-between">
								<div>
									<div style="font-weight:500">Last synced</div>
									<div class="txt-sm mono">{lastSync ? relativeDay(lastSync) : 'never'}</div>
								</div>
								<Button size="regular" variant="bordered" onclick={syncNow} disabled={syncing}>
									{syncing ? 'Syncing…' : 'Sync now'}
								</Button>
							</div>
						{/if}
					</div>
					{#if syncMessage}
						<div class="txt-sm" style="margin-top:8px;padding-inline:4px;color:var(--ink-2)">{syncMessage}</div>
					{/if}
				</div>
			{/if}

			<div>
				<h2 class="h-sec" style="margin-bottom:8px">Data</h2>
				<div class="card">
					<div class="row" style="justify-content:space-between">
						<div><div style="font-weight:500">Storage</div><div class="txt-sm">local-first · on this device</div></div>
						<span class="chip" style="font-size:calc(var(--dt-base)*11/17)">IndexedDB</span>
					</div>
					<div class="divider"></div>
					<button class="row" style="justify-content:space-between;width:100%;background:transparent;border:none;text-align:left" onclick={exportData}>
						<div style="font-weight:500">Export data</div>
						<Icon name="share" size={18} color="var(--ink-3)" />
					</button>
					{#if sampleCount > 0}
						<div class="divider"></div>
						<button
							class="row"
							style="justify-content:space-between;width:100%;background:transparent;border:none;text-align:left"
							onclick={() => (confirmSample = true)}
						>
							<div>
								<div style="font-weight:500;color:var(--warn)">Remove sample data</div>
								<div class="txt-sm">{sampleCount} demo {sampleCount === 1 ? 'workout' : 'workouts'} from the first launch</div>
							</div>
							<Icon name="trash" size={18} color="var(--warn)" />
						</button>
					{/if}
					<div class="divider"></div>
					<a class="row" href="/privacy" style="justify-content:space-between;width:100%;text-decoration:none;color:inherit">
						<div style="font-weight:500">Privacy Policy</div>
						<Icon name="chevR" size={16} color="var(--ink-3)" />
					</a>
				</div>
				{#if dataMessage}
					<div class="txt-sm" style="margin-top:8px;padding-inline:4px;color:var(--ink-2)">{dataMessage}</div>
				{/if}
			</div>
		</div>
	</div>

	{#if confirmSample}
		<button class="sheet-backdrop" aria-label="Cancel" onclick={() => (confirmSample = false)}></button>
		<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sample-title" tabindex="-1" use:autofocusNode>
			<div class="sheet-grip" aria-hidden="true"></div>
			<span class="stat-ic" style="width:46px;height:46px;background:var(--warn-tint);margin-bottom:14px"><Icon name="trash" size={22} color="var(--warn)" /></span>
			<div class="h-card" id="sample-title" style="font-size:calc(var(--dt-base)*19/17);margin-bottom:6px">Remove sample data?</div>
			<div class="txt" style="margin-bottom:16px">
				Deletes the <b style="color:var(--ink)">{sampleCount} demo {sampleCount === 1 ? 'workout' : 'workouts'}</b>
				Buffy generated on its first launch. Your own workouts, templates and exercises are untouched — only sessions
				created by that generator are matched.
			</div>
			<div style="display:flex;gap:10px">
				<Button variant="bordered" style="flex:1" onclick={() => (confirmSample = false)} disabled={purging}>Cancel</Button>
				<Button style="flex:1.3;background:var(--warn);color:#fff" onclick={removeSampleData} disabled={purging}>
					{purging ? 'Removing…' : 'Remove'}
				</Button>
			</div>
			{#if sampleError}
				<div class="txt-sm" style="margin-top:10px;padding-inline:4px;color:var(--warn)">{sampleError}</div>
			{/if}
		</div>
	{/if}
</div>
