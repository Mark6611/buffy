<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ensureSeeded, getRepository } from '$lib/db';
	import { templateDerived } from '$lib/compute';
	import { durationLabel } from '$lib/format';
	import type { Template, Exercise } from '$lib/types';
	import Icon from '$lib/components/Icon.svelte';
	import Thumb from '$lib/components/Thumb.svelte';
	import EqChip from '$lib/components/EqChip.svelte';

	let templates = $state<Template[]>([]);
	let byId = $state<Map<string, Exercise>>(new Map());
	let loaded = $state(false);

	onMount(async () => {
		await ensureSeeded();
		const repo = getRepository();
		const [t, ex] = await Promise.all([repo.listTemplates(), repo.listExercises()]);
		templates = t;
		byId = new Map(ex.map((e) => [e.id, e]));
		loaded = true;
	});

	const dateLabel = new Date().toLocaleDateString('en-US', {
		weekday: 'long',
		day: 'numeric',
		month: 'short'
	});
</script>

<div class="screen">
	<div class="screen-body">
		<div style="display:flex;align-items:flex-end;justify-content:space-between;padding:8px 20px 14px">
			<div>
				<div class="txt-sm" style="margin-bottom:2px">{dateLabel}</div>
				<div class="h-app" style="font-size:28px">Workouts</div>
			</div>
			<div style="display:flex;gap:8px">
				<button class="icon-btn" onclick={() => goto('/history')} aria-label="History">
					<Icon name="cal" size={18} />
				</button>
				<button class="icon-btn" onclick={() => goto('/settings')} aria-label="Settings">
					<Icon name="cog" size={18} />
				</button>
			</div>
		</div>

		<div class="pad" style="margin-bottom:18px">
			<button
				class="btn btn-dark btn-block"
				style="justify-content:space-between"
				onclick={() => goto('/quick')}
			>
				<span style="display:flex;align-items:center;gap:9px">
					<Icon name="bolt" size={18} color="#fff" />Quick log a workout
				</span>
				<Icon name="arrowR" size={18} color="#fff" />
			</button>
		</div>

		<div
			class="pad"
			style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"
		>
			<span class="h-sec">My Templates</span>
			<button class="chip" style="padding:5px 10px" onclick={() => goto('/template/new/edit')}>
				<Icon name="plus" size={13} sw={2.2} />New
			</button>
		</div>

		<div class="pad" style="display:flex;flex-direction:column;gap:12px;padding-bottom:28px">
			{#each templates as t (t.id)}
				{@const d = templateDerived(t, byId)}
				<button
					class="card card-pad"
					style="display:flex;gap:13px;align-items:flex-start;text-align:left;width:100%"
					onclick={() => goto(`/template/${t.id}`)}
				>
					<Thumb equip={d.equipment[0] ?? 'dumbbell'} size="lg" />
					<div style="flex:1;min-width:0">
						<div style="display:flex;align-items:center;gap:8px">
							<div class="h-card" style="flex:1">{t.name}</div>
							{#if t.groups.length}
								<span class="chip accent" style="padding:3px 8px;font-size:11px">Superset</span>
							{/if}
						</div>
						<div class="ex-meta" style="margin-top:4px;display:flex;gap:12px">
							<span><span class="num">{t.exercises.length}</span> exercises</span>
							<span><span class="num">{d.setCount}</span> sets</span>
							<span style="display:inline-flex;align-items:center;gap:4px">
								<Icon name="clock" size={13} color="var(--ink-3)" />{durationLabel(d.estDurationSec)}
							</span>
						</div>
						<div style="display:flex;gap:6px;margin-top:11px;flex-wrap:wrap">
							{#each d.muscles.slice(0, 2) as m (m)}
								<span class="chip" style="padding:4px 9px;font-size:11.5px">{m}</span>
							{/each}
							{#if d.equipment[0]}<EqChip equip={d.equipment[0]} />{/if}
						</div>
					</div>
				</button>
			{/each}
		</div>
	</div>
</div>
