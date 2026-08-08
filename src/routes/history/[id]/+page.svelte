<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getRepository } from '$lib/db';
	import { captureSessionIntensity } from '$lib/sessionIntensity';
	import { sessionVolume, sessionSetCount, sessionDurationSec, cardioSplit500Sec } from '$lib/compute';
	import { hhmm, mmss, kg, volK } from '$lib/format';
	import { dayWithYear } from '$lib/historyFormat';
	import { buildTemplateFromSession } from '$lib/templateSync';
	import type { WorkoutSession, Exercise, LoggedExercise, SupersetGroup, Template } from '$lib/types';
	import TopBar from '$lib/components/TopBar.svelte';
	import Thumb from '$lib/components/Thumb.svelte';
	import Kpi from '$lib/components/Kpi.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Button from '$lib/components/Button.svelte';

	const id = $derived($page.params.id ?? '');
	let s = $state<WorkoutSession | null>(null);
	let byId = $state<Map<string, Exercise>>(new Map());

	onMount(async () => {
		const repo = getRepository();
		const [sess, ex] = await Promise.all([repo.getSession(id), repo.listExercises()]);
		s = sess ?? null;
		byId = new Map(ex.map((e) => [e.id, e]));
		// Lazy intensity backfill: the wearable's HR usually reaches Health well
		// after the workout ended, so viewing a session is the natural retry point.
		if (sess && (!sess.intensity || !sess.whoop || !sess.calories)) {
			const updated = await captureSessionIntensity($state.snapshot(sess));
			// patch the measured fields only — swapping the whole object would discard
			// a note the user typed into the textarea while the backfill was in flight
			if (updated && s) {
				s.intensity = updated.intensity;
				s.whoop = updated.whoop;
				s.calories = updated.calories;
			}
		}
	});

	async function saveNote() {
		if (s) await getRepository().upsertSession($state.snapshot(s));
	}

	// --- destructive + creative actions, both via the app's own sheet ------------
	let confirmDelete = $state(false);
	let busy = $state(false);
	let sheetError = $state('');

	function del() {
		sheetError = '';
		confirmDelete = true;
	}
	async function doDelete() {
		if (!s || busy) return;
		busy = true;
		try {
			await getRepository().deleteSession(s.id);
			goto('/history');
		} catch (e) {
			sheetError = e instanceof Error ? e.message : 'Could not delete this workout.';
		} finally {
			busy = false;
		}
	}

	// Save a PAST workout as a reusable template. The mapping itself lives in
	// $lib/templateSync (pure + tested) — the same one the finish-workout sheet uses.
	let saveAsTemplate = $state(false);
	let templateName = $state('');
	let savedName = $state('');

	function openSaveTemplate() {
		if (!s) return;
		sheetError = '';
		// A session logged FROM a template usually sits next to a template of the same
		// name, so offer the copy suffix rather than a confusing duplicate.
		templateName = s.title ? (s.sourceTemplateId ? `${s.title} copy` : s.title) : 'New Template';
		saveAsTemplate = true;
	}

	/** buildTemplateFromSession() was written for quick-log sessions, which never group,
	 *  so it returns `groups: []`. A workout logged from a template CAN carry superset
	 *  groupIds, and a template whose `groups` doesn't list them loses the round-based
	 *  rest behaviour — so rebuild the groups from the ids that survived the mapping,
	 *  preferring the source template's own rest value where it still exists. */
	function rebuildGroups(t: Template, source: Template | undefined): SupersetGroup[] {
		const ids = [...new Set(t.exercises.map((e) => e.groupId).filter((g): g is string => !!g))];
		return ids.map((id) => {
			const original = source?.groups.find((g) => g.id === id);
			if (original) return { ...original };
			const member = t.exercises.find((e) => e.groupId === id);
			return { id, restSec: member?.plannedSets[0]?.targetRestSec ?? 60 };
		});
	}

	async function doSaveAsTemplate() {
		const name = templateName.trim();
		if (!s || !name || busy) return;
		busy = true;
		sheetError = '';
		try {
			const repo = getRepository();
			const exById = new Map((await repo.listExercises()).map((e) => [e.id, e]));
			const t = buildTemplateFromSession($state.snapshot(s), exById, name);
			const source = s.sourceTemplateId ? await repo.getTemplate(s.sourceTemplateId) : undefined;
			await repo.upsertTemplate({ ...t, groups: rebuildGroups(t, source) });
			saveAsTemplate = false;
			savedName = name;
		} catch (e) {
			sheetError = e instanceof Error ? e.message : 'Could not save the template.';
		} finally {
			busy = false;
		}
	}

	// move focus into the sheet so VoiceOver/keyboard land inside the dialog
	function autofocusNode(n: HTMLElement) {
		n.focus();
	}
</script>

{#snippet logTable(le: LoggedExercise)}
	{@const ex = byId.get(le.exerciseId)}
	{@const tt = ex?.trackingType ?? 'weight_reps'}
	{@const bw = ex?.loadType === 'bodyweight'}
	{@const perSide = ex?.loadType === 'per_side'}
	{@const cardioDist = ex?.cardioMetric === 'distance'}
	{@const hasRpe = le.sets.some((x) => x.completed && x.rpe != null)}
	<div class="ex-head" style="padding-bottom:4px">
		<Thumb equip={ex?.equipment ?? 'dumbbell'} size="sm" />
		<div class="ex-title">
			<div class="ex-name" style="font-size:calc(var(--dt-base)*15/17)">{ex?.name}</div>
			{#if le.setupNote}<span class="setup-note" style="margin-top:4px"><Icon name="cog" size={11} sw={2} />{le.setupNote}</span>{/if}
		</div>
	</div>
	<table class="settable">
		<thead>
			{#if tt === 'cardio'}
				{#if cardioDist}
					<tr><th class="l" style="width:34px">Set</th><th>Time</th><th>Meters</th><th>/500m</th></tr>
				{:else}
					<tr><th class="l" style="width:34px">Set</th><th>Time</th><th>Incline</th><th>Speed</th></tr>
				{/if}
			{:else if tt === 'time_hold'}
				<tr><th class="l" style="width:38px">Set</th><th>Rest</th><th>Hold</th></tr>
			{:else}
				<tr><th class="l" style="width:38px">Set</th><th>Rest</th><th>Reps</th>{#if !bw}<th>kg{#if perSide}<span class="col-x2"> ×2</span>{/if}</th>{/if}{#if hasRpe}<th>RPE</th>{/if}</tr>
			{/if}
		</thead>
		<tbody>
			{#each le.sets.filter((x) => x.completed) as set, i (i)}
				<tr>
					<td class="l muted">{i + 1}</td>
					{#if tt === 'cardio'}
						{#if cardioDist}
							<td>{mmss(set.timeSec ?? 0)}</td><td>{set.distanceMeters ?? 0}</td><td class="muted">{cardioSplit500Sec(set) != null ? mmss(cardioSplit500Sec(set)!) : '—'}</td>
						{:else}
							<td>{mmss(set.timeSec ?? 0)}</td><td>{set.incline ?? 0}%</td><td>{set.speed ?? 0}</td>
						{/if}
					{:else if tt === 'time_hold'}
						<td class="muted">{set.restTakenSec ? mmss(set.restTakenSec) : '—'}</td><td>{mmss(set.durationSec ?? 0)}</td>
					{:else}
						<td class="muted">{set.restTakenSec ? mmss(set.restTakenSec) : '—'}</td><td>{set.reps ?? ''}</td>{#if !bw}<td>{kg(set.weight)}</td>{/if}{#if hasRpe}<td class="muted">{set.rpe ?? '—'}</td>{/if}
					{/if}
				</tr>
			{/each}
		</tbody>
	</table>
{/snippet}

<div class="screen">
	<TopBar title="Workout" actions={['trash']} onAction={del} />
	<div class="screen-body">
		{#if s}
			<div class="pad" style="padding-bottom:28px">
				<h1 class="h-app" style="font-size:calc(var(--dt-base)*26/17)">{s.title ?? 'Workout'}</h1>
				<div class="txt-sm mono" style="margin-top:4px;margin-bottom:12px">
					{dayWithYear(s.startedAt)} · {hhmm(s.startedAt)} · {mmss(sessionDurationSec(s) ?? 0)}
				</div>
				<div class="card card-pad" style="display:flex;justify-content:space-between;margin-bottom:16px">
					<Kpi v={String(sessionSetCount(s))} l="sets" />
					<span style="width:1px;background:var(--line)"></span>
					<Kpi v={volK(sessionVolume(s))} l="volume kg" mono />
					<span style="width:1px;background:var(--line)"></span>
					<Kpi v={mmss(sessionDurationSec(s) ?? 0)} l="duration" mono />
				</div>

				{#if s.intensity || s.whoop || s.calories}
					{@const wi = s.intensity}
					<div class="card card-pad" style="margin-bottom:16px">
						{#if s.calories}
							<div class="row" style="justify-content:space-between;margin-bottom:{s.whoop || wi ? '8px' : '0'}">
								<div style="font-weight:500">~{s.calories.kcal} kcal</div>
								<span class="txt-sm">{s.calories.method === 'whoop' ? 'via Whoop' : s.calories.method === 'hr' ? 'from heart rate' : 'estimated'}</span>
							</div>
						{/if}
						{#if s.whoop}
							<div class="row" style="justify-content:space-between;margin-bottom:{wi ? '8px' : '0'}">
								<div style="font-weight:500">Whoop strain {s.whoop.strain.toFixed(1)}</div>
								<span class="txt-sm mono">avg {s.whoop.avgHr} · max {s.whoop.maxHr} bpm</span>
							</div>
						{/if}
						{#if wi}
						<div class="row" style="justify-content:space-between;margin-bottom:10px">
							<div style="font-weight:500;text-transform:capitalize">Intensity — {wi.band} · {wi.score}</div>
							<span class="txt-sm mono">avg {wi.avgHr} · peak {wi.peakHr} bpm</span>
						</div>
						<!-- time-in-zone bar: z1→z5 left to right, deeper tint = harder -->
						<div style="display:flex;gap:1px;height:8px;border-radius:var(--r-pill);overflow:hidden;background:var(--surface-2)">
							{#each [wi.zones.z1, wi.zones.z2, wi.zones.z3, wi.zones.z4, wi.zones.z5] as frac, zi (zi)}
								{#if frac > 0}
									<span style="width:{frac * 100}%;background:color-mix(in oklch, var(--accent) {15 + zi * 21}%, var(--surface-2))"></span>
								{/if}
							{/each}
						</div>
						<div class="txt-sm" style="margin-top:6px">
							heart rate via Apple Health — % of workout per effort zone
						</div>
						{/if}
					</div>
				{/if}

				<div class="h-sec" style="margin-bottom:10px">Logged exercises</div>
				<div style="display:flex;flex-direction:column;gap:10px">
					{#each s.exercises as le, i (le.exerciseId + ':' + i)}
						<div class="card card-pad">
							{#if le.groupId}
								<span class="chip accent" style="font-size:calc(var(--dt-base)*10.5/17);padding:3px 8px;margin-bottom:8px">
									<Icon name="link" size={11} color="var(--accent-ink)" sw={2.2} />Superset
								</span>
							{/if}
							{@render logTable(le)}
						</div>
					{/each}
				</div>

				<button
					class="card card-pad"
					style="margin-top:12px;display:flex;align-items:center;gap:11px;width:100%;text-align:left"
					onclick={openSaveTemplate}
				>
					<span class="stat-ic"><Icon name="copy" size={16} color="var(--accent-ink)" /></span>
					<div style="flex:1">
						<div style="font-weight:500">Save as a template</div>
						<div class="txt-sm">reuse these exercises, sets and weights</div>
					</div>
					<Icon name="chevR" size={16} color="var(--ink-3)" />
				</button>
				{#if savedName}
					<div class="txt-sm" style="margin-top:8px;padding-inline:4px;color:var(--ink-2)">
						Saved “{savedName}” — it's on your home screen now.
					</div>
				{/if}

				<div class="card card-pad" style="margin-top:12px;display:flex;align-items:flex-start;gap:10px">
					<Icon name="note" size={18} color="var(--ink-3)" />
					<textarea
						class="txt"
						style="flex:1;border:none;background:transparent;resize:none;font-family:var(--font-ui)"
						rows="2"
						placeholder="Add a note…"
						bind:value={s.note}
						onblur={saveNote}
					></textarea>
				</div>
			</div>
		{/if}
	</div>

	{#if saveAsTemplate}
		<button class="sheet-backdrop" aria-label="Cancel" onclick={() => (saveAsTemplate = false)} disabled={busy}></button>
		<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="tpl-title" tabindex="-1" use:autofocusNode>
			<div class="sheet-grip" aria-hidden="true"></div>
			<span class="stat-ic" style="width:46px;height:46px;background:var(--accent-tint);margin-bottom:14px"><Icon name="copy" size={22} color="var(--accent-ink)" /></span>
			<div class="h-card" id="tpl-title" style="font-size:calc(var(--dt-base)*19/17);margin-bottom:6px">Save as a template?</div>
			<div class="txt" style="margin-bottom:14px">Turn this workout into a reusable template. Nothing about the workout itself changes.</div>
			<input class="inp" style="width:100%;height:44px;margin-bottom:16px" type="text" aria-label="Template name" placeholder="Template name" bind:value={templateName} />
			<div style="display:flex;gap:10px">
				<Button variant="bordered" style="flex:1" onclick={() => (saveAsTemplate = false)} disabled={busy}>Cancel</Button>
				<Button style="flex:1.3" onclick={doSaveAsTemplate} disabled={busy || !templateName.trim()}>
					{busy ? 'Saving…' : 'Save as template'}
				</Button>
			</div>
			{#if sheetError}
				<div class="txt-sm" style="margin-top:10px;padding-inline:4px;color:var(--warn)">{sheetError}</div>
			{/if}
		</div>
	{/if}

	{#if confirmDelete}
		<button class="sheet-backdrop" aria-label="Cancel" onclick={() => (confirmDelete = false)} disabled={busy}></button>
		<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="del-title" tabindex="-1" use:autofocusNode>
			<div class="sheet-grip" aria-hidden="true"></div>
			<span class="stat-ic" style="width:46px;height:46px;background:var(--warn-tint);margin-bottom:14px"><Icon name="trash" size={22} color="var(--warn)" /></span>
			<div class="h-card" id="del-title" style="font-size:calc(var(--dt-base)*19/17);margin-bottom:6px">Delete this workout?</div>
			<div class="txt" style="margin-bottom:16px">
				{s?.title ?? 'This workout'} and every set logged in it are removed from your history. This can't be undone.
			</div>
			<div style="display:flex;gap:10px">
				<Button variant="bordered" style="flex:1" onclick={() => (confirmDelete = false)} disabled={busy}>Cancel</Button>
				<Button style="flex:1.3;background:var(--warn);color:#fff" onclick={doDelete} disabled={busy}>{busy ? 'Deleting…' : 'Delete'}</Button>
			</div>
			{#if sheetError}
				<div class="txt-sm" style="margin-top:10px;padding-inline:4px;color:var(--warn)">{sheetError}</div>
			{/if}
		</div>
	{/if}
</div>
