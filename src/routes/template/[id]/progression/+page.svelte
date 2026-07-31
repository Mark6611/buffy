<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getRepository } from '$lib/db';
	import { settings } from '$lib/stores/settings.svelte';
	import { workout } from '$lib/stores/workout.svelte';
	import { computeSuggestion, type Suggestion } from '$lib/progression';
	import { recovery } from '$lib/stores/recovery.svelte';
	import { kg } from '$lib/format';
	import type { Template, Exercise } from '$lib/types';
	import TopBar from '$lib/components/TopBar.svelte';
	import Button from '$lib/components/Button.svelte';
	import Thumb from '$lib/components/Thumb.svelte';
	import Icon from '$lib/components/Icon.svelte';

	const id = $derived($page.params.id ?? '');
	let tpl = $state<Template | null>(null);
	let rows = $state<{ ex: Exercise; sg: Suggestion | null }[]>([]);

	onMount(async () => {
		await settings.load();
		const repo = getRepository();
		const [t, exAll] = await Promise.all([repo.getTemplate(id), repo.listExercises()]);
		tpl = t ?? null;
		const byId = new Map(exAll.map((e) => [e.id, e]));
		const out: { ex: Exercise; sg: Suggestion | null }[] = [];
		for (const te of t?.exercises ?? []) {
			const ex = byId.get(te.exerciseId);
			if (!ex) continue;
			const last = await repo.lastSessionForExercise(ex.id);
			out.push({ ex, sg: computeSuggestion(ex, last, { readiness: recovery.current?.band }) });
		}
		rows = out;
	});

	async function acceptStart() {
		await workout.startFromTemplate(id, true);
		goto('/workout');
	}
</script>

<div class="screen">
	<TopBar title="Auto-Progression" />
	<div class="screen-body">
		<div class="pad">
			<div class="txt" style="margin:2px 0 14px">
				Based on your last <b style="color:var(--ink)">{tpl?.name ?? ''}</b>. Accept the targets or override any.
			</div>
			<div class="card" style="margin-bottom:16px">
				<div class="row" style="justify-content:space-between">
					<div><div style="font-weight:600">Auto-progression</div><div class="txt-sm">+1 step when you beat target reps</div></div>
					<button class="toggle {settings.current.autoProgression ? 'on' : ''}" aria-label="toggle" onclick={() => settings.save({ autoProgression: !settings.current.autoProgression })}><i></i></button>
				</div>
			</div>

			<div style="display:flex;flex-direction:column;gap:10px">
				{#each rows as r, i (r.ex.id + ':' + i)}
					<div class="card card-pad">
						<div style="display:flex;align-items:center;gap:11px">
							<Thumb equip={r.ex.equipment} size="sm" />
							<div style="flex:1;min-width:0">
								<div class="ex-name" style="font-size:14.5px">{r.ex.name}</div>
								<div class="lasttime" style="margin-top:3px">
									{r.sg ? `last: ${r.sg.last} · ${r.sg.hit ? 'hit target' : 'missed — aim again'}` : 'no history yet'}
								</div>
							</div>
							<span class="setcheck {r.sg?.hit ? 'done' : ''}" style="width:24px;height:24px">
								{#if r.sg?.hit}<Icon name="check" size={14} sw={2.6} color="#fff" />{/if}
							</span>
						</div>
						{#if r.sg}
							<div style="display:flex;align-items:center;gap:10px;margin-top:11px;padding-top:11px;border-top:1px solid var(--line-soft)">
								<Icon name="arrowR" size={16} color={r.sg.hit ? 'var(--accent)' : 'var(--ink-3)'} />
								<span class="num" style="font-size:16px;font-weight:600">
									{r.sg.nextWeight != null ? `${kg(r.sg.nextWeight)}kg` : r.sg.nextReps != null ? `${r.sg.nextReps} reps` : ''}
								</span>
								<span class={r.sg.hit ? 'suggest' : 'chip'} style="font-size:11px">
									{r.sg.stepLabel === 'hold' ? 'hold weight' : r.sg.stepLabel}
								</span>
							</div>
						{/if}
					</div>
				{/each}
			</div>
			<div class="actionbar-clear"></div>
		</div>
	</div>
	<div class="actionbar">
		<Button variant="bordered" style="flex:0" onclick={() => goto('/settings')} aria-label="settings"><Icon name="cog" size={18} /></Button>
		<Button variant="dark" style="flex:1" onclick={acceptStart}><Icon name="play" size={15} color="#fff" />Accept all &amp; Start</Button>
	</div>
</div>
