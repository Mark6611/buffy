<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { getRepository } from '$lib/db';
	import { newId } from '$lib/id';
	import { workout } from '$lib/stores/workout.svelte';
	import { editor } from '$lib/stores/editor.svelte';
	import { EQUIP_ICON } from '$lib/icons';
	import { mmss, parseMmss, equipLabel } from '$lib/format';
	import type { Exercise, Equipment, TrackingType, LoadType } from '$lib/types';
	import Icon from '$lib/components/Icon.svelte';

	const to = $derived($page.url.searchParams.get('to') ?? 'workout');
	let name = $state('');
	let equipment = $state<Equipment>('dumbbell');
	let trackingType = $state<TrackingType>('weight_reps');
	let perSide = $state(false);
	let restSec = $state(90);
	let muscle = $state('');

	// Kept in sync with the muscle groups already used across the app (the seed
	// catalog + analytics.ts's body-map / push-pull groupings) — not an invented list.
	const MUSCLES = [
		'Chest',
		'Shoulders',
		'Back',
		'Lats',
		'Traps',
		'Biceps',
		'Triceps',
		'Abs',
		'Quads',
		'Hamstrings',
		'Glutes',
		'Calves',
		'Adductors'
	];

	const equips: Equipment[] = ['barbell', 'dumbbell', 'cable', 'machine', 'kettlebell', 'bodyweight', 'cardio'];
	const tts: { v: TrackingType; t: string; s: string }[] = [
		{ v: 'weight_reps', t: 'Weight × reps', s: 'logs weight + reps · auto-progression' },
		{ v: 'time_hold', t: 'Time-hold', s: 'logs duration · progress by adding seconds' },
		{ v: 'cardio', t: 'Cardio', s: 'logs time, incline, speed · log-only' }
	];

	let busy = $state(false);

	async function add() {
		if (!name.trim() || busy) return; // double-tap would create two catalog entries
		busy = true;
		try {
			const loadType: LoadType = perSide
				? 'per_side'
				: equipment === 'bodyweight' && trackingType === 'weight_reps'
					? 'bodyweight'
					: 'total';
			const step = equipment === 'barbell' ? 2.5 : equipment === 'machine' ? 5 : 1;
			const ex: Exercise = {
				id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${newId().slice(0, 4)}`,
				name: name.trim(),
				equipment,
				primaryMuscles: muscle.trim() ? [muscle.trim()] : [],
				secondaryMuscles: [],
				trackingType,
				loadType,
				unilateral: perSide,
				defaultTargetReps: trackingType === 'weight_reps' ? 10 : undefined,
				weightStep: step,
				defaultRestSec: restSec
			};
			await getRepository().upsertExercise(ex);
			if (to === 'tpl' && editor.draft) {
				editor.addExercise(ex);
				goto(`/template/${editor.draft.id}/edit`);
			} else if (workout.active) {
				workout.addExercise(ex);
				goto('/workout');
			} else {
				goto('/'); // saved to the catalog; no active editor/workout to return to
			}
		} finally {
			busy = false;
		}
	}
</script>

<div class="screen">
	<div class="topbar">
		<button class="icon-btn" onclick={() => history.back()} aria-label="Back"><Icon name="back" size={20} /></button>
		<div class="topbar-title">Custom Exercise</div>
		<button class="btn btn-accent btn-sm" style="height:36px;padding:0 16px" onclick={add} disabled={busy}>Add</button>
	</div>
	<div class="screen-body">
		<div class="pad" style="padding-bottom:28px">
			<div class="txt-sm" style="margin:6px 0 6px">NAME</div>
			<div class="search" style="margin-bottom:16px">
				<input style="border:none;background:transparent;outline:none;flex:1;font-size:15px;color:var(--ink)" placeholder="Exercise name" bind:value={name} />
			</div>

			<div class="txt-sm" style="margin-bottom:8px">EQUIPMENT</div>
			<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:16px">
				{#each equips as e (e)}
					<button class="chip {equipment === e ? 'solid' : ''}" onclick={() => (equipment = e)}>
						<Icon name={EQUIP_ICON[e]} size={13} sw={1.8} color={equipment === e ? '#fff' : 'currentColor'} />
						<span class="chip-eq">{equipLabel(e)}</span>
					</button>
				{/each}
			</div>

			<div class="txt-sm" style="margin-bottom:8px">TRACKING TYPE</div>
			<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
				{#each tts as o (o.v)}
					<button
						style="display:flex;align-items:center;gap:12px;padding:13px 14px;border-radius:14px;text-align:left;background:{trackingType === o.v ? 'var(--accent-tint)' : 'var(--surface)'};border:1.5px solid {trackingType === o.v ? 'var(--accent)' : 'var(--line)'}"
						onclick={() => (trackingType = o.v)}
					>
						<span class="setcheck {trackingType === o.v ? 'done' : ''}" style="width:22px;height:22px">
							{#if trackingType === o.v}<Icon name="check" size={13} sw={2.6} color="#fff" />{/if}
						</span>
						<div style="flex:1"><div style="font-weight:600;font-size:14.5px">{o.t}</div><div class="txt-sm">{o.s}</div></div>
					</button>
				{/each}
			</div>

			<div class="card">
				<div class="row" style="justify-content:space-between">
					<div><div style="font-weight:500">Per-side load (kg ×2)</div><div class="txt-sm">dumbbell / unilateral cable</div></div>
					<button class="toggle {perSide ? 'on' : ''}" aria-label="toggle" onclick={() => (perSide = !perSide)}><i></i></button>
				</div>
				<div class="divider"></div>
				<div class="row" style="justify-content:space-between">
					<div style="font-weight:500">Default rest</div>
					<input class="inp" type="text" style="width:64px" value={mmss(restSec)} onchange={(e) => (restSec = parseMmss(e.currentTarget.value))} />
				</div>
				<div class="divider"></div>
				<div class="row" style="justify-content:space-between;position:relative">
					<div style="font-weight:500">Primary muscle</div>
					<div style="display:flex;align-items:center;gap:6px">
						<span class="mono" style="color:{muscle ? 'var(--ink)' : 'var(--ink-3)'}">{muscle || 'Select'}</span>
						<Icon name="chevD" size={16} color="var(--ink-3)" />
					</div>
					<select
						bind:value={muscle}
						aria-label="Primary muscle"
						style="position:absolute;inset:0;width:100%;height:100%;opacity:0;font-size:16px"
					>
						<option value="">No primary muscle</option>
						{#each MUSCLES as m (m)}<option value={m}>{m}</option>{/each}
					</select>
				</div>
			</div>
		</div>
	</div>
</div>
