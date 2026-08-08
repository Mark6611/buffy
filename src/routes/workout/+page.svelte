<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { workout } from '$lib/stores/workout.svelte';
	import { mmss, kg, parseMmss } from '$lib/format';
	import { cardioSplit500Sec } from '$lib/compute';
	import Button from '$lib/components/Button.svelte';
	import { platesPerSide, formatPerSide } from '$lib/plates';
	import { autoBackup } from '$lib/data';
	import { captureSessionIntensity } from '$lib/sessionIntensity';
	import { syncWidget } from '$lib/widgetSync';
	import { getRepository } from '$lib/db';
	import { settings } from '$lib/stores/settings.svelte';
	import { writeHealthWorkout } from '$lib/native';
	import { runCloudSync } from '$lib/cloudSync';
	import { applyFullSync, applyWeightsOnlySync, buildTemplateFromSession } from '$lib/templateSync';
	import type { LoggedExercise, LoggedSet, Template, WorkoutSession } from '$lib/types';
	import Icon from '$lib/components/Icon.svelte';
	import { haptic } from '$lib/native';
	import Thumb from '$lib/components/Thumb.svelte';
	import RestBanner from '$lib/components/RestBanner.svelte';
	import SwipeActions from '$lib/components/SwipeActions.svelte';

	onMount(() => {
		if (!workout.active) goto('/');
	});

	function numOrUndef(v: string): number | undefined {
		const n = parseFloat(v);
		return Number.isFinite(n) ? n : undefined;
	}

	// After finishing, offer to sync the result back into its source template (or,
	// for a quick-log session, offer to save it as a brand-new one) before leaving.
	let syncPrompt = $state<{
		savedId: string;
		session: WorkoutSession;
		template: Template | null;
		diff: TemplateDiff | null;
	} | null>(null);
	let newTemplateName = $state('');
	let syncBusy = $state(false);
	let syncError = $state('');
	let finishError = $state('');
	let finishing = $state(false);

	// What "Update whole template" would actually do to the template, counted against
	// what was logged. Pairs by occurrence order for the same reason applyWeightsOnlySync
	// does — the same exercise can legitimately appear twice in one session.
	type TemplateDiff = { droppedExercises: number; droppedSets: number; changed: boolean };
	function templateDiff(tpl: Template, s: WorkoutSession): TemplateDiff {
		const queues = new Map<string, LoggedExercise[]>();
		for (const le of s.exercises) {
			const q = queues.get(le.exerciseId);
			if (q) q.push(le);
			else queues.set(le.exerciseId, [le]);
		}
		let droppedExercises = 0;
		let droppedSets = 0;
		let changed = false;
		for (const tex of tpl.exercises) {
			const le = queues.get(tex.exerciseId)?.shift();
			if (!le) {
				droppedExercises++;
				droppedSets += tex.plannedSets.length;
				changed = true;
				continue;
			}
			if (le.sets.length !== tex.plannedSets.length) {
				droppedSets += Math.max(0, tex.plannedSets.length - le.sets.length);
				changed = true;
			}
			tex.plannedSets.forEach((ps, i) => {
				const set = le.sets[i];
				if (!set) return;
				if (
					(set.reps ?? ps.targetReps) !== ps.targetReps ||
					(set.weight ?? ps.targetWeight) !== ps.targetWeight ||
					(set.durationSec ?? ps.targetDurationSec) !== ps.targetDurationSec ||
					(set.timeSec ?? ps.targetTimeSec) !== ps.targetTimeSec ||
					(set.incline ?? ps.targetIncline) !== ps.targetIncline ||
					(set.speed ?? ps.targetSpeed) !== ps.targetSpeed ||
					(set.distanceMeters ?? ps.targetDistanceMeters) !== ps.targetDistanceMeters
				)
					changed = true;
			});
		}
		// anything logged that the template doesn't have (added mid-workout) is a change too
		for (const q of queues.values()) if (q.length) changed = true;
		return { droppedExercises, droppedSets, changed };
	}
	const fullSyncCost = $derived.by(() => {
		const d = syncPrompt?.diff;
		if (!d || (!d.droppedExercises && !d.droppedSets)) return '';
		const ex = d.droppedExercises === 1 ? '1 exercise' : `${d.droppedExercises} exercises`;
		const sets = d.droppedSets === 1 ? '1 set' : `${d.droppedSets} sets`;
		return d.droppedExercises
			? `Removes ${ex} (${sets}) you skipped today.`
			: `Removes ${sets} you skipped today.`;
	});

	async function finish() {
		if (finishing) return; // double-tap would double-write Health + race two syncs
		finishing = true;
		finishError = '';
		try {
			const wasTemplateSourced = workout.session?.sourceTemplateId ?? null;
			const res = await workout.finish();
			if (res.status === 'empty') {
				goto('/');
				return;
			}
			if (res.status === 'nothing-logged') {
				// The store deliberately kept the workout alive here: discarding it also
				// takes the session note and the resume snapshot, and Finish used to do
				// that with no message at all.
				if (confirm('No sets are marked complete, so nothing will be saved. Discard this workout?')) {
					workout.cancel();
					goto('/');
				}
				return;
			}
			const id = res.id;
			void autoBackup(); // native: snapshot all data to Documents after a logged workout
			void refreshWidget();
			if (!settings.loaded) await settings.load(); // e.g. quick-log never loads settings itself
			const repo = getRepository();
			const saved = await repo.getSession(id);
			// Best-effort HR-intensity + calorie capture; often partial right at finish
			// because the wearable hasn't synced to Health yet — history backfills later.
			// The Health write follows the capture so the calorie estimate (when it
			// already exists) rides on the workout record and closes the Move ring.
			if (saved) {
				// give the capture a short window to produce a calorie estimate for the
				// Health record, but never let a slow network (Whoop fetch) delay or —
				// if the app is backgrounded meanwhile — lose the Health write entirely
				const capture = captureSessionIntensity(saved);
				if (settings.current.writeToHealth) {
					void Promise.race([capture, new Promise<null>((r) => setTimeout(() => r(null), 8000))]).then((updated) =>
						writeHealthAfterFinish(id, (updated ?? saved).calories?.kcal)
					);
				}
			} else if (settings.current.writeToHealth) {
				void writeHealthAfterFinish(id);
			}
			if (!saved) {
				triggerCloudSync();
				goto(`/history/${id}`);
				return;
			}
			if (wasTemplateSourced) {
				const tpl = await repo.getTemplate(wasTemplateSourced);
				if (!tpl) {
					triggerCloudSync();
					goto(`/history/${id}`); // source template was deleted mid-workout — nothing to sync
					return;
				}
				const diff = templateDiff(tpl, saved);
				if (!diff.changed) {
					// You did exactly what the template says — there is nothing to offer,
					// and asking anyway is what turned this sheet into a nag.
					triggerCloudSync();
					goto(`/history/${id}`);
					return;
				}
				syncPrompt = { savedId: id, session: saved, template: tpl, diff };
			} else {
				newTemplateName = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
				syncPrompt = { savedId: id, session: saved, template: null, diff: null };
			}
		} catch (e) {
			// The store builds the finished record on a snapshot and only clears the live
			// session AFTER the write resolves, so a failure here (storage full / WebKit
			// eviction) has cost the user nothing — say so, because the only other signal
			// is the Finish button quietly re-enabling.
			finishError =
				e instanceof Error && e.message
					? `Couldn't save this workout: ${e.message}. Nothing was lost — try Finish again.`
					: "Couldn't save this workout. Nothing was lost — try Finish again.";
		} finally {
			finishing = false;
		}
	}
	// Deferred until the template-sync choice resolves: one sync pass then carries
	// both the session and the template decision (and an unguarded pull mid-prompt
	// can't clobber the just-made choice).
	function triggerCloudSync() {
		if (settings.current.cloudSyncEnabled) void runCloudSync();
	}
	async function refreshWidget() {
		const repo = getRepository();
		const [sessions, templates] = await Promise.all([repo.listSessions(), repo.listTemplates()]);
		await syncWidget(sessions, templates);
	}
	async function writeHealthAfterFinish(id: string, kcal?: number) {
		const s = await getRepository().getSession(id);
		if (s?.endedAt) await writeHealthWorkout(Date.parse(s.startedAt), Date.parse(s.endedAt), kcal ?? s.calories?.kcal);
	}
	function finalizeSync() {
		if (!syncPrompt) return; // a queued double-fire (button + backdrop) must sync/navigate once
		const id = syncPrompt.savedId;
		syncPrompt = null;
		triggerCloudSync();
		goto(`/history/${id}`);
	}
	async function chooseTemplateSync(mode: 'full' | 'weightsOnly' | 'none') {
		if (syncPrompt?.template && mode !== 'none') {
			syncBusy = true;
			syncError = '';
			try {
				const repo = getRepository();
				// snapshot: syncPrompt is $state, so its nested objects are reactive
				// proxies — IndexedDB can't structured-clone those for upsertTemplate.
				const template = $state.snapshot(syncPrompt.template);
				const session = $state.snapshot(syncPrompt.session);
				const updated =
					mode === 'full'
						? applyFullSync(template, session, new Map((await repo.listExercises()).map((e) => [e.id, e])))
						: applyWeightsOnlySync(template, session);
				await repo.upsertTemplate(updated);
			} catch (e) {
				syncError = e instanceof Error ? e.message : 'Could not update the template.';
				return; // sheet stays up (and dismissable) for retry
			} finally {
				syncBusy = false;
			}
		}
		finalizeSync();
	}
	async function saveAsNewTemplate(save: boolean) {
		if (save && syncPrompt) {
			syncBusy = true;
			syncError = '';
			try {
				const repo = getRepository();
				const exById = new Map((await repo.listExercises()).map((e) => [e.id, e]));
				const session = $state.snapshot(syncPrompt.session);
				await repo.upsertTemplate(buildTemplateFromSession(session, exById, newTemplateName.trim() || 'New Template'));
			} catch (e) {
				syncError = e instanceof Error ? e.message : 'Could not save the template.';
				return; // sheet stays up (and dismissable) for retry
			} finally {
				syncBusy = false;
			}
		}
		finalizeSync();
	}
	// the sync sheet is modal — move focus into it so VoiceOver/keyboard land inside
	function autofocusNode(n: HTMLElement) {
		n.focus();
	}
	// The chevron MINIMIZES: the workout keeps running (the store is a singleton and
	// its resume snapshot stays current), and home shows a resume bar to get back in.
	// Discarding is a separate, explicit action at the bottom of the screen — it used
	// to be what this button did, which is why the glyph promised something else.
	function minimize() {
		goto('/');
	}
	function discardWorkout() {
		if (confirm('Discard this workout? Nothing will be saved.')) {
			workout.cancel();
			goto('/');
		}
	}
	// Removing the last set is normally the intended one-tap "abandon this set", so it
	// stays unconfirmed — but once that set is LOGGED it's real data with no undo, and
	// the exercise-level delete right next to it has confirmed all along.
	function removeLastSet(exIndex: number) {
		const le = workout.session?.exercises[exIndex];
		const last = le?.sets.at(-1);
		const name = workout.meta[exIndex]?.name ?? 'this exercise';
		if (last?.completed && !confirm(`Delete the logged set ${le!.sets.length} of ${name}?`)) return;
		workout.removeSet(exIndex);
	}
	function removeExercise(exIndex: number) {
		const le = workout.session?.exercises[exIndex];
		const hasLoggedSets = !!le?.sets.some((s) => s.completed);
		const name = workout.meta[exIndex]?.name ?? 'this exercise';
		const msg = hasLoggedSets
			? `Remove ${name}? Sets you've already logged for it will be lost.`
			: `Remove ${name} from this workout?`;
		if (confirm(msg)) workout.removeExercise(exIndex);
	}
	function swapExercise(exIndex: number) {
		const le = workout.session?.exercises[exIndex];
		const hasLoggedSets = !!le?.sets.some((s) => s.completed);
		const name = workout.meta[exIndex]?.name ?? 'this exercise';
		if (hasLoggedSets && !confirm(`Swap ${name}? Sets you've already logged for it will be lost.`)) return;
		goto(`/picker?to=workout&swap=${exIndex}`);
	}

	// Swipeable exercise-header rows: opening one closes any other that's open.
	function moveExercise(exIndex: number, dir: -1 | 1) {
		workout.moveExercise(exIndex, dir);
		// indices just changed under every open row — snap them all shut
		swipeRefs.forEach((r) => r?.close());
	}

	let swipeRefs: (SwipeActions | undefined)[] = $state([]);
	// mirrors each row's drawer state so the overflow trigger can carry aria-expanded
	let swipeOpen: boolean[] = $state([]);
	function closeOtherSwipes(exIndex: number) {
		swipeRefs.forEach((r, i) => {
			if (i !== exIndex) r?.close();
		});
	}

	// Swipe-left-to-delete on SET rows. Rows are real <tr>s inside the sets
	// table, so the div-based SwipeActions can't wrap them — instead this is the
	// iOS full-swipe pattern: drag past the threshold and release to delete (the
	// row tints warn once armed). One finger ⇒ one shared drag state. Drags never
	// start on inputs/buttons, and vertical intent hands the gesture to scrolling.
	const SET_DELETE_AT = -80;
	let setDrag = $state<{ ex: number; set: number; x: number; armed: boolean } | null>(null);
	let setDragStart: { x: number; y: number; intent: boolean } | null = null;
	function setRowPointerDown(ex: number, set: number, e: PointerEvent) {
		if ((e.target as HTMLElement).closest('input, button')) return;
		setDragStart = { x: e.clientX, y: e.clientY, intent: false };
		setDrag = { ex, set, x: 0, armed: false };
	}
	function setRowPointerMove(e: PointerEvent) {
		if (!setDrag || !setDragStart) return;
		const dx = e.clientX - setDragStart.x;
		const dy = e.clientY - setDragStart.y;
		if (!setDragStart.intent) {
			if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
				// vertical — this is a scroll, not a swipe
				setDrag = null;
				setDragStart = null;
				return;
			}
			if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
			setDragStart.intent = true;
			try {
				(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
			} catch {
				/* capture unsupported */
			}
		}
		const x = Math.max(-120, Math.min(0, dx));
		setDrag = { ...setDrag, x, armed: x < SET_DELETE_AT };
	}
	function setRowPointerUp(e: PointerEvent) {
		if (!setDrag) return;
		const el = e.currentTarget as HTMLElement;
		if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
		if (setDragStart?.intent && setDrag.x < SET_DELETE_AT) {
			const { ex, set } = setDrag;
			// same rule as the Remove button: a logged set is data, not a plan
			const target = workout.session?.exercises[ex]?.sets[set];
			if (!target?.completed || confirm(`Delete logged set ${set + 1}?`)) {
				void haptic('light');
				workout.removeSetAt(ex, set);
			}
		}
		setDrag = null;
		setDragStart = null;
	}
	function setRowPointerCancel(e: PointerEvent) {
		const el = e.currentTarget as HTMLElement;
		if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
		setDrag = null;
		setDragStart = null;
	}
	// Tapping a weight to change it shouldn't mean backspacing the old number first.
	// select() is spec'd only for text-ish inputs, so on engines that no-op it for
	// type="number" this is simply inert — never a hard dependency.
	function selectOnFocus(e: FocusEvent & { currentTarget: HTMLInputElement }) {
		try {
			e.currentTarget.select();
		} catch {
			/* not a selectable input type in this engine */
		}
	}
	// What a weight cell held when it was focused — propagateWeight needs it to tell
	// "this exercise is all at one load" from a deliberate pyramid or drop set.
	let weightBefore: number | undefined;

	function setRowStyle(ex: number, set: number): string {
		const d = setDrag && setDrag.ex === ex && setDrag.set === set ? setDrag : null;
		const x = d?.x ?? 0;
		return (
			`touch-action:pan-y;transform:translateX(${x}px);` +
			`transition:${d && setDragStart?.intent ? 'none' : 'transform 0.18s ease, background-color 0.18s ease'};` +
			(d?.armed ? 'background-color:var(--warn-tint);' : '')
		);
	}
</script>

{#snippet restCell(exIndex: number, s: number, set: LoggedSet)}
	<td class={set.completed ? '' : 'muted'}>
		<!-- every pending set gets its own seed input, set 1 included: its rest is the
		     one the timer uses most, and toggleSet reads plannedRest[ex][0] for it -->
		{#if set.completed}{set.restTakenSec != null ? mmss(set.restTakenSec) : '—'}{:else}<input class="inp rest-inp" type="text" aria-label="Set {s + 1} planned rest" value={mmss(workout.plannedRest[exIndex]?.[s] ?? 0)} onchange={(e) => workout.setPlannedRest(exIndex, s, parseMmss(e.currentTarget.value))} />{/if}
	</td>
{/snippet}

{#if workout.session}
	<div class="screen">
		<div class="topbar" style="padding-bottom:6px">
			<button class="icon-btn" onclick={minimize} aria-label="Minimize workout — it keeps running" title="Minimize — the workout keeps running">
				<Icon name="chevD" size={20} />
			</button>
			<div style="text-align:center">
				<div style="font-size:calc(var(--dt-base)*15/17);font-weight:600;letter-spacing:-0.2px">{workout.session.title}</div>
				<div class="mono txt-sm" style="margin-top:1px">
					{mmss(workout.elapsedSec)} · {workout.exerciseCount
						? `${workout.activeEx + 1}/${workout.exerciseCount}`
						: 'no exercises'}
					<!-- the rest banner lives inside one exercise block and scrolls away with
					     it; the topbar is outside the scroller, so the countdown stays reachable -->
					{#if workout.restForSet}<span style="color:{workout.restOver ? 'var(--warn)' : 'var(--accent-ink)'};font-weight:600"> · {mmss(workout.restRemaining)}</span>{/if}
				</div>
			</div>
			<Button size="regular" onclick={finish} disabled={finishing}>Finish</Button>
		</div>
		{#if finishError}
			<div class="txt-sm" style="padding:0 16px 8px;color:var(--warn)">{finishError}</div>
		{/if}

		<div class="screen-body">
			<div class="pad" style="padding-bottom:40px">
				<!-- keyed by object identity: the store splices on delete, so an index key
				     would hand row N's SwipeActions (open/drag state) to the row shifting
				     into slot N; swapExercise replaces the object → correctly a fresh row -->
				{#each workout.session.exercises as le, exIndex (le)}
					{@const ex = workout.meta[exIndex]}
					{@const bw = ex?.loadType === 'bodyweight'}
					{@const perSide = ex?.loadType === 'per_side'}
					{@const tt = ex?.trackingType ?? 'weight_reps'}
					{@const cardioDist = ex?.cardioMetric === 'distance'}
					{@const sg = workout.suggestions[le.exerciseId]}
					<div class="ex-block">
						<SwipeActions bind:this={swipeRefs[exIndex]} bind:open={swipeOpen[exIndex]} actionsWidth={240} onOpen={() => closeOtherSwipes(exIndex)}>
							{#snippet children()}
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
									<!-- The move/swap/delete drawer is otherwise gesture-only, i.e. absent for
									     VoiceOver, Switch Control and keyboard users. stopPropagation keeps this
									     tap out of the drag machinery underneath. -->
									<button
										class="icon-btn ghost"
										aria-label="Actions for {ex?.name}"
										aria-expanded={swipeOpen[exIndex] ?? false}
										onpointerdown={(e) => e.stopPropagation()}
										onclick={() => swipeRefs[exIndex]?.toggle()}
									>
										<Icon name="more" size={18} color="var(--ink-3)" />
									</button>
								</div>
							{/snippet}
							{#snippet actions()}
								<button class="swipe-btn" style="background:var(--ink-3);width:44px;font-size:calc(var(--dt-base)*16/17)" aria-label="Move up" onclick={() => moveExercise(exIndex, -1)}>↑</button>
								<button class="swipe-btn" style="background:var(--ink-3);width:44px;font-size:calc(var(--dt-base)*16/17)" aria-label="Move down" onclick={() => moveExercise(exIndex, 1)}>↓</button>
								<button class="swipe-btn" style="background:var(--accent)" onclick={() => swapExercise(exIndex)}>
									<Icon name="swap" size={18} color="#fff" sw={2.2} />
									<span>Swap</span>
								</button>
								<button class="swipe-btn" style="background:var(--warn)" onclick={() => removeExercise(exIndex)}>
									<Icon name="trash" size={18} color="#fff" sw={2.2} />
									<span>Delete</span>
								</button>
							{/snippet}
						</SwipeActions>

						<table class="settable editable" aria-label="{ex?.name} sets">
							<thead>
								{#if tt === 'cardio'}
									{#if cardioDist}
										<tr><th scope="col" class="c" style="width:34px"></th><th scope="col" class="l" style="width:34px">Set</th><th scope="col">Time</th><th scope="col">Meters</th><th scope="col">/500m</th></tr>
									{:else}
										<tr><th scope="col" class="c" style="width:34px"></th><th scope="col" class="l" style="width:34px">Set</th><th scope="col">Time</th><th scope="col">Incline</th><th scope="col">Speed</th></tr>
									{/if}
								{:else if tt === 'time_hold'}
									<tr><th scope="col" class="c" style="width:34px"></th><th scope="col" class="l" style="width:38px">Set</th><th scope="col">Rest</th><th scope="col">Hold</th></tr>
								{:else}
									<tr><th scope="col" class="c" style="width:34px"></th><th scope="col" class="l" style="width:38px">Set</th><th scope="col">Rest</th><th scope="col">Reps</th>{#if !bw}<th scope="col" style="width:{perSide ? 74 : 58}px">kg{#if perSide}<span class="col-x2"> ×2</span>{/if}</th>{/if}{#if settings.current.trackRpe}<th scope="col" style="width:44px">RPE</th>{/if}</tr>
								{/if}
							</thead>
							<tbody>
								{#each le.sets as set, s (s)}
									{@const isActive = exIndex === workout.activeEx && s === workout.activeSet && !set.completed}
									<tr
										class={set.completed ? 'row-done' : isActive ? 'row-active' : ''}
										style={setRowStyle(exIndex, s)}
										onpointerdown={(e) => setRowPointerDown(exIndex, s, e)}
										onpointermove={setRowPointerMove}
										onpointerup={setRowPointerUp}
										onpointercancel={setRowPointerCancel}
									>
										<td class="c">
											<button class="setcheck {set.completed ? 'done' : ''}" onclick={() => workout.toggleSet(exIndex, s)} role="checkbox" aria-checked={set.completed} aria-label="Set {s + 1} of {ex?.name} complete">
												{#if set.completed}<Icon name="check" size={14} sw={2.6} color="#fff" />{/if}
											</button>
										</td>
										<td class="l muted" style="font-weight:600;{isActive ? 'color:var(--accent-ink)' : ''}">{s + 1}</td>

										{#if tt === 'cardio'}
											{#if cardioDist}
												<td><input class="inp" type="text" aria-label="Set {s + 1} time" value={mmss(set.timeSec ?? 0)} onchange={(e) => (set.timeSec = parseMmss(e.currentTarget.value))} /></td>
												<td><input class="inp" type="number" inputmode="numeric" aria-label="Set {s + 1} meters" value={set.distanceMeters ?? ''} oninput={(e) => (set.distanceMeters = numOrUndef(e.currentTarget.value))} /></td>
												<td class="muted">{cardioSplit500Sec(set) != null ? mmss(cardioSplit500Sec(set)!) : '—'}</td>
											{:else}
												<td><input class="inp" type="text" aria-label="Set {s + 1} time" value={mmss(set.timeSec ?? 0)} onchange={(e) => (set.timeSec = parseMmss(e.currentTarget.value))} /></td>
												<td><input class="inp" type="number" aria-label="Set {s + 1} incline" value={set.incline ?? ''} oninput={(e) => (set.incline = numOrUndef(e.currentTarget.value))} /></td>
												<td><input class="inp" type="number" aria-label="Set {s + 1} speed" value={set.speed ?? ''} oninput={(e) => (set.speed = numOrUndef(e.currentTarget.value))} /></td>
											{/if}
										{:else if tt === 'time_hold'}
											{@render restCell(exIndex, s, set)}
											<td><input class="inp" type="text" aria-label="Set {s + 1} hold time" value={mmss(set.durationSec ?? 0)} onchange={(e) => (set.durationSec = parseMmss(e.currentTarget.value))} /></td>
										{:else}
											{@render restCell(exIndex, s, set)}
											<td><input class="inp" type="number" aria-label="Set {s + 1} reps" value={set.reps ?? ''} onfocus={selectOnFocus} oninput={(e) => (set.reps = numOrUndef(e.currentTarget.value))} /></td>
											{#if !bw}
												<!-- on commit, the new load carries down to the later sets that still
												     agreed with the old one (see workout.propagateWeight) -->
												<td><input class="inp" type="number" step="0.5" aria-label="Set {s + 1} weight in kilograms" value={set.weight ?? ''} onfocus={(e) => { weightBefore = set.weight; selectOnFocus(e); }} oninput={(e) => (set.weight = numOrUndef(e.currentTarget.value))} onchange={() => workout.propagateWeight(exIndex, s, weightBefore)} /></td>
											{/if}
											{#if settings.current.trackRpe}
												<td><input class="inp" type="number" step="0.5" min="6" max="10" inputmode="decimal" aria-label="Set {s + 1} RPE" value={set.rpe ?? ''} oninput={(e) => (set.rpe = numOrUndef(e.currentTarget.value))} /></td>
											{/if}
										{/if}
									</tr>
								{/each}
							</tbody>
						</table>
						<!-- Remove mirrors the Add/Remove pair in the template editor: the swipe
						     gesture on a set row stays the sighted shortcut, but it is unreachable
						     by VoiceOver/keyboard/Switch Control, so the action needs a real button. -->
						<div style="display:flex;align-items:center;gap:16px">
							<button
								class="txt-sm tap-row"
								style="display:flex;align-items:center;gap:6px;padding:9px 2px 0;color:var(--ink-2);background:none;border:none"
								onclick={() => workout.addSet(exIndex)}
							>
								<Icon name="plus" size={13} sw={2.2} color="var(--ink-3)" />Add set
							</button>
							<button
								class="txt-sm tap-row"
								style="display:flex;align-items:center;gap:6px;padding:9px 2px 0;color:var(--ink-2);background:none;border:none"
								onclick={() => removeLastSet(exIndex)}
								disabled={le.sets.length <= 1}
								aria-label="Remove last set from {ex?.name}"
							>
								<Icon name="minus" size={13} sw={2.2} color="var(--ink-3)" />Remove
							</button>
						</div>

						<!-- platesPerSide's input is the BAR TOTAL. A per-side exercise logs one
						     side, so there is no total to break down — suppress rather than invent one. -->
						{#if ex?.equipment === 'barbell' && !perSide && exIndex === workout.activeEx && (le.sets[workout.activeSet]?.weight ?? 0) > 0}
							<div class="txt-sm" style="display:flex;align-items:center;gap:8px;padding:9px 2px 0;color:var(--ink-2)">
								<span style="font-size:calc(var(--dt-base)*10.5/17);font-weight:600;letter-spacing:0.4px;color:var(--ink-3);border:1px solid var(--line);border-radius:5px;padding:1px 5px">BAR</span>
								<span class="mono">{formatPerSide(platesPerSide(le.sets[workout.activeSet]?.weight ?? 0))}</span>
								<span style="color:var(--ink-3)">/ side</span>
							</div>
						{/if}

						{#if sg}
							<div style="display:flex;align-items:center;gap:8px;padding:10px 2px 2px;flex-wrap:wrap">
								<Icon name="spark" size={14} color="var(--accent)" />
								<span class="txt-sm" style="color:var(--ink-2)">Last {sg.last} · {sg.hit ? 'hit target →' : 'aim again'}</span>
								<!-- "Last …" is history and always shown; only the suggested STEP is the
								     auto-progression feature the Settings toggle governs -->
								{#if settings.current.autoProgression}
									<span class="suggest">
										{sg.stepLabel}{#if sg.nextWeight != null} · {kg(sg.nextWeight)}kg{:else if sg.nextReps != null} · {sg.nextReps} reps{/if}
									</span>
								{/if}
							</div>
						{/if}

						{#if workout.restForSet?.ex === exIndex}
							<div style="margin:14px 0"><RestBanner /></div>
						{/if}
					</div>
				{/each}
				<Button variant="bordered" full style="margin-top:6px" onclick={() => goto('/picker?to=workout')}>
					<Icon name="plus" size={18} />Add exercise
				</Button>

				<div style="margin-top:20px">
					<div class="h-sec" style="margin-bottom:8px">Session notes</div>
					<textarea
						class="note-input"
						placeholder="How did it go? Form cues, how you felt, anything to remember…"
						value={workout.session.note ?? ''}
						oninput={(e) => workout.setNote(e.currentTarget.value)}
					></textarea>
				</div>

				<!-- Discarding used to be what the topbar chevron did. Now that the chevron
				     minimizes, throwing the workout away needs its own named control — kept
				     at the bottom, out of the logging path, and still confirm-gated. -->
				<div style="margin-top:24px;display:flex;justify-content:center">
					<Button variant="destructive" size="regular" onclick={discardWorkout}>Discard workout</Button>
				</div>
			</div>
		</div>
	</div>
{/if}

{#if syncPrompt}
	<button class="sheet-backdrop" aria-label="Dismiss" onclick={finalizeSync} disabled={syncBusy}></button>
	<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1" use:autofocusNode>
		<div class="sheet-grip" aria-hidden="true"></div>
		<span class="stat-ic" style="width:46px;height:46px;background:var(--accent-tint);margin-bottom:14px"><Icon name="swap" size={22} color="var(--accent-ink)" /></span>

		{#if syncPrompt.template}
			<div class="h-card" id="sheet-title" style="font-size:calc(var(--dt-base)*19/17);margin-bottom:6px">Update “{syncPrompt.template.name}”?</div>
			<div class="txt" style="margin-bottom:16px">You made changes this workout — apply them back to the template for next time?</div>
			<!-- Weights-only is the FILLED (default) action: it only touches numbers on
			     sets the template already has. The whole-template option rewrites the
			     exercise list to exactly what was logged — destructive, undoable only by
			     rebuilding the template by hand — so it is bordered and states its cost. -->
			<div style="display:flex;flex-direction:column;gap:9px">
				<Button onclick={() => chooseTemplateSync('weightsOnly')} disabled={syncBusy}>
					Update weights only
				</Button>
				<Button variant="bordered" onclick={() => chooseTemplateSync('full')} disabled={syncBusy}>
					Replace template with this workout
				</Button>
				{#if fullSyncCost}
					<div class="txt-sm" style="margin:-4px 4px 2px;color:var(--ink-3);text-align:center">{fullSyncCost}</div>
				{/if}
				<!-- the dismissive third option is the kit's Default (plain) style, not a
				     third outlined pill fighting the two above for weight -->
				<Button variant="plain" onclick={() => chooseTemplateSync('none')} disabled={syncBusy}>
					{syncBusy ? 'Working…' : 'Leave template as-is'}
				</Button>
			</div>
		{:else}
			<div class="h-card" id="sheet-title" style="font-size:calc(var(--dt-base)*19/17);margin-bottom:6px">Save as a template?</div>
			<div class="txt" style="margin-bottom:14px">Turn this quick-logged workout into a reusable template.</div>
			<input class="inp" style="width:100%;height:44px;margin-bottom:16px" type="text" placeholder="Template name" bind:value={newTemplateName} />
			<div style="display:flex;gap:10px">
				<Button variant="bordered" style="flex:1" onclick={() => saveAsNewTemplate(false)} disabled={syncBusy}>Don't save</Button>
				<Button style="flex:1.3" onclick={() => saveAsNewTemplate(true)} disabled={syncBusy || !newTemplateName.trim()}>
					{syncBusy ? 'Working…' : 'Save as template'}
				</Button>
			</div>
		{/if}
		{#if syncError}
			<div class="txt-sm" style="margin-top:10px;padding-inline:4px;color:var(--warn)">{syncError}</div>
		{/if}
	</div>
{/if}
