<script lang="ts">
	import { onMount } from 'svelte';
	import { ensureSeeded, getRepository } from '$lib/db';
	import { muscleSets, bodyMap, pushPull, type TrendWindow } from '$lib/analytics';
	import { shade } from '$lib/charts';
	import type { WorkoutSession, Exercise } from '$lib/types';
	import TopBar from '$lib/components/TopBar.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import SecHead from '$lib/components/SecHead.svelte';
	import WindowSeg from '$lib/components/WindowSeg.svelte';
	import HBars from '$lib/components/charts/HBars.svelte';
	import LineChart from '$lib/components/charts/LineChart.svelte';
	import BodyMap from '$lib/components/charts/BodyMap.svelte';

	let sessions = $state<WorkoutSession[]>([]);
	let byId = $state<Map<string, Exercise>>(new Map());
	let win = $state<TrendWindow>('12w');
	let view = $state<'bars' | 'map'>('bars');
	let loaded = $state(false);

	onMount(async () => {
		await ensureSeeded();
		const repo = getRepository();
		const [s, ex] = await Promise.all([repo.listSessions(), repo.listExercises()]);
		sessions = s;
		byId = new Map(ex.map((e) => [e.id, e]));
		loaded = true;
	});

	const muscles = $derived(muscleSets(sessions, byId, win));
	const map = $derived(bodyMap(sessions, byId, win));
	const pp = $derived(pushPull(sessions, byId, win));
	const low = $derived(muscles.filter((m) => m.low));
	const ramp = [0, 0.33, 0.66, 1];
</script>

<div class="screen">
	<TopBar title="Muscle balance" />
	<div class="screen-body">
		<div class="pad" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
			<WindowSeg bind:value={win} />
			<div class="seg" role="group" aria-label="Chart view" style="width:132px">
				<button class={view === 'bars' ? 'on' : ''} onclick={() => (view = 'bars')} aria-label="bars" aria-pressed={view === 'bars'}>
					<Icon name="chart" size={14} />
				</button>
				<button class={view === 'map' ? 'on' : ''} onclick={() => (view = 'map')} aria-label="body map" aria-pressed={view === 'map'}>
					<Icon name="body" size={15} />
				</button>
			</div>
		</div>

		{#if loaded && !muscles.length}
			<div class="pad" style="padding-top:30px">
				<div class="card card-pad txt" style="text-align:center">No logged sets in this window yet.</div>
			</div>
		{:else if view === 'bars'}
			<div class="pad">
				<SecHead>Sets per muscle</SecHead>
				<div class="card card-pad" style="margin-bottom:16px"><HBars data={muscles} max={muscles[0]?.v} /></div>
				{#if low.length}
					<div class="card card-pad" style="display:flex;gap:10px;background:var(--warn-tint);border-color:transparent;margin-bottom:16px">
						<Icon name="alert" size={18} color="var(--warn)" />
						<div class="txt-sm" style="color:var(--ink-2)">
							<b style="color:var(--ink)">{low.map((m) => m.l).join(' & ')} trailing.</b> Lowest is {low.at(-1)?.l}
							({low.at(-1)?.v} sets) vs {muscles[0].v} for {muscles[0].l} — consider balancing it out.
						</div>
					</div>
				{/if}
				{#if pp.labels.length > 1}
					<SecHead>Push vs pull · sets / week</SecHead>
					<div class="card card-pad">
						<div style="display:flex;gap:16px;margin-bottom:6px">
							<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-2)"><span style="width:16px;height:3px;border-radius:2px;background:var(--accent)"></span>push</span>
							<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-2)"><span style="width:16px;height:0;border-top:2px dashed var(--ink)"></span>pull</span>
						</div>
						<LineChart
							labels={pp.labels}
							h={150}
							series={[
								{ data: pp.push, color: 'var(--accent)' },
								{ data: pp.pull, color: 'var(--ink)', dash: true }
							]}
						/>
					</div>
				{/if}
			</div>
		{:else}
			<div class="pad">
				<SecHead>Volume map</SecHead>
				<div class="card card-pad">
					<div style="display:flex;gap:8px">
						<div style="flex:1;text-align:center">
							<div class="txt-sm" style="margin-bottom:4px">Front</div>
							<BodyMap vals={map.front} side="front" />
						</div>
						<div style="width:1px;background:var(--line-soft)"></div>
						<div style="flex:1;text-align:center">
							<div class="txt-sm" style="margin-bottom:4px">Back</div>
							<BodyMap vals={map.back} side="back" />
						</div>
					</div>
					<div style="display:flex;align-items:center;justify-content:center;gap:7px;margin-top:12px">
						<span class="txt-sm">low</span>
						{#each ramp as v, i (i)}
							<span style="width:16px;height:12px;border-radius:3px;background:{shade(v)};border:{v === 0 ? '1px solid var(--line)' : 'none'}"></span>
						{/each}
						<span class="txt-sm">high</span>
					</div>
				</div>
				<div class="txt-sm" style="margin-top:10px;text-align:center">Shaded by training volume across the window.</div>
			</div>
		{/if}
	</div>
</div>
