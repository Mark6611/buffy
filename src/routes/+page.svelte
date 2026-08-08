<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ensureSeeded, getRepository } from '$lib/db';
	import { templateDerived } from '$lib/compute';
	import { durationLabel, mmss, relativeDay, volK } from '$lib/format';
	import { kpis } from '$lib/analytics';
	import { syncWidget } from '$lib/widgetSync';
	import { templateStats } from '$lib/templateStats';
	import { recovery } from '$lib/stores/recovery.svelte';
	import { whoop } from '$lib/stores/whoop.svelte';
	import { workout } from '$lib/stores/workout.svelte';
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
	// Last-performed / times-completed per template — derived from the sessions
	// this page already loads, so the cards cost no extra read. Same helper the
	// home-screen widget uses to pick its "next" template.
	const stats = $derived(templateStats(sessions));

	// Guards a double tap: startFromTemplate awaits settings + two repository reads,
	// so an un-disabled button can start two sessions before the first paints.
	let startingId = $state<string | null>(null);
	let startError = $state('');

	async function startTemplate(id: string) {
		if (startingId) return;
		startError = '';
		startingId = id;
		try {
			const r = await workout.startFromTemplate(id);
			// 'in-progress' means a minimised workout is still live — the store refuses
			// to overwrite it, so resume that instead of reporting a failure.
			if (r.ok || r.reason === 'in-progress') {
				goto('/workout');
				return;
			}
			startError = 'That template is no longer there — it may have been deleted.';
		} finally {
			startingId = null;
		}
	}

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
							style="font-size:calc(var(--dt-base)*11/17);text-transform:capitalize;border:none"
							onclick={() => goto('/settings')}
							aria-label="Readiness {band} {recovery.current.score} — via {recovery.source === 'whoop' ? 'Whoop' : 'Apple Health'}; tap for details"
						>
							{band} · {recovery.current.score}
						</button>
					{/if}
				</div>
				<h1 class="h-app" style="font-size:calc(var(--dt-base)*28/17)">Workouts</h1>
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

		<!-- Leaving /workout now MINIMISES rather than discards, so home has to carry
		     the session: without this bar a workout left running is invisible and
		     unreachable until the next cold launch. The clock is live — the store's
		     interval keeps ticking until finish/cancel. -->
		{#if workout.active}
			<div class="pad" style="margin-bottom:18px">
				<button
					class="card card-pad"
					style="display:flex;align-items:center;gap:13px;width:100%;text-align:left;border-color:var(--accent)"
					onclick={() => goto('/workout')}
				>
					<span class="stat-ic" style="width:38px;height:38px">
						<Icon name="play" size={16} color="var(--accent-ink)" />
					</span>
					<div style="flex:1;min-width:0">
						<div style="font-size:calc(var(--dt-base)*13/17);font-weight:600">Workout in progress</div>
						<div class="txt-sm mono" style="margin-top:2px">
							{workout.session?.title ?? 'Workout'} · {mmss(workout.elapsedSec)}
						</div>
					</div>
					<span class="chip accent" style="font-size:calc(var(--dt-base)*11/17)">
						Resume<Icon name="chevR" size={13} />
					</span>
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
						<div style="font-size:calc(var(--dt-base)*13/17);font-weight:600">This week</div>
						<div class="txt-sm mono" style="margin-top:2px">
							{k.sessionsThisWeek} sessions · {volK(k.volThisWeek)} kg{#if k.streakDays > 0}
								· <span style="color:var(--accent-ink)"><span aria-hidden="true">🔥</span> {k.streakDays}-day streak</span>{/if}
						</div>
					</div>
					<span class="chip" style="font-size:calc(var(--dt-base)*11/17)">Trends<Icon name="chevR" size={13} /></span>
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

		{#if startError}
			<div class="pad txt-sm" style="color:var(--warn);margin-bottom:10px" role="alert">{startError}</div>
		{/if}

		<div class="pad" style="display:flex;flex-direction:column;gap:12px;padding-bottom:28px">
			{#if !loaded}
				<!-- The catalog and templates come from an async onMount, so the header
				     used to paint over nothing. Skeletons of the real card shape, not a
				     spinner: the layout is known before the data arrives. -->
				{#each [0, 1, 2] as i (i)}
					<div class="card card-pad" style="display:flex;gap:13px;align-items:flex-start" aria-hidden="true">
						<div class="skel" style="width:60px;height:60px;border-radius:16px;flex:0 0 auto"></div>
						<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:9px">
							<div class="skel" style="height:16px;width:55%"></div>
							<div class="skel" style="height:12px;width:85%"></div>
							<div class="skel" style="height:12px;width:45%"></div>
						</div>
					</div>
				{/each}
				<span class="sr-only" role="status">Loading templates</span>
			{:else if !templates.length}
				<div class="card card-pad" style="text-align:center">
					<h2 class="h-card" style="margin-bottom:6px">No templates yet</h2>
					<p class="txt-sm" style="margin:0 0 16px">
						A template is a saved workout — its exercises, sets and target weights ready to start in one
						tap. Build one now, or just quick-log a session and save it as a template when you finish.
					</p>
					<Button full onclick={() => goto('/template/new/edit')}>
						<Icon name="plus" size={16} sw={2.2} color="#fff" />New template
					</Button>
					<div style="height:10px"></div>
					<Button variant="bordered" full onclick={() => goto('/quick')}>
						<Icon name="bolt" size={16} />Quick log a workout
					</Button>
				</div>
			{:else}
				{#each templates as t (t.id)}
					{@const d = templateDerived(t, byId)}
					{@const st = stats.get(t.id)}
					<!-- The card was a single <button>; Start cannot nest inside it (a button
					     in a button is invalid HTML and WebKit drops the inner one), and a
					     sibling COLUMN cost ~56px of card width, which wrapped the template
					     name on a 375pt phone. So the navigation becomes a transparent
					     stretched overlay and Start is a chip in the row that already has
					     room. Tapping the card still opens the detail page — the only route
					     to Auto-Progression. -->
					<div class="card card-pad tpl-card">
						<button class="tpl-open" onclick={() => goto(`/template/${t.id}`)}>
							<span class="sr-only">Open {t.name}</span>
						</button>
						<Thumb equip={d.equipment[0] ?? 'dumbbell'} size="lg" />
						<div style="flex:1;min-width:0">
							<div style="display:flex;align-items:center;gap:8px">
								<div class="h-card" style="flex:1">{t.name}</div>
								{#if t.groups.length}
									<span class="chip accent" style="padding:3px 8px;font-size:calc(var(--dt-base)*11/17)">Superset</span>
								{/if}
							</div>
							<div class="ex-meta" style="margin-top:4px;display:flex;gap:12px;flex-wrap:wrap">
								<span><span class="num">{t.exercises.length}</span> exercises</span>
								<span><span class="num">{d.setCount}</span> sets</span>
								<span style="display:inline-flex;align-items:center;gap:4px">
									<Icon name="clock" size={13} color="var(--ink-3)" />{durationLabel(d.estDurationSec)}
								</span>
							</div>
							<!-- Usage, not contents: everything above this line is template-static
							     and identical whether you have run it 50 times or never. -->
							<div class="ex-meta" style="margin-top:3px">
								{#if st?.lastPerformedAt}
									Last trained {relativeDay(st.lastPerformedAt)} · <span class="num">{st.timesCompleted}</span
									>&nbsp;{st.timesCompleted === 1 ? 'time' : 'times'}
								{:else}
									Not trained yet
								{/if}
							</div>
							<div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap;align-items:center">
								{#if !workout.active}
									<!-- Hidden while a workout is running: only one session exists at a
									     time, so the resume bar above is then the unambiguous action. -->
									<button
										class="chip tpl-start"
										aria-label="Start {t.name}"
										disabled={startingId !== null}
										onclick={() => startTemplate(t.id)}
									>
										<Icon name="play" size={11} color="#fff" />Start
									</button>
								{/if}
								{#each d.muscles.slice(0, 2) as m (m)}
									<span class="chip" style="padding:4px 9px;font-size:calc(var(--dt-base)*11.5/17)">{m}</span>
								{/each}
								{#if d.equipment[0]}<EqChip equip={d.equipment[0]} />{/if}
							</div>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</div>
</div>
