<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getRepository } from '$lib/db';
	import { workout } from '$lib/stores/workout.svelte';
	import { editor } from '$lib/stores/editor.svelte';
	import { equipLabel } from '$lib/format';
	import type { Exercise } from '$lib/types';
	import Icon from '$lib/components/Icon.svelte';
	import Button from '$lib/components/Button.svelte';
	import Thumb from '$lib/components/Thumb.svelte';

	const to = $derived($page.url.searchParams.get('to') ?? 'workout');
	// swap mode only for a real slot index — Number('') is 0, so a bare `?swap=`
	// (or junk) must fall back to add mode, not silently swap exercise 0
	const swapIndex = $derived.by(() => {
		const raw = $page.url.searchParams.get('swap');
		if (raw == null || !/^\d+$/.test(raw)) return null;
		const n = Number(raw);
		return n < workout.exerciseCount ? n : null;
	});
	let all = $state<Exercise[]>([]);
	let q = $state('');
	let filter = $state('All');
	const filters = ['All', 'Barbell', 'Dumbbell', 'Cable', 'Machine', 'Kettlebell', 'Bodyweight', 'Cardio'];

	onMount(async () => {
		all = await getRepository().listExercises();
	});

	const shown = $derived(
		all.filter(
			(e) =>
				(filter === 'All' || equipLabel(e.equipment) === filter) &&
				e.name.toLowerCase().includes(q.trim().toLowerCase())
		)
	);

	function pick(ex: Exercise) {
		if (to === 'tpl') editor.addExercise(ex);
		else if (swapIndex != null) workout.swapExercise(swapIndex, ex);
		else workout.addExercise(ex);
		history.back();
	}
	function ttBadge(e: Exercise): string {
		if (e.trackingType === 'time_hold') return 'time';
		if (e.trackingType === 'cardio') return 'cardio';
		if (e.loadType === 'bodyweight') return 'reps · bw';
		return '';
	}
</script>

<div class="screen">
	<div class="topbar">
		<button class="icon-btn" onclick={() => history.back()} aria-label="Back"><Icon name="back" size={20} /></button>
		<div class="topbar-title">{swapIndex != null ? 'Swap Exercise' : 'Add Exercise'}</div>
		<div style="width:36px"></div>
	</div>
	<div class="screen-body">
		<div class="pad" style="margin-bottom:12px">
			<label class="search" style="margin-bottom:12px">
				<Icon name="search" size={18} color="var(--ink-3)" />
				<input style="border:none;background:transparent;flex:1;font-size:15px;color:var(--ink)" placeholder="Search exercises…" bind:value={q} />
			</label>
			<div role="group" aria-label="Equipment filter" style="display:flex;gap:7px;overflow-x:auto;padding-bottom:4px">
				{#each filters as f (f)}
					<button class="chip {filter === f ? 'solid' : ''}" style="flex:0 0 auto" aria-pressed={filter === f} onclick={() => (filter = f)}>{f}</button>
				{/each}
			</div>
		</div>
		<div class="pad">
			<Button variant="bordered" full style="justify-content:flex-start;gap:11px;margin-bottom:12px" onclick={() => goto(`/exercise/new?to=${to}`)}>
				<span class="thumb sm" style="background:var(--accent-tint);border:none;color:var(--accent-ink)"><Icon name="plus" size={18} sw={2.2} /></span>
				Create custom exercise
			</Button>
			<div class="h-sec" style="margin:8px 0">Catalog</div>
			<div class="card">
				{#each shown as c, i (c.id)}
					{#if i > 0}<div class="divider"></div>{/if}
					<button class="row" style="width:100%;background:transparent;border:none;text-align:left" onclick={() => pick(c)}>
						<Thumb equip={c.equipment} size="sm" />
						<div style="flex:1;min-width:0">
							<div style="font-weight:500;font-size:14.5px">{c.name}</div>
							<div class="txt-sm" style="display:flex;gap:8px;align-items:center;margin-top:2px">
								<span class="mono">{equipLabel(c.equipment)}</span><span>·</span><span>{c.primaryMuscles[0] ?? ''}</span>
								{#if ttBadge(c)}<span class="tt-badge">{ttBadge(c)}</span>{/if}
								{#if c.loadType === 'per_side'}<span class="tt-badge">×2</span>{/if}
							</div>
						</div>
						<span class="icon-btn" style="width:32px;height:32px"><Icon name="plus" size={16} sw={2.2} /></span>
					</button>
				{/each}
			</div>
			<div style="height:16px"></div>
		</div>
	</div>
</div>
