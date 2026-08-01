<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ensureSeeded, getRepository } from '$lib/db';
	import {
		kpis,
		weeklyVolume,
		heatmap,
		progressionPreview,
		muscleSets,
		recentPRs,
		type TrendWindow
	} from '$lib/analytics';
	import { volK, hoursMinutes } from '$lib/format';
	import { HEAT } from '$lib/charts';
	import type { WorkoutSession, Exercise } from '$lib/types';
	import TopBar from '$lib/components/TopBar.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Thumb from '$lib/components/Thumb.svelte';
	import StatCard from '$lib/components/StatCard.svelte';
	import SecHead from '$lib/components/SecHead.svelte';
	import WindowSeg from '$lib/components/WindowSeg.svelte';
	import BarsChart from '$lib/components/charts/BarsChart.svelte';
	import Heatmap from '$lib/components/charts/Heatmap.svelte';
	import Spark from '$lib/components/charts/Spark.svelte';
	import HBars from '$lib/components/charts/HBars.svelte';
	import BodyWeightCard from '$lib/components/BodyWeightCard.svelte';

	let sessions = $state<WorkoutSession[]>([]);
	let byId = $state<Map<string, Exercise>>(new Map());
	let loaded = $state(false);
	let win = $state<TrendWindow>('12w');

	onMount(async () => {
		await ensureSeeded();
		const repo = getRepository();
		const [s, ex] = await Promise.all([repo.listSessions(), repo.listExercises()]);
		sessions = s;
		byId = new Map(ex.map((e) => [e.id, e]));
		loaded = true;
	});

	const enough = $derived(sessions.length >= 3);
	const k = $derived(kpis(sessions));
	const vol = $derived(weeklyVolume(sessions, win));
	const heat = $derived(heatmap(sessions, win));
	const preview = $derived(progressionPreview(sessions, byId, win));
	const muscles = $derived(muscleSets(sessions, byId, win));
	const prs = $derived(recentPRs(sessions, byId));
	const low = $derived(muscles.find((m) => m.low));

	const sessDelta = $derived(
		k.sessionsDelta === 0 ? 'same' : k.sessionsDelta > 0 ? `+${k.sessionsDelta}` : `${k.sessionsDelta}`
	);
</script>

<div class="screen">
	<TopBar title="Trends" />
	<div class="screen-body">
		{#if loaded && !enough}
			<!-- early state -->
			<div class="pad" style="display:flex;justify-content:flex-end;margin-bottom:8px"><WindowSeg bind:value={win} /></div>
			<div class="pad" style="margin-bottom:18px">
				<div style="display:flex;gap:10px">
					<StatCard icon="fire" big="{k.streakDays} {k.streakDays === 1 ? 'day' : 'days'}" label="Current streak" accent />
					<StatCard icon="chart" big={volK(k.volThisWeek)} label="Volume this wk" />
				</div>
			</div>
			<div class="pad">
				<div class="card" style="overflow:hidden">
					<div style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:34px 26px">
						<span style="width:64px;height:64px;border-radius:18px;display:flex;align-items:center;justify-content:center;background:var(--accent-tint);margin-bottom:16px">
							<Icon name="trend" size={28} color="var(--accent-ink)" sw={1.7} />
						</span>
						<div class="h-card" style="font-size:calc(var(--dt-base)*18/17);margin-bottom:6px">Charts unlock as you log</div>
						<div class="txt" style="max-width:260px">
							{sessions.length} {sessions.length === 1 ? 'workout' : 'workouts'} in. After ~3 sessions you'll see volume
							trends, a consistency heatmap, and your first PRs here.
						</div>
					</div>
				</div>
			</div>
		{:else if loaded}
			<div class="pad" style="display:flex;justify-content:flex-end;margin-bottom:12px"><WindowSeg bind:value={win} /></div>

			<!-- KPIs -->
			<div class="pad" style="display:flex;flex-direction:column;gap:10px;margin-bottom:22px">
				<div style="display:flex;gap:10px">
					<StatCard icon="fire" big="{k.streakDays} {k.streakDays === 1 ? 'day' : 'days'}" label="Current streak" accent />
					<StatCard
						icon="chart"
						big={volK(k.volThisWeek)}
						label="Volume this wk"
						delta={k.volDeltaPct == null ? undefined : `${Math.abs(k.volDeltaPct)}%`}
						deltaUp={(k.volDeltaPct ?? 0) >= 0}
					/>
				</div>
				<div style="display:flex;gap:10px">
					<StatCard icon="cal" big={String(k.sessionsThisWeek)} label="Sessions / wk" delta={sessDelta} deltaUp={k.sessionsDelta >= 0} />
					<StatCard
						icon="clock"
						big={hoursMinutes(k.timeThisWeekSec)}
						label="Time this wk"
						delta={k.timeDeltaPct == null ? undefined : `${Math.abs(k.timeDeltaPct)}%`}
						deltaUp={(k.timeDeltaPct ?? 0) >= 0}
					/>
				</div>
			</div>

			<!-- A · volume / week -->
			<div class="pad" style="margin-bottom:22px">
				<SecHead>Volume / week · kg</SecHead>
				<div class="card card-pad">
					<BarsChart data={vol.weeks} />
					<div class="txt-sm" style="margin-top:6px;text-align:center">
						last {vol.weeks.length} weeks · <span class="num" style="color:var(--ink)">{vol.totalK}K</span> total
					</div>
				</div>
			</div>

			<!-- A · consistency -->
			<div class="pad" style="margin-bottom:22px">
				<SecHead>Consistency</SecHead>
				<div class="card card-pad">
					<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
						<span class="chip accent" style="font-size:calc(var(--dt-base)*11/17)"><Icon name="fire" size={12} color="var(--accent-ink)" />{k.streakDays}-day streak</span>
						<span class="txt-sm">{heat.sessions} sessions · ~{heat.perWeek} / week</span>
					</div>
					<Heatmap weeks={heat.weeks} />
					<div style="display:flex;align-items:center;justify-content:flex-end;gap:6px;margin-top:8px">
						<span class="txt-sm">less</span>
						{#each HEAT as c, i (i)}
							<span style="width:12px;height:12px;border-radius:3px;background:{c};border:{i === 0 ? '1px solid var(--line)' : 'none'}"></span>
						{/each}
						<span class="txt-sm">more</span>
					</div>
				</div>
			</div>

			<!-- B · progression preview -->
			{#if preview}
				<div class="pad" style="margin-bottom:22px">
					<SecHead link="all exercises" onlink={() => goto('/trends/progression')}>Progression</SecHead>
					<button
						class="card card-pad"
						style="display:flex;align-items:center;gap:13px;width:100%;text-align:left"
						onclick={() => goto('/trends/progression')}
					>
						<Thumb equip={preview.exercise.equipment} />
						<div style="flex:1;min-width:0">
							<div class="ex-name" style="font-size:calc(var(--dt-base)*14.5/17)">{preview.exercise.name}</div>
							<div class="txt-sm mono" style="margin-top:2px">{preview.summary}</div>
						</div>
						<Spark data={preview.spark} />
					</button>
				</div>
			{/if}

			<!-- C · muscle balance preview -->
			{#if muscles.length}
				<div class="pad" style="margin-bottom:22px">
					<SecHead link="balance" onlink={() => goto('/trends/muscles')}>Muscle balance</SecHead>
					<div class="card card-pad">
						<HBars data={muscles.slice(0, 4)} max={muscles[0].v} />
						{#if low}
							<div style="display:flex;align-items:center;gap:7px;margin-top:12px;padding:9px 11px;background:var(--warn-tint);border-radius:10px">
								<Icon name="alert" size={15} color="var(--warn)" />
								<span class="txt-sm" style="color:var(--ink-2)"><b style="color:var(--ink)">{low.l}</b> under-trained — {low.v} sets vs {muscles[0].v} for {muscles[0].l}.</span>
							</div>
						{/if}
					</div>
				</div>
			{/if}

			<!-- recent PRs -->
			{#if prs.length}
				<div class="pad" style="margin-bottom:22px">
					<SecHead>Recent PRs</SecHead>
					<div class="card">
						{#each prs as p, i (i)}
							{#if i > 0}<div class="divider"></div>{/if}
							<div class="row">
								<span class="stat-ic" style="background:var(--accent-tint)"><Icon name="trophy" size={16} color="var(--accent-ink)" /></span>
								<div style="flex:1;min-width:0">
									<div style="font-size:calc(var(--dt-base)*13.5/17);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{p.ex}</div>
									<div class="txt-sm">{p.kind} · {p.when}</div>
								</div>
								<div style="text-align:right">
									<div class="num" style="font-size:calc(var(--dt-base)*15/17);font-weight:600">{p.v}</div>
									<div class="suggest" style="font-size:calc(var(--dt-base)*10/17);padding:1px 6px;margin-top:2px">{p.delta}</div>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- D · data card -->
			<div class="pad" style="margin-bottom:16px">
				<button class="card card-pad" style="display:flex;align-items:center;gap:13px;width:100%;text-align:left" onclick={() => goto('/trends/backup')}>
					<span class="stat-ic" style="width:40px;height:40px;background:var(--ink)"><Icon name="shield" size={20} color="#fff" /></span>
					<div style="flex:1">
						<div class="h-card" style="font-size:calc(var(--dt-base)*15/17)">Backup &amp; restore</div>
						<div class="txt-sm" style="margin-top:1px">On-device only · keep your data safe</div>
					</div>
					<Icon name="chevR" size={18} color="var(--ink-3)" />
				</button>
			</div>
		{/if}

		<!-- Body weight — always available (independent of session count); local-only -->
		{#if loaded}
			<div class="pad" style="margin-bottom:16px">
				<BodyWeightCard />
			</div>
		{/if}
	</div>
</div>
