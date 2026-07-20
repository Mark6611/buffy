<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { editor } from '$lib/stores/editor.svelte';
	import { mmss, parseMmss } from '$lib/format';
	import Icon from '$lib/components/Icon.svelte';
	import Button from '$lib/components/Button.svelte';
	import Thumb from '$lib/components/Thumb.svelte';

	const id = $derived($page.params.id ?? '');
	onMount(() => editor.load(id));
	const draft = $derived(editor.draft);

	function numOrUndef(v: string): number | undefined {
		const n = parseFloat(v);
		return Number.isFinite(n) ? n : undefined;
	}
	async function save() {
		const tid = await editor.save();
		if (tid) goto(`/template/${tid}`);
	}
</script>

<div class="screen">
	<div class="topbar">
		<button class="icon-btn" onclick={() => history.back()} aria-label="Back"><Icon name="back" size={20} /></button>
		<div class="topbar-title">{id === 'new' ? 'New Template' : 'Edit Template'}</div>
		<Button size="regular" onclick={save}>Save</Button>
	</div>

	<div class="screen-body">
		{#if draft}
			<div class="pad" style="padding-bottom:120px">
				<div class="txt-sm" style="margin-bottom:6px">NAME</div>
				<input
					class="h-app"
					style="font-size:24px;width:100%;border:none;border-bottom:2px solid var(--accent);background:transparent;outline:none;padding-bottom:8px;margin-bottom:18px"
					bind:value={draft.name}
				/>

				<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
					<span class="h-sec">Exercises · {draft.exercises.length}</span>
					{#if editor.selection.size > 0}
						<span class="chip accent" style="font-size:11px">{editor.selection.size} selected</span>
					{/if}
				</div>

				<div style="display:flex;flex-direction:column;gap:10px">
					{#each draft.exercises as te, i (i)}
						{@const ex = editor.meta[te.exerciseId]}
						{@const tt = ex?.trackingType ?? 'weight_reps'}
						{@const bw = ex?.loadType === 'bodyweight'}
						{@const perSide = ex?.loadType === 'per_side'}
						{@const cardioDist = ex?.cardioMetric === 'distance'}
						<div class="card card-pad" style={te.groupId ? 'border-color:var(--accent)' : ''}>
							<div style="display:flex;align-items:center;gap:10px">
								<button class="setcheck {editor.selection.has(i) ? 'done' : ''}" style="width:22px;height:22px" onclick={() => editor.toggleSelect(i)} aria-label="select">
									{#if editor.selection.has(i)}<Icon name="check" size={13} sw={2.6} color="#fff" />{/if}
								</button>
								<Thumb equip={ex?.equipment ?? 'dumbbell'} size="sm" />
								<div style="flex:1;min-width:0">
									<div class="ex-name" style="font-size:14px">{ex?.name}</div>
									{#if te.groupId}
										<button class="chip accent chip-inline" style="font-size:10px;padding:2px 7px;margin-top:3px" onclick={() => editor.ungroup(te.groupId!)}>
											<Icon name="link" size={10} color="var(--accent-ink)" sw={2.2} />Superset · ungroup
										</button>
									{/if}
								</div>
								<button class="icon-btn ghost" onclick={() => editor.removeExercise(i)} aria-label="remove"><Icon name="trash" size={17} color="var(--ink-3)" /></button>
							</div>

							<table class="settable" style="margin-top:8px">
								<thead>
									{#if tt === 'cardio'}
										{#if cardioDist}
											<tr><th class="l" style="width:34px">Set</th><th>Time</th><th>Meters</th></tr>
										{:else}
											<tr><th class="l" style="width:34px">Set</th><th>Time</th><th>Incl</th><th>Spd</th></tr>
										{/if}
									{:else if tt === 'time_hold'}
										<tr><th class="l" style="width:34px">Set</th><th>Hold</th><th>Rest</th></tr>
									{:else}
										<tr><th class="l" style="width:34px">Set</th><th>Reps</th>{#if !bw}<th>kg{#if perSide}<span class="col-x2"> ×2</span>{/if}</th>{/if}<th>Rest</th></tr>
									{/if}
								</thead>
								<tbody>
									{#each te.plannedSets as ps, s (s)}
										<tr>
											<td class="l muted">{s + 1}</td>
											{#if tt === 'cardio'}
												{#if cardioDist}
													<td><input class="inp" type="text" value={mmss(ps.targetTimeSec ?? 0)} onchange={(e) => (ps.targetTimeSec = parseMmss(e.currentTarget.value))} /></td>
													<td><input class="inp" type="number" inputmode="numeric" value={ps.targetDistanceMeters ?? ''} oninput={(e) => (ps.targetDistanceMeters = numOrUndef(e.currentTarget.value))} /></td>
												{:else}
													<td><input class="inp" type="text" value={mmss(ps.targetTimeSec ?? 0)} onchange={(e) => (ps.targetTimeSec = parseMmss(e.currentTarget.value))} /></td>
													<td><input class="inp" type="number" value={ps.targetIncline ?? ''} oninput={(e) => (ps.targetIncline = numOrUndef(e.currentTarget.value))} /></td>
													<td><input class="inp" type="number" value={ps.targetSpeed ?? ''} oninput={(e) => (ps.targetSpeed = numOrUndef(e.currentTarget.value))} /></td>
												{/if}
											{:else if tt === 'time_hold'}
												<td><input class="inp" type="text" value={mmss(ps.targetDurationSec ?? 0)} onchange={(e) => (ps.targetDurationSec = parseMmss(e.currentTarget.value))} /></td>
												<td><input class="inp" type="text" value={mmss(ps.targetRestSec ?? 0)} onchange={(e) => (ps.targetRestSec = parseMmss(e.currentTarget.value))} /></td>
											{:else}
												<td><input class="inp" type="number" value={ps.targetReps ?? ''} oninput={(e) => (ps.targetReps = numOrUndef(e.currentTarget.value))} /></td>
												{#if !bw}<td><input class="inp" type="number" step="0.5" value={ps.targetWeight ?? ''} oninput={(e) => (ps.targetWeight = numOrUndef(e.currentTarget.value))} /></td>{/if}
												<td><input class="inp" type="text" value={mmss(ps.targetRestSec ?? 0)} onchange={(e) => (ps.targetRestSec = parseMmss(e.currentTarget.value))} /></td>
											{/if}
										</tr>
									{/each}
								</tbody>
							</table>
							<div style="display:flex;gap:8px;margin-top:8px">
								<Button size="medium" variant="bordered" style="flex:1" onclick={() => editor.addSet(i)}><Icon name="plus" size={15} />Add set</Button>
								<Button size="medium" variant="bordered" style="flex:1" onclick={() => editor.removeSet(i)}><Icon name="minus" size={15} />Remove</Button>
							</div>
						</div>
					{/each}
				</div>

				<Button variant="bordered" full style="margin-top:14px" onclick={() => { editor.keepDraft = true; goto('/picker?to=tpl'); }}>
					<Icon name="plus" size={18} />Add exercise
				</Button>
			</div>
		{/if}
	</div>

	{#if editor.selection.size >= 2}
		<div class="actionbar">
			<Button style="flex:1" onclick={() => editor.groupSelected()}>
				<Icon name="link" size={18} color="#fff" />Group as superset · {editor.selection.size}
			</Button>
		</div>
	{/if}
</div>
