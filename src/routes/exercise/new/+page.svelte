<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getRepository } from '$lib/db';
	import { newId } from '$lib/id';
	import { workout } from '$lib/stores/workout.svelte';
	import { editor } from '$lib/stores/editor.svelte';
	import { EQUIP_ICON } from '$lib/icons';
	import { mmss, parseMmss, equipLabel } from '$lib/format';
	import { sameExerciseName } from '$lib/exerciseSearch';
	import type { Exercise, Equipment, TrackingType, LoadType } from '$lib/types';
	import Icon from '$lib/components/Icon.svelte';
	import Button from '$lib/components/Button.svelte';

	const to = $derived($page.url.searchParams.get('to') ?? 'workout');
	// A swap that detours through "Create custom exercise" is still a swap: the picker
	// forwards its slot index so we replace that exercise instead of appending a new
	// one and leaving the old one in place. Same guard as the picker's — Number('') is
	// 0, so a bare `?swap=` (or junk) must fall back to add mode.
	const swapIndex = $derived.by(() => {
		const raw = $page.url.searchParams.get('swap');
		if (raw == null || !/^\d+$/.test(raw)) return null;
		const n = Number(raw);
		return n < workout.exerciseCount ? n : null;
	});
	// prefilled from whatever was typed in the picker's search box, so a no-match
	// search flows straight into creating the thing you were looking for
	let name = $state($page.url.searchParams.get('name') ?? '');
	let equipment = $state<Equipment>('dumbbell');
	let trackingType = $state<TrackingType>('weight_reps');
	let perSide = $state(false);
	let restSec = $state(90);
	let muscle = $state('');
	// cardio only — 'distance' (rower/erg: metres + time) vs 'speed' (treadmill:
	// speed + incline + time). Defaults to distance since that's the new erg support.
	let cardioMetric = $state<'speed' | 'distance'>('distance');

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
		{ v: 'cardio', t: 'Cardio', s: 'rowing, run, bike — distance or speed + time' }
	];

	let busy = $state(false);
	// Read once, only so add() can warn about a name that already exists. Two rows with
	// the same name are indistinguishable in the picker (same thumb, same equipment
	// line), and there is no way to rename or delete a custom exercise afterwards.
	let catalog = $state<Exercise[]>([]);
	let dupe = $state<Exercise | null>(null);

	onMount(async () => {
		catalog = await getRepository().listExercises();
	});

	/** Hand the chosen exercise back to whatever sent us here. */
	function handoff(ex: Exercise) {
		if (to === 'tpl' && editor.draft) {
			editor.addExercise(ex);
			goto(`/template/${editor.draft.id}/edit`);
		} else if (workout.active) {
			if (swapIndex != null) workout.swapExercise(swapIndex, ex);
			else workout.addExercise(ex);
			goto('/workout');
		} else {
			goto('/'); // saved to the catalog; no active editor/workout to return to
		}
	}

	function add() {
		if (!name.trim() || busy) return; // double-tap would create two catalog entries
		// Warn on a duplicate name, don't block it: "Incline Press" on two different
		// machines is a legitimate pair, but an accidental second "Plank" is not.
		const hit = catalog.find((e) => sameExerciseName(e.name, name));
		if (hit) {
			dupe = hit;
			return;
		}
		return create();
	}

	async function create() {
		if (!name.trim() || busy) return;
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
				cardioMetric: trackingType === 'cardio' ? cardioMetric : undefined,
				weightStep: step,
				defaultRestSec: restSec
			};
			await getRepository().upsertExercise(ex);
			handoff(ex);
		} finally {
			busy = false;
		}
	}
</script>

<div class="screen">
	<div class="topbar">
		<button class="icon-btn" onclick={() => history.back()} aria-label="Back"><Icon name="back" size={20} /></button>
		<div class="topbar-title">Custom Exercise</div>
		<!-- while the duplicate-name warning is up the decision lives in that card, so a
		     disabled Add says so rather than looking like a dead tap -->
		<Button size="regular" onclick={add} disabled={busy || dupe !== null}>Add</Button>
	</div>
	<div class="screen-body">
		<div class="pad" style="padding-bottom:28px">
			<div class="txt-sm" style="margin:6px 0 6px">NAME</div>
			<label class="search" style="margin-bottom:16px">
				<input
					style="border:none;background:transparent;flex:1;min-width:0;font-size:calc(var(--dt-base)*15/17);color:var(--ink)"
					placeholder="Exercise name"
					bind:value={name}
					oninput={() => (dupe = null)}
				/>
			</label>

			{#if dupe}
				<!-- A warning, not a block. "Use it" is the right answer most of the time, but
				     same-name variants across two gyms are real, so "Create anyway" stays. -->
				<div class="card card-pad" style="margin-bottom:16px;border-color:var(--warn)">
					<div style="font-weight:600">Your catalog already has “{dupe.name}”</div>
					<div class="txt-sm" style="margin-top:2px">
						{equipLabel(dupe.equipment)} · {dupe.primaryMuscles[0] ?? 'no primary muscle'}
					</div>
					<div style="display:flex;gap:8px;margin-top:12px">
						<Button size="regular" variant="bordered" style="flex:1" onclick={() => dupe && handoff(dupe)}>Use it</Button>
						<Button size="regular" style="flex:1" onclick={create} disabled={busy}>Create anyway</Button>
					</div>
				</div>
			{/if}

			<div class="txt-sm" style="margin-bottom:8px">EQUIPMENT</div>
			<!-- row-gap must clear the chips' +/-7px hit expansion, or stacked rows steal
			     each other's taps; the 7px column gap is unchanged. -->
			<div role="group" aria-label="Equipment" style="display:flex;column-gap:7px;row-gap:16px;flex-wrap:wrap;margin-bottom:16px">
				{#each equips as e (e)}
					<button class="chip {equipment === e ? 'solid' : ''}" aria-pressed={equipment === e} onclick={() => (equipment = e)}>
						<Icon name={EQUIP_ICON[e]} size={13} sw={1.8} color={equipment === e ? '#fff' : 'currentColor'} />
						<span class="chip-eq">{equipLabel(e)}</span>
					</button>
				{/each}
			</div>

			<div class="txt-sm" style="margin-bottom:8px">TRACKING TYPE</div>
			<div role="radiogroup" aria-label="Tracking type" style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
				{#each tts as o (o.v)}
					<button
						style="display:flex;align-items:center;gap:12px;padding:13px 14px;border-radius:14px;text-align:left;background:{trackingType === o.v ? 'var(--accent-tint)' : 'var(--surface)'};border:1.5px solid {trackingType === o.v ? 'var(--accent)' : 'var(--line)'}"
						role="radio"
						aria-checked={trackingType === o.v}
						onclick={() => (trackingType = o.v)}
					>
						<span class="setcheck {trackingType === o.v ? 'done' : ''}" style="width:22px;height:22px" aria-hidden="true">
							{#if trackingType === o.v}<Icon name="check" size={13} sw={2.6} color="#fff" />{/if}
						</span>
						<div style="flex:1"><div style="font-weight:600;font-size:calc(var(--dt-base)*14.5/17)">{o.t}</div><div class="txt-sm">{o.s}</div></div>
					</button>
				{/each}
			</div>

			{#if trackingType === 'cardio'}
				<div class="txt-sm" style="margin-bottom:8px">CARDIO METRIC</div>
				<div role="group" aria-label="Cardio metric" style="display:flex;gap:8px;margin-bottom:16px">
					<button class="chip {cardioMetric === 'distance' ? 'solid' : ''}" style="flex:1;justify-content:center;height:38px" aria-pressed={cardioMetric === 'distance'} onclick={() => (cardioMetric = 'distance')}>Distance + time</button>
					<button class="chip {cardioMetric === 'speed' ? 'solid' : ''}" style="flex:1;justify-content:center;height:38px" aria-pressed={cardioMetric === 'speed'} onclick={() => (cardioMetric = 'speed')}>Speed + incline</button>
				</div>
			{/if}

			<div class="card">
				<div class="row" style="justify-content:space-between">
					<div><div style="font-weight:500">Per-side load (kg ×2)</div><div class="txt-sm">dumbbell / unilateral cable</div></div>
					<button class="toggle {perSide ? 'on' : ''}" role="switch" aria-checked={perSide} aria-label="Per-side load" onclick={() => (perSide = !perSide)}><i></i></button>
				</div>
				<div class="divider"></div>
				<div class="row" style="justify-content:space-between">
					<div style="font-weight:500">Default rest</div>
					<input class="inp" type="text" style="width:64px" aria-label="Default rest" value={mmss(restSec)} onchange={(e) => (restSec = parseMmss(e.currentTarget.value))} />
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
						style="position:absolute;inset:0;width:100%;height:100%;opacity:0;font-size:calc(var(--dt-base)*16/17);-webkit-appearance:none;appearance:none"
					>
						<option value="">No primary muscle</option>
						{#each MUSCLES as m (m)}<option value={m}>{m}</option>{/each}
					</select>
				</div>
			</div>
		</div>
	</div>
</div>
