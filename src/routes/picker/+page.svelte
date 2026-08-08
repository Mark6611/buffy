<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getRepository } from '$lib/db';
	import { workout } from '$lib/stores/workout.svelte';
	import { editor } from '$lib/stores/editor.svelte';
	import { equipLabel } from '$lib/format';
	import { matchesExercise } from '$lib/exerciseSearch';
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
	// distinguishes "still reading the catalog" from "nothing matched" — before this
	// flag both states painted the same empty card, so a slow first paint looked
	// exactly like a search with no results.
	let loaded = $state(false);
	let q = $state('');
	let filter = $state('All');
	const filters = ['All', 'Barbell', 'Dumbbell', 'Cable', 'Machine', 'Kettlebell', 'Bodyweight', 'Cardio'];

	onMount(async () => {
		all = await getRepository().listExercises();
		loaded = true;
	});

	const shown = $derived(
		all
			.filter((e) => (filter === 'All' || equipLabel(e.equipment) === filter) && matchesExercise(e, q))
			// listExercises() returns IndexedDB key order, which is UTF-16 code-unit order:
			// every capitalised name sorts above every lowercase one, so a custom "front
			// squat" would sink below the entire seeded catalog. Sort at read time instead
			// of in the repository — the other consumers of that list build Maps from it
			// and don't care about order.
			.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
	);

	/** Hand the typed query and the swap slot to the custom-exercise form: retyping a
	 *  name you just typed is friction, and a swap that detours through "create" is
	 *  still a swap — dropping the index there silently turned it into an append. */
	function createCustom() {
		const params = new URLSearchParams({ to });
		if (swapIndex != null) params.set('swap', String(swapIndex));
		if (q.trim()) params.set('name', q.trim());
		goto(`/exercise/new?${params}`);
	}

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
				<!-- placeholder kept short: a single-line input cannot wrap it, so at large
				     text sizes a long one truncates. The full name lives in the aria-label. -->
				<!-- a real search field: autocorrect/autocapitalise off so iOS stops rewriting
				     gym shorthand mid-lookup, and -webkit-appearance:none so no platform
				     draws a second cancel button next to ours. -->
				<input
					type="search"
					inputmode="search"
					enterkeyhint="search"
					autocorrect="off"
					autocapitalize="none"
					spellcheck="false"
					style="border:none;background:transparent;flex:1;min-width:0;font-size:calc(var(--dt-base)*15/17);color:var(--ink);-webkit-appearance:none;appearance:none"
					placeholder="Search"
					aria-label="Search exercises"
					bind:value={q}
				/>
				<!-- iOS WKWebView never renders the native search-cancel button, so clearing
				     a query one-handed mid-set needs an affordance of our own. Kept at
				     .icon-btn's own 36px so its ::after hit box still reaches 44; the negative
				     block margins let it overflow into the field's padding instead of making
				     the whole search row 18px taller. -->
				{#if q}
					<button
						class="icon-btn ghost"
						style="margin:-9px -4px -9px 0"
						aria-label="Clear search"
						onclick={() => (q = '')}
					>
						<Icon name="plus" size={15} sw={2.4} color="var(--ink-3)" style="transform:rotate(45deg)" />
					</button>
				{/if}
			</label>
			<!-- overflow-x:auto clips on BOTH axes, which would shear off the chips' vertical
			     hit expansion. The padding gives it room and the matching negative margins
			     cancel it, so the row occupies exactly the same space as before. -->
			<div role="group" aria-label="Equipment filter" style="display:flex;gap:7px;overflow-x:auto;padding:9px 0 13px;margin:-9px 0 -9px">
				{#each filters as f (f)}
					<button class="chip {filter === f ? 'solid' : ''}" style="flex:0 0 auto" aria-pressed={filter === f} onclick={() => (filter = f)}>{f}</button>
				{/each}
			</div>
		</div>
		<div class="pad">
			<Button variant="bordered" full style="justify-content:flex-start;gap:11px;margin-bottom:12px" onclick={createCustom}>
				<span class="thumb sm" style="background:var(--accent-tint);border:none;color:var(--accent-ink)"><Icon name="plus" size={18} sw={2.2} /></span>
				Create custom exercise
			</Button>
			<div class="h-sec" style="margin:8px 0">Catalog</div>
			{#if shown.length === 0}
				<!-- an empty .card has no min-height or padding, so it painted a ~2px sliver
				     with no explanation. Say which of the three empty cases this is. -->
				<div class="card card-pad txt" style="text-align:center">
					{#if !loaded}
						Loading exercises…
					{:else if q.trim()}
						Nothing matches “{q.trim()}”. Try a shorter word, or create it with the button above.
					{:else if filter !== 'All'}
						No {filter.toLowerCase()} exercises in your catalog yet.
					{:else}
						Your exercise catalog is empty.
					{/if}
				</div>
			{:else}
				<div class="card">
					{#each shown as c, i (c.id)}
						{#if i > 0}<div class="divider"></div>{/if}
						<button class="row" style="width:100%;background:transparent;border:none;text-align:left" onclick={() => pick(c)}>
							<Thumb equip={c.equipment} size="sm" />
							<div style="flex:1;min-width:0">
								<div style="font-weight:500;font-size:calc(var(--dt-base)*14.5/17)">{c.name}</div>
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
			{/if}
			<div style="height:16px"></div>
		</div>
	</div>
</div>
