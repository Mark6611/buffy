<script lang="ts">
	import { onMount } from 'svelte';
	import { ensureSeeded, getRepository } from '$lib/db';
	import { progression, progressionPreview, type TrendWindow } from '$lib/analytics';
	import type { WorkoutSession, Exercise } from '$lib/types';
	import type { IconName } from '$lib/icons';
	import TopBar from '$lib/components/TopBar.svelte';
	import Thumb from '$lib/components/Thumb.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import SecHead from '$lib/components/SecHead.svelte';
	import WindowSeg from '$lib/components/WindowSeg.svelte';
	import LineChart from '$lib/components/charts/LineChart.svelte';
	import DotTrend from '$lib/components/charts/DotTrend.svelte';

	let sessions = $state<WorkoutSession[]>([]);
	let exAll = $state<Exercise[]>([]);
	let byId = $state<Map<string, Exercise>>(new Map());
	let win = $state<TrendWindow>('12w');
	let selectedId = $state('');
	let loaded = $state(false);

	onMount(async () => {
		await ensureSeeded();
		const repo = getRepository();
		const [s, ex] = await Promise.all([repo.listSessions(), repo.listExercises()]);
		sessions = s;
		exAll = ex;
		byId = new Map(ex.map((e) => [e.id, e]));
		const ids = new Set<string>();
		for (const ss of s) for (const e of ss.exercises) ids.add(e.exerciseId);
		selectedId = progressionPreview(s, byId, '12w')?.exercise.id ?? [...ids][0] ?? '';
		loaded = true;
	});

	const logged = $derived.by(() => {
		const ids = new Set<string>();
		for (const s of sessions) for (const e of s.exercises) ids.add(e.exerciseId);
		return exAll.filter((e) => ids.has(e.id)).sort((a, b) => a.name.localeCompare(b.name));
	});
	const selected = $derived(byId.get(selectedId));
	const p = $derived(selected ? progression(sessions, selected, win) : null);
	const series = $derived(
		p && selected
			? p.hasWeight
				? [
						{ data: p.topset, color: 'var(--accent)' },
						{ data: p.e1rm, color: 'var(--ink)', dash: true }
					]
				: [{ data: p.topset, color: 'var(--accent)' }]
			: []
	);
	const chartHeader = $derived(
		!selected
			? ''
			: selected.loadType === 'bodyweight'
				? 'Top-set reps'
				: selected.trackingType === 'time_hold'
					? 'Longest hold · sec'
					: selected.trackingType === 'cardio'
						? 'Top time · min'
						: 'Top-set weight & est. 1RM · kg'
	);
</script>

<div class="screen">
	<TopBar title="Progression" />
	<div class="screen-body">
		{#if loaded && selected && p}
			<div class="pad" style="margin-bottom:14px">
				<div class="card" style="display:flex;align-items:center;gap:12px;padding:11px 14px;position:relative">
					<Thumb equip={selected.equipment} size="sm" />
					<div style="flex:1;min-width:0">
						<div class="txt-sm">Exercise</div>
						<div class="ex-name" style="font-size:15px">{selected.name}</div>
					</div>
					<Icon name="chevD" size={18} color="var(--ink-3)" />
					<select
						bind:value={selectedId}
						aria-label="Choose exercise"
						style="position:absolute;inset:0;width:100%;height:100%;opacity:0;font-size:16px"
					>
						{#each logged as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
					</select>
				</div>
			</div>

			<div class="pad" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
				<WindowSeg bind:value={win} />
				<span class="txt-sm mono">{p.sessionCount} {p.sessionCount === 1 ? 'session' : 'sessions'}</span>
			</div>

			{#if p.sessionCount === 0}
				<div class="pad">
					<div class="card card-pad txt" style="text-align:center">No logged sets for {selected.name} in this window.</div>
				</div>
			{:else}
				<div class="pad" style="margin-bottom:22px">
					<SecHead>{chartHeader}</SecHead>
					<div class="card card-pad">
						{#if p.hasWeight}
							<div style="display:flex;gap:16px;margin-bottom:6px">
								<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-2)"><span style="width:16px;height:3px;border-radius:2px;background:var(--accent)"></span>top set</span>
								<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-2)"><span style="width:16px;height:0;border-top:2px dashed var(--ink)"></span>est. 1RM</span>
							</div>
						{/if}
						<LineChart labels={p.labels} {series} />
					</div>
				</div>

				{#if p.hasWeight}
					<div class="pad" style="margin-bottom:22px">
						<SecHead>Reps on top set</SecHead>
						<div class="card card-pad"><DotTrend data={p.reps} /></div>
					</div>
				{/if}

				{#if p.prs.length}
					<div class="pad" style="margin-bottom:16px">
						<SecHead>Personal records</SecHead>
						<div class="card">
							{#each p.prs as pr, i (i)}
								{#if i > 0}<div class="divider"></div>{/if}
								<div class="row">
									<span class="stat-ic"><Icon name={pr.ic as IconName} size={16} color="var(--accent-ink)" /></span>
									<div style="flex:1"><div style="font-size:13.5px;font-weight:500">{pr.l}</div><div class="txt-sm">{pr.when}</div></div>
									<span class="num" style="font-size:16px;font-weight:700">{pr.v}</span>
								</div>
							{/each}
						</div>
						<div class="txt-sm" style="margin-top:10px;display:flex;gap:7px;align-items:flex-start;padding-inline:2px">
							<Icon name="trend" size={14} color="var(--ink-3)" />
							<span>est. 1RM via Epley — <span class="mono">w × (1 + reps/30)</span>. Bodyweight tracks reps; time-holds track longest hold; cardio is log-only.</span>
						</div>
					</div>
				{/if}
			{/if}
		{:else if loaded}
			<div class="pad" style="padding-top:40px">
				<div class="card card-pad txt" style="text-align:center">No exercise history yet — log a workout to see progression.</div>
			</div>
		{/if}
	</div>
</div>
