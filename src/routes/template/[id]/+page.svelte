<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getRepository } from '$lib/db';
	import { templateDerived } from '$lib/compute';
	import { durationLabel, kg, mmss, equipLabel } from '$lib/format';
	import { workout } from '$lib/stores/workout.svelte';
	import type { Template, Exercise, TemplateExercise } from '$lib/types';
	import TopBar from '$lib/components/TopBar.svelte';
	import Thumb from '$lib/components/Thumb.svelte';
	import EqChip from '$lib/components/EqChip.svelte';
	import MetaStat from '$lib/components/MetaStat.svelte';
	import Icon from '$lib/components/Icon.svelte';

	const id = $derived($page.params.id ?? '');
	let tpl = $state<Template | null>(null);
	let byId = $state<Map<string, Exercise>>(new Map());

	onMount(load);
	async function load() {
		const repo = getRepository();
		const [t, ex] = await Promise.all([repo.getTemplate(id), repo.listExercises()]);
		tpl = t ?? null;
		byId = new Map(ex.map((e) => [e.id, e]));
	}

	const td = $derived(tpl ? templateDerived(tpl, byId) : null);

	type Item =
		| { type: 'single'; te: TemplateExercise }
		| { type: 'group'; members: TemplateExercise[]; restSec: number };

	const items = $derived.by<Item[]>(() => {
		if (!tpl) return [];
		const out: Item[] = [];
		let i = 0;
		while (i < tpl.exercises.length) {
			const te = tpl.exercises[i];
			if (te.groupId) {
				const gid = te.groupId;
				const members: TemplateExercise[] = [];
				while (i < tpl.exercises.length && tpl.exercises[i].groupId === gid) members.push(tpl.exercises[i++]);
				out.push({ type: 'group', members, restSec: tpl.groups.find((g) => g.id === gid)?.restSec ?? 60 });
			} else {
				out.push({ type: 'single', te });
				i++;
			}
		}
		return out;
	});

	function line(te: TemplateExercise): string {
		const ex = byId.get(te.exerciseId);
		if (!ex) return '';
		const n = te.plannedSets.length;
		const p = te.plannedSets[0] ?? {};
		if (ex.trackingType === 'time_hold') return `${n} × ${mmss(p.targetDurationSec ?? 0)} hold`;
		if (ex.trackingType === 'cardio') return 'cardio · log-only';
		return `${n} × ${p.targetReps} · ${kg(p.targetWeight)}kg${ex.loadType === 'per_side' ? ' ×2' : ''}`;
	}

	async function start() {
		await workout.startFromTemplate(id);
		goto('/workout');
	}
</script>

{#snippet exRow(te: TemplateExercise, bare = false)}
	{@const ex = byId.get(te.exerciseId)}
	<div class={bare ? '' : 'card card-pad'} style="display:flex;gap:12px;align-items:center">
		<Thumb equip={ex?.equipment ?? 'dumbbell'} />
		<div style="flex:1;min-width:0">
			<div class="ex-name">{ex?.name}</div>
			<div class="num" style="font-size:13px;color:var(--ink-2);margin-top:4px">{line(te)}</div>
			{#if te.setupNote ?? ex?.setupNote}
				<span class="setup-note" style="margin-top:6px">
					<Icon name="cog" size={12} sw={2} />{te.setupNote ?? ex?.setupNote}
				</span>
			{/if}
		</div>
	</div>
{/snippet}

<div class="screen">
	<TopBar title="Template" actions={['edit']} onAction={() => goto(`/template/${id}/edit`)} />
	<div class="screen-body">
		{#if tpl && td}
			<div class="pad">
				<div class="hero" style="margin-bottom:16px"></div>
				<h1 class="h-app" style="margin-bottom:14px">{tpl.name}</h1>

				<div style="margin-bottom:8px">
					<MetaStat icon="clock">{durationLabel(td.estDurationSec)}</MetaStat>
					<MetaStat icon="body">{td.muscles.join(', ')}</MetaStat>
				</div>

				<div style="display:flex;gap:7px;flex-wrap:wrap;margin:6px 0 22px">
					{#each td.equipment as e (e)}<EqChip equip={e} />{/each}
				</div>

				<div class="h-sec" style="margin-bottom:12px">Exercises · {tpl.exercises.length}</div>

				<div style="display:flex;flex-direction:column;gap:10px">
					{#each items as item (item.type === 'single' ? item.te.exerciseId : item.members[0].exerciseId)}
						{#if item.type === 'single'}
							{@render exRow(item.te)}
						{:else}
							<div class="superset">
								<span class="superset-tag"><Icon name="link" size={12} color="#fff" sw={2.2} />Superset</span>
								{#each item.members as m (m.exerciseId)}
									<div class="ss-member">{@render exRow(m, true)}</div>
								{/each}
								<div class="ss-rest">
									<Icon name="timer" size={13} color="var(--accent)" />rest {mmss(item.restSec)} after each round
								</div>
							</div>
						{/if}
					{/each}
				</div>
				<div style="height:96px"></div>
			</div>
		{/if}
	</div>

	<div class="actionbar">
		<button class="btn btn-dark" style="flex:1.1" onclick={start}>
			<Icon name="play" size={15} color="#fff" />Start
		</button>
		<button class="btn btn-accent" style="flex:1.3" onclick={() => goto(`/template/${id}/progression`)}>
			<Icon name="spark" size={17} color="#fff" />Auto-Progression
		</button>
	</div>
</div>
