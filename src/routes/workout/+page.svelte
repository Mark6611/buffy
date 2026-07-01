<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { workout } from '$lib/stores/workout.svelte';
	import { mmss, kg, parseMmss } from '$lib/format';
	import { platesPerSide, formatPerSide } from '$lib/plates';
	import type { LoggedSet } from '$lib/types';
	import Icon from '$lib/components/Icon.svelte';
	import Thumb from '$lib/components/Thumb.svelte';
	import RestBanner from '$lib/components/RestBanner.svelte';

	onMount(() => {
		if (!workout.active) goto('/');
	});

	function numOrUndef(v: string): number | undefined {
		const n = parseFloat(v);
		return Number.isFinite(n) ? n : undefined;
	}

	async function finish() {
		const id = await workout.finish();
		goto(id ? `/history/${id}` : '/');
	}
	function close() {
		if (confirm('Discard this workout? Nothing will be saved.')) {
			workout.cancel();
			goto('/');
		}
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
