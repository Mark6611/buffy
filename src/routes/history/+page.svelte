<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ensureSeeded, getRepository } from '$lib/db';
	import { sessionVolume, sessionSetCount, sessionDurationSec } from '$lib/compute';
	import { relativeDay, hhmm, durationLabel, volK } from '$lib/format';
	import type { WorkoutSession } from '$lib/types';
	import Icon from '$lib/components/Icon.svelte';
	import Thumb from '$lib/components/Thumb.svelte';
	import Kpi from '$lib/components/Kpi.svelte';

	let sessions = $state<WorkoutSession[]>([]);

	onMount(async () => {
		await ensureSeeded();
		sessions = await getRepository().listSessions();
	});

	const weekAgo = Date.now() - 7 * 86_400_000;
	const thisWeek = $derived(sessions.filter((s) => Date.parse(s.startedAt) >= weekAgo).length);
	const totalSec = $derived(sessions.reduce((a, s) => a + (sessionDurationSec(s) ?? 0), 0));
	const totalVol = $derived(sessions.reduce((a, s) => a + sessionVolume(s), 0));
	const totalTime = $derived(
		`${Math.floor(totalSec / 3600)}:${String(Math.round((totalSec % 3600) / 60)).padStart(2, '0')}`
	);
</script>

<div class="screen">
	<div class="screen-body">
		<div style="display:flex;align-items:flex-end;justify-content:space-between;padding:8px 20px 14px">
			<div>
				<div class="txt-sm" style="margin-bottom:2px">{sessions.length} sessions</div>
				<h1 class="h-app" style="font-size:calc(var(--dt-base)*28/17)">History</h1>
			</div>
			<button class="icon-btn" onclick={() => goto('/')} aria-label="Home"><Icon name="back" size={18} /></button>
		</div>

		<div class="pad" style="margin-bottom:14px">
			<div class="card card-pad" style="display:flex;justify-content:space-between">
				<Kpi v={String(thisWeek)} l="this week" />
				<span style="width:1px;background:var(--line)"></span>
				<Kpi v={totalTime} l="time" mono />
				<span style="width:1px;background:var(--line)"></span>
				<Kpi v={volK(totalVol)} l="volume kg" mono />
			</div>
		</div>

		<div class="pad" style="display:flex;flex-direction:column;gap:10px;padding-bottom:28px">
			{#each sessions as s (s.id)}
				{@const adhoc = s.sourceTemplateId == null}
				<button
					class="card card-pad"
					style="display:flex;align-items:center;gap:13px;width:100%;text-align:left"
					onclick={() => goto(`/history/${s.id}`)}
				>
					<Thumb equip={adhoc ? 'dumbbell' : 'machine'} />
					<div style="flex:1;min-width:0">
						<div style="display:flex;align-items:center;gap:7px">
							<span class="h-card" style="font-size:calc(var(--dt-base)*16/17)">{s.title ?? 'Workout'}</span>
							{#if adhoc}<span class="chip" style="font-size:calc(var(--dt-base)*10/17);padding:2px 7px">ad-hoc</span>{/if}
						</div>
						<div class="txt-sm mono" style="margin-top:3px">
							{relativeDay(s.startedAt)} · {hhmm(s.startedAt)} · {durationLabel(sessionDurationSec(s) ?? 0)}
						</div>
						<div style="display:flex;gap:12px;margin-top:7px;align-items:center">
							<span class="txt-sm"><span class="num" style="color:var(--ink)">{sessionSetCount(s)}</span> sets</span>
							<span class="txt-sm"><span class="num" style="color:var(--ink)">{volK(sessionVolume(s))}</span> kg vol</span>
							{#if s.note}<span class="suggest" style="font-size:calc(var(--dt-base)*10.5/17)">{s.note}</span>{/if}
						</div>
					</div>
					<Icon name="chevR" size={18} color="var(--ink-3)" />
				</button>
			{/each}
		</div>
	</div>
</div>
