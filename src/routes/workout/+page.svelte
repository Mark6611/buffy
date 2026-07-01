<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { workout } from '$lib/stores/workout.svelte';
	import { mmss, kg, parseMmss } from '$lib/format';
	import { platesPerSide, formatPerSide } from '$lib/plates';
	import { autoBackup } from '$lib/data';
	import { syncWidget } from '$lib/widgetSync';
	import { getRepository } from '$lib/db';
	import { settings } from '$lib/stores/settings.svelte';
	import { writeHealthWorkout } from '$lib/native';
	import { applyFullSync, applyWeightsOnlySync, buildTemplateFromSession } from '$lib/templateSync';
	import type { LoggedSet, Template, WorkoutSession } from '$lib/types';
	import Icon from '$lib/components/Icon.svelte';
	import Thumb from '$lib/components/Thumb.svelte';
	import RestBanner from '$lib/components/RestBanner.svelte';
	import SwipeActions from '$lib/components/SwipeActions.svelte';

	onMount(() => {
		if (!workout.active) goto('/');
	});

	function numOrUndef(v: string): number | undefined {
		const n = parseFloat(v);
		return Number.isFinite(n) ? n : undefined;
	}

	// After finishing, offer to sync the result back into its source template (or,
	// for a quick-log session, offer to save it as a brand-new one) before leaving.
	let syncPrompt = $state<{ savedId: string; session: WorkoutSession; template: Template | null } | null>(null);
	let newTemplateName = $state('');
	let syncBusy = $state(false);

	async function finish() {
		const wasTemplateSourced = workout.session?.sourceTemplateId ?? null;
		const id = await workout.finish();
		if (!id) {
			goto('/');
			return;
		}
		void autoBackup(); // native: snapshot all data to Documents after a logged workout
		void refreshWidget();
		if (!settings.loaded) await settings.load(); // e.g. quick-log never loads settings itself
		if (settings.current.writeToHealth) void writeHealthAfterFinish(id);

		const repo = getRepository();
		const saved = await repo.getSession(id);
		if (!saved) {
			goto(`/history/${id}`);
			return;
		}
		if (wasTemplateSourced) {
			const tpl = await repo.getTemplate(wasTemplateSourced);
			if (!tpl) {
				goto(`/history/${id}`); // source template was deleted mid-workout — nothing to sync
				return;
			}
			syncPrompt = { savedId: id, session: saved, template: tpl };
		} else {
			newTemplateName = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
			syncPrompt = { savedId: id, session: saved, template: null };
		}
	}
	async function refreshWidget() {
		const repo = getRepository();
		const [sessions, templates] = await Promise.all([repo.listSessions(), repo.listTemplates()]);
		await syncWidget(sessions, templates);
	}
	async function writeHealthAfterFinish(id: string) {
		const s = await getRepository().getSession(id);
		if (s?.endedAt) await writeHealthWorkout(Date.parse(s.startedAt), Date.parse(s.endedAt));
	}
	function finalizeSync() {
		const id = syncPrompt?.savedId;
		syncPrompt = null;
		goto(id ? `/history/${id}` : '/');
	}
	async function chooseTemplateSync(mode: 'full' | 'weightsOnly' | 'none') {
		if (syncPrompt?.template && mode !== 'none') {
			syncBusy = true;
			const repo = getRepository();
			// snapshot: syncPrompt is $state, so its nested objects are reactive
			// proxies — IndexedDB can't structured-clone those for upsertTemplate.
			const template = $state.snapshot(syncPrompt.template);
			const session = $state.snapshot(syncPrompt.session);
			const updated =
				mode === 'full'
					? applyFullSync(template, session, new Map((await repo.listExercises()).map((e) => [e.id, e])))
					: applyWeightsOnlySync(template, session);
			await repo.upsertTemplate(updated);
			syncBusy = false;
		}
		finalizeSync();
	}
	async function saveAsNewTemplate(save: boolean) {
		if (save && syncPrompt) {
			syncBusy = true;
			const repo = getRepository();
			const exById = new Map((await repo.listExercises()).map((e) => [e.id, e]));
			const session = $state.snapshot(syncPrompt.session);
			await repo.upsertTemplate(buildTemplateFromSession(session, exById, newTemplateName.trim() || 'New Template'));
			syncBusy = false;
		}
		finalizeSync();
	}
	function close() {
		if (confirm('Discard this workout? Nothing will be saved.')) {
			workout.cancel();
			goto('/');
		}
	}
	function removeExercise(exIndex: number) {
		const le = workout.session?.exercises[exIndex];
		const hasLoggedSets = !!le?.sets.some((s) => s.completed);
		const name = workout.meta[exIndex]?.name ?? 'this exercise';
		const msg = hasLoggedSets
			? `Remove ${name}? Sets you've already logged for it will be lost.`
			: `Remove ${name} from this workout?`;
		if (confirm(msg)) workout.removeExercise(exIndex);
	}
	function swapExercise(exIndex: number) {
		const le = workout.session?.exercises[exIndex];
		const hasLoggedSets = !!le?.sets.some((s) => s.completed);
		const name = workout.meta[exIndex]?.name ?? 'this exercise';
		if (hasLoggedSets && !confirm(`Swap ${name}? Sets you've already logged for it will be lost.`)) return;
		goto(`/picker?to=workout&swap=${exIndex}`);
	}

	// Swipeable exercise-header rows: opening one closes any other that's open.
	let swipeRefs: (SwipeActions | undefined)[] = $state([]);
	function closeOtherSwipes(exIndex: number) {
		swipeRefs.forEach((r, i) => {
			if (i !== exIndex) r?.close();
		});
	}
</script>

{#snippet restCell(exIndex: number, s: number, set: LoggedSet)}
	<td class={set.completed ? '' : 'muted'}>
		{#if set.completed}{set.restTakenSec != null ? mmss(set.restTakenSec) : '—'}{:else if s === 0}—{:else}<input class="inp rest-inp" type="text" value={mmss(workout.plannedRest[exIndex]?.[s] ?? 0)} onchange={(e) => workout.setPlannedRest(exIndex, s, parseMmss(e.currentTarget.value))} />{/if}
	</td>
{/snippet}

{#if workout.session}
	<div class="screen">
		<div class="topbar" style="padding-bottom:6px">
			<button class="icon-btn" onclick={close} aria-label="Close"><Icon name="chevD" size={20} /></button>
			<div style="text-align:center">
				<div style="font-size:15px;font-weight:600;letter-spacing:-0.2px">{workout.session.title}</div>
				<div class="mono txt-sm" style="margin-top:1px">
					{mmss(workout.elapsedSec)} · {workout.exerciseCount
						? `${workout.activeEx + 1}/${workout.exerciseCount}`
						: 'no exercises'}
				</div>
			</div>
			<button class="btn btn-accent btn-sm" style="height:36px;padding:0 14px" onclick={finish}>Finish</button>
		</div>

		<div class="screen-body">
			<div class="pad" style="padding-bottom:40px">
				{#each workout.session.exercises as le, exIndex (exIndex)}
					{@const ex = workout.meta[exIndex]}
					{@const bw = ex?.loadType === 'bodyweight'}
					{@const perSide = ex?.loadType === 'per_side'}
					{@const tt = ex?.trackingType ?? 'weight_reps'}
					{@const sg = workout.suggestions[le.exerciseId]}
					<div class="ex-block">
						<SwipeActions bind:this={swipeRefs[exIndex]} onOpen={() => closeOtherSwipes(exIndex)}>
							{#snippet children()}
								<div class="ex-head">
									<Thumb equip={ex?.equipment ?? 'dumbbell'} />
									<div class="ex-title">
										<div class="ex-name">{ex?.name}</div>
										<div class="ex-meta">
											{le.sets.length} sets{#if tt === 'weight_reps' && !bw} · target {ex?.defaultTargetReps} reps{/if}
											{#if tt === 'time_hold'}<span class="tt-badge" style="margin-left:6px">time-hold</span>{/if}
											{#if tt === 'cardio'}<span class="tt-badge" style="margin-left:6px">cardio · log-only</span>{/if}
											{#if bw}<span class="tt-badge" style="margin-left:6px">bodyweight</span>{/if}
										</div>
										{#if le.setupNote}
											<span class="setup-note"><Icon name="cog" size={12} sw={2} />{le.setupNote}</span>
										{/if}
									</div>
								</div>
							{/snippet}
							{#snippet actions()}
								<button class="swipe-btn" style="background:var(--accent)" onclick={() => swapExercise(exIndex)}>
									<Icon name="swap" size={18} color="#fff" sw={2.2} />
									<span>Swap</span>
								</button>
								<button class="swipe-btn" style="background:var(--warn)" onclick={() => removeExercise(exIndex)}>
									<Icon name="trash" size={18} color="#fff" sw={2.2} />
									<span>Delete</span>
								</button>
							{/snippet}
						</SwipeActions>

						<table class="settable">
							<thead>
								{#if tt === 'cardio'}
									<tr><th class="c" style="width:34px"></th><th class="l" style="width:34px">Set</th><th>Time</th><th>Incline</th><th>Speed</th></tr>
								{:else if tt === 'time_hold'}
									<tr><th class="c" style="width:34px"></th><th class="l" style="width:38px">Set</th><th>Rest</th><th>Hold</th></tr>
								{:else}
									<tr><th class="c" style="width:34px"></th><th class="l" style="width:38px">Set</th><th>Rest</th><th>Reps</th>{#if !bw}<th style="width:{perSide ? 74 : 58}px">kg{#if perSide}<span class="col-x2"> ×2</span>{/if}</th>{/if}</tr>
								{/if}
							</thead>
							<tbody>
								{#each le.sets as set, s (s)}
									{@const isActive = exIndex === workout.activeEx && s === workout.activeSet && !set.completed}
									<tr class={set.completed ? 'row-done' : isActive ? 'row-active' : ''}>
										<td class="c">
											<button class="setcheck {set.completed ? 'done' : ''}" onclick={() => workout.toggleSet(exIndex, s)} aria-label="toggle set">
												{#if set.completed}<Icon name="check" size={14} sw={2.6} color="#fff" />{/if}
											</button>
										</td>
										<td class="l muted" style="font-weight:600;{isActive ? 'color:var(--accent-ink)' : ''}">{s + 1}</td>

										{#if tt === 'cardio'}
											<td><input class="inp" type="text" value={mmss(set.timeSec ?? 0)} onchange={(e) => (set.timeSec = parseMmss(e.currentTarget.value))} /></td>
											<td><input class="inp" type="number" value={set.incline ?? ''} oninput={(e) => (set.incline = numOrUndef(e.currentTarget.value))} /></td>
											<td><input class="inp" type="number" value={set.speed ?? ''} oninput={(e) => (set.speed = numOrUndef(e.currentTarget.value))} /></td>
										{:else if tt === 'time_hold'}
											{@render restCell(exIndex, s, set)}
											<td><input class="inp" type="text" value={mmss(set.durationSec ?? 0)} onchange={(e) => (set.durationSec = parseMmss(e.currentTarget.value))} /></td>
										{:else}
											{@render restCell(exIndex, s, set)}
											<td><input class="inp" type="number" value={set.reps ?? ''} oninput={(e) => (set.reps = numOrUndef(e.currentTarget.value))} /></td>
											{#if !bw}
												<td><input class="inp" type="number" step="0.5" value={set.weight ?? ''} oninput={(e) => (set.weight = numOrUndef(e.currentTarget.value))} /></td>
											{/if}
										{/if}
									</tr>
								{/each}
							</tbody>
						</table>

						{#if ex?.equipment === 'barbell' && exIndex === workout.activeEx && (le.sets[workout.activeSet]?.weight ?? 0) > 0}
							<div class="txt-sm" style="display:flex;align-items:center;gap:8px;padding:9px 2px 0;color:var(--ink-2)">
								<span style="font-size:10.5px;font-weight:600;letter-spacing:0.4px;color:var(--ink-3);border:1px solid var(--line);border-radius:5px;padding:1px 5px">BAR</span>
								<span class="mono">{formatPerSide(platesPerSide(le.sets[workout.activeSet]?.weight ?? 0))}</span>
								<span style="color:var(--ink-3)">/ side</span>
							</div>
						{/if}

						{#if sg}
							<div style="display:flex;align-items:center;gap:8px;padding:10px 2px 2px;flex-wrap:wrap">
								<Icon name="spark" size={14} color="var(--accent)" />
								<span class="txt-sm" style="color:var(--ink-2)">Last {sg.last} · {sg.hit ? 'hit target →' : 'aim again'}</span>
								<span class="suggest">
									{sg.stepLabel}{#if sg.nextWeight != null} · {kg(sg.nextWeight)}kg{:else if sg.nextReps != null} · {sg.nextReps} reps{/if}
								</span>
							</div>
						{/if}

						{#if workout.restForSet?.ex === exIndex}
							<div style="margin:14px 0"><RestBanner /></div>
						{/if}
					</div>
				{/each}
				<button class="btn btn-ghost btn-block" style="margin-top:6px" onclick={() => goto('/picker?to=workout')}>
					<Icon name="plus" size={18} />Add exercise
				</button>

				<div style="margin-top:20px">
					<div class="h-sec" style="margin-bottom:8px">Session notes</div>
					<textarea
						class="note-input"
						placeholder="How did it go? Form cues, how you felt, anything to remember…"
						value={workout.session.note ?? ''}
						oninput={(e) => workout.setNote(e.currentTarget.value)}
					></textarea>
				</div>
			</div>
		</div>
	</div>
{/if}

{#if syncPrompt}
	<button
		style="position:fixed;inset:0;background:rgba(20,16,12,0.4);z-index:40;border:none"
		aria-label="Dismiss"
		onclick={finalizeSync}
		disabled={syncBusy}
	></button>
	<div style="position:fixed;left:0;right:0;bottom:0;z-index:50;background:var(--surface);border-radius:24px 24px 0 0;padding:22px 20px calc(30px + env(safe-area-inset-bottom,0));box-shadow:0 -10px 40px rgba(0,0,0,0.2);max-width:480px;margin:0 auto">
		<div style="width:40px;height:4px;border-radius:99px;background:var(--line);margin:0 auto 18px"></div>
		<span class="stat-ic" style="width:46px;height:46px;background:var(--accent-tint);margin-bottom:14px"><Icon name="swap" size={22} color="var(--accent-ink)" /></span>

		{#if syncPrompt.template}
			<div class="h-card" style="font-size:19px;margin-bottom:6px">Update “{syncPrompt.template.name}”?</div>
			<div class="txt" style="margin-bottom:16px">You made changes this workout — apply them back to the template for next time?</div>
			<div style="display:flex;flex-direction:column;gap:9px">
				<button class="btn btn-accent" onclick={() => chooseTemplateSync('full')} disabled={syncBusy}>
					Update whole template
				</button>
				<button class="btn btn-ghost" onclick={() => chooseTemplateSync('weightsOnly')} disabled={syncBusy}>
					Update weights only
				</button>
				<button class="btn btn-ghost" style="color:var(--ink-3)" onclick={() => chooseTemplateSync('none')} disabled={syncBusy}>
					{syncBusy ? 'Working…' : "Leave template as-is"}
				</button>
			</div>
		{:else}
			<div class="h-card" style="font-size:19px;margin-bottom:6px">Save as a template?</div>
			<div class="txt" style="margin-bottom:14px">Turn this quick-logged workout into a reusable template.</div>
			<input class="inp" style="width:100%;height:44px;margin-bottom:16px" type="text" placeholder="Template name" bind:value={newTemplateName} />
			<div style="display:flex;gap:10px">
				<button class="btn btn-ghost" style="flex:1" onclick={() => saveAsNewTemplate(false)} disabled={syncBusy}>Don't save</button>
				<button class="btn btn-accent" style="flex:1.3" onclick={() => saveAsNewTemplate(true)} disabled={syncBusy || !newTemplateName.trim()}>
					{syncBusy ? 'Working…' : 'Save as template'}
				</button>
			</div>
		{/if}
	</div>
{/if}
