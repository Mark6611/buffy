<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getRepository } from '$lib/db';
	import { captureSessionIntensity } from '$lib/sessionIntensity';
	import { sessionVolume, sessionSetCount, sessionDurationSec, cardioSplit500Sec } from '$lib/compute';
	import { relativeDay, hhmm, mmss, kg, volK } from '$lib/format';
	import type { WorkoutSession, Exercise, LoggedExercise } from '$lib/types';
	import TopBar from '$lib/components/TopBar.svelte';
	import Thumb from '$lib/components/Thumb.svelte';
	import Kpi from '$lib/components/Kpi.svelte';
	import Icon from '$lib/components/Icon.svelte';

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
	async function del() {
		if (s && confirm('Delete this workout?')) {
			await getRepository().deleteSession(s.id);
			goto('/history');
		}
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
			<div class="ex-name" style="font-size:15px">{ex?.name}</div>
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
				<h1 class="h-app" style="font-size:26px">{s.title ?? 'Workout'}</h1>
				<div class="txt-sm mono" style="margin-top:4px;margin-bottom:12px">
					{relativeDay(s.startedAt)} · {hhmm(s.startedAt)} · {mmss(sessionDurationSec(s) ?? 0)}
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
								<span class="chip accent" style="font-size:10.5px;padding:3px 8px;margin-bottom:8px">
									<Icon name="link" size={11} color="var(--accent-ink)" sw={2.2} />Superset
								</span>
							{/if}
							{@render logTable(le)}
						</div>
					{/each}
				</div>

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
</div>
