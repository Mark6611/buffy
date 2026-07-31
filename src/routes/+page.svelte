<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ensureSeeded, getRepository } from '$lib/db';
	import { templateDerived } from '$lib/compute';
	import { durationLabel, volK } from '$lib/format';
	import { kpis } from '$lib/analytics';
	import { syncWidget } from '$lib/widgetSync';
	import { recovery } from '$lib/stores/recovery.svelte';
	import { whoop } from '$lib/stores/whoop.svelte';
	import type { Template, Exercise, WorkoutSession } from '$lib/types';
	import Kpi from '$lib/components/Kpi.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Thumb from '$lib/components/Thumb.svelte';
	import EqChip from '$lib/components/EqChip.svelte';
	import Button from '$lib/components/Button.svelte';

	let templates = $state<Template[]>([]);
	let sessions = $state<WorkoutSession[]>([]);
	let byId = $state<Map<string, Exercise>>(new Map());
	let loaded = $state(false);

	onMount(async () => {
		await ensureSeeded();
		const repo = getRepository();
		const [t, ex, s] = await Promise.all([repo.listTemplates(), repo.listExercises(), repo.listSessions()]);
		templates = t;
		sessions = s;
		byId = new Map(ex.map((e) => [e.id, e]));
		loaded = true;
		void syncWidget(s, t); // keep the home-screen widget fresh (native no-op on web)
	});

	const k = $derived(kpis(sessions));

	const dateLabel = new Date().toLocaleDateString('en-US', {
		weekday: 'long',
		day: 'numeric',
		month: 'short'
	});

	// NB: guard computed in script, not inline in {#if}: this Svelte version's
	// dev transform drops the parentheses around `a && (b != null || c != null)`
	// when rewriting != into $.equals, flattening precedence and dereferencing
	// null — the compiled page crashed on first paint. (Compiler bug; avoid the
	// pattern rather than fight it.)
	const whoopToday = $derived.by(() => {
		const t = whoop.today;
		if (!t) return null;
		// pure || chain of typeof checks — no &&/|| precedence for the transform to lose
		const hasAny =
			typeof t.recoveryScore === 'number' || typeof t.dayStrain === 'number' || typeof t.sleepHours === 'number';
		return hasAny ? t : null;
	});

	function hhmmFromHours(h: number): string {
		const totalMin = Math.round(h * 60);
		return `${Math.floor(totalMin / 60)}:${String(totalMin % 60).padStart(2, '0')}`;
	}
</script>

<div class="screen">
	<div class="screen-body">
		<div style="display:flex;align-items:flex-end;justify-content:space-between;padding:8px 20px 14px">
			<div>
				<div class="txt-sm" style="margin-bottom:2px;display:flex;align-items:center;gap:8px">
					{dateLabel}
					{#if recovery.current}
						{@const band = recovery.current.band}
						<button
							class="chip {band === 'fresh' ? 'accent' : band === 'strained' ? 'warn' : ''}"
							style="font-size:11px;text-transform:capitalize;border:none"
							onclick={() => goto('/settings')}
							aria-label="Readiness {band} {recovery.current.score} — via {recovery.source === 'whoop' ? 'Whoop' : 'Apple Health'}; tap for details"
						>
							{band} · {recovery.current.score}
						</button>
					{/if}
				</div>
				<h1 class="h-app" style="font-size:28px">Workouts</h1>
			</div>
			<div style="display:flex;gap:8px">
				<button class="icon-btn" onclick={() => goto('/trends')} aria-label="Trends">
					<Icon name="chart" size={18} />
				</button>
				<button class="icon-btn" onclick={() => goto('/history')} aria-label="History">
					<Icon name="cal" size={18} />
				</button>
				<button class="icon-btn" onclick={() => goto('/settings')} aria-label="Settings">
					<Icon name="cog" size={18} />
				</button>
			</div>
		</div>

		{#if whoopToday}
			{@const t = whoopToday}
			<div class="pad" style="margin-bottom:18px">
				<button
					class="card card-pad"
					style="display:flex;justify-content:space-between;width:100%"
					onclick={() => goto('/settings')}
					aria-label="Today's Whoop stats — tap for details"
				>
					<Kpi v={t.recoveryScore != null ? `${t.recoveryScore}%` : '—'} l="recovery" mono />
					<span style="width:1px;background:var(--line)"></span>
					<Kpi v={t.dayStrain != null ? t.dayStrain.toFixed(1) : '—'} l="day strain" mono />
					<span style="width:1px;background:var(--line)"></span>
					<Kpi
						v={t.sleepHours != null ? hhmmFromHours(t.sleepHours) : '—'}
						l={t.sleepPerformancePct != null ? `sleep · ${t.sleepPerformancePct}%` : 'sleep'}
						mono
					/>
				</button>
			</div>
		{/if}

		<div class="pad" style="margin-bottom:18px">
			<Button
				variant="dark"
				full
				style="justify-content:space-between"
				onclick={() => goto('/quick')}
			>
				<span style="display:flex;align-items:center;gap:9px">
					<Icon name="bolt" size={18} color="#fff" />Quick log a workout
				</span>
				<Icon name="arrowR" size={18} color="#fff" />
			</Button>
		</div>

		{#if sessions.length}
			<div class="pad" style="margin-bottom:18px">
				<button
					class="card card-pad"
					style="display:flex;align-items:center;gap:13px;width:100%;text-align:left"
					onclick={() => goto('/trends')}
				>
					<span class="stat-ic" style="width:38px;height:38px;background:var(--accent-tint)">
						<Icon name="trend" size={19} color="var(--accent-ink)" />
					</span>
					<div style="flex:1;min-width:0">
						<div style="font-size:13px;font-weight:600">This week</div>
						<div class="txt-sm mono" style="margin-top:2px">
							{k.sessionsThisWeek} sessions · {volK(k.volThisWeek)} kg{#if k.streakDays > 0}
								· <span style="color:var(--accent-ink)"><span aria-hidden="true">🔥</span> {k.streakDays}-day streak</span>{/if}
						</div>
					</div>
					<span class="chip" style="font-size:11px">Trends<Icon name="chevR" size={13} /></span>
				</button>
			</div>
		{/if}

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
