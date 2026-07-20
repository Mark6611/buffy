<script lang="ts">
	import { onMount } from 'svelte';
	import { getRepository } from '$lib/db';
	import { readLatestBodyWeightKg } from '$lib/native';
	import { newId } from '$lib/id';
	import { kg } from '$lib/format';
	import type { BodyWeightEntry } from '$lib/types';
	import LineChart from '$lib/components/charts/LineChart.svelte';
	import Button from '$lib/components/Button.svelte';

	// Body weight is HEALTH DATA: this series is stored LOCAL-ONLY (never iCloud, per
	// 5.1.3(ii)) via the repository. It can prefill from the latest Apple Health sample.
	let entries = $state<BodyWeightEntry[]>([]);
	let input = $state('');
	let adding = $state(false);
	let loaded = $state(false);

	onMount(load);
	async function load() {
		entries = await getRepository().listBodyWeights();
		loaded = true;
		if (!input) {
			const last = entries.at(-1)?.kg ?? (await readLatestBodyWeightKg()) ?? undefined;
			if (last != null) input = kg(last);
		}
	}

	function monthDay(iso: string): string {
		const d = new Date(iso);
		return `${d.getMonth() + 1}/${d.getDate()}`;
	}

	const latest = $derived(entries.at(-1) ?? null);
	const delta = $derived(entries.length >= 2 ? entries[entries.length - 1].kg - entries[0].kg : null);
	const series = $derived([{ data: entries.map((e) => e.kg), color: 'var(--accent)' }]);
	const labels = $derived(entries.map((e) => monthDay(e.at)));

	async function log() {
		const v = parseFloat(input);
		if (!Number.isFinite(v) || v <= 0 || adding) return;
		adding = true;
		try {
			await getRepository().addBodyWeight({
				id: newId(),
				at: new Date().toISOString(),
				kg: Math.round(v * 10) / 10
			});
			await load();
		} finally {
			adding = false;
		}
	}
</script>

<div class="card card-pad">
	<div class="row" style="justify-content:space-between;align-items:flex-start">
		<div>
			<div class="h-sec">Body weight</div>
			{#if latest}
				<div style="font-size:24px;font-weight:700;margin-top:2px">
					{kg(latest.kg)} <span class="txt-sm" style="font-weight:500">kg</span>
				</div>
				{#if delta != null}
					<div class="txt-sm" style="color:{delta <= 0 ? 'var(--accent)' : 'var(--ink-3)'}">
						{delta >= 0 ? '+' : ''}{kg(delta)} kg since {monthDay(entries[0].at)}
					</div>
				{/if}
			{:else if loaded}
				<div class="txt-sm" style="margin-top:2px">Log your weight to start the trend.</div>
			{/if}
		</div>
	</div>

	{#if entries.length >= 2}
		<div style="margin-top:10px"><LineChart {series} {labels} h={140} /></div>
	{/if}

	<div style="display:flex;gap:8px;margin-top:12px">
		<input
			class="inp"
			type="number"
			step="0.1"
			inputmode="decimal"
			placeholder="kg"
			bind:value={input}
			style="flex:1;height:40px;text-align:left;padding-inline:12px"
		/>
		<Button size="medium"   onclick={log} disabled={adding}>Log</Button>
	</div>
</div>
