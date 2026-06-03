<script lang="ts">
	import { onMount } from 'svelte';
	import { getRepository } from '$lib/db';
	import { settings } from '$lib/stores/settings.svelte';
	import { mmss, parseMmss } from '$lib/format';
	import TopBar from '$lib/components/TopBar.svelte';
	import Icon from '$lib/components/Icon.svelte';

	onMount(() => settings.load());

	const s = $derived(settings.current);

	function saveRest(v: string) {
		settings.save({ defaultRestSec: parseMmss(v) });
	}
	function saveIncrement(key: 'barbell' | 'dumbbellPerSide' | 'machinePin', v: string) {
		const n = parseFloat(v);
		if (Number.isFinite(n)) settings.save({ increments: { ...s.increments, [key]: n } });
	}

	async function exportData() {
		const repo = getRepository();
		const [exercises, templates, sessions, settingsData] = await Promise.all([
			repo.listExercises(),
			repo.listTemplates(),
			repo.listSessions(),
			repo.getSettings()
		]);
		const blob = new Blob([JSON.stringify({ exercises, templates, sessions, settings: settingsData }, null, 2)], {
			type: 'application/json'
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `buffy-export-${new Date().toISOString().slice(0, 10)}.json`;
		a.click();
		URL.revokeObjectURL(url);
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
