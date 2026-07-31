<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		children,
		actions,
		actionsWidth = 152,
		onOpen,
		/** Mirrors the drawer's open state outward so a parent can drive
		 *  aria-expanded on its own trigger. Bindable; do not write to it.
		 *  No fallback on purpose — Svelte rejects binding an undefined value to a
		 *  prop that declares one, and the parent's array starts empty. */
		open = $bindable()
	}: {
		children: Snippet;
		actions: Snippet;
		actionsWidth?: number;
		onOpen?: () => void;
		open?: boolean;
	} = $props();

	let dragX = $state(0);
	let dragging = $state(false);
	let startX = 0;
	let startDragX = 0;

	// keep the mirrored flag in step however the drawer moved (drag OR toggle)
	$effect(() => {
		open = dragX < 0;
	});

	/** Snap shut — called by the parent on every other row when one opens. */
	export function close() {
		dragX = 0;
	}

	/** Open/close WITHOUT a gesture. `dragX` only ever goes negative from a pointer
	 *  drag, so before this existed the actions were permanently inert: unreachable
	 *  by VoiceOver, Switch Control and the keyboard. The parent renders a visible
	 *  trigger and calls this. */
	export function toggle() {
		const wasOpen = dragX < 0;
		dragX = wasOpen ? 0 : -actionsWidth;
		if (!wasOpen) onOpen?.();
	}

	function onPointerDown(e: PointerEvent) {
		dragging = true;
		startX = e.clientX;
		startDragX = dragX;
		// capture: without it, a mouse drag released outside the row never gets its
		// pointerup here, leaving `dragging` stuck true (transition disabled)
		try {
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		} catch {
			/* capture unsupported — in-row drags still settle via pointerup */
		}
	}
	function onPointerMove(e: PointerEvent) {
		if (!dragging) return;
		const delta = e.clientX - startX;
		dragX = Math.min(0, Math.max(-actionsWidth, startDragX + delta));
	}
	function endDrag(e: PointerEvent) {
		dragging = false;
		const el = e.currentTarget as HTMLElement;
		if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
	}
	function onPointerUp(e: PointerEvent) {
		if (!dragging) return;
		endDrag(e);
		const shouldOpen = dragX < -actionsWidth / 2;
		dragX = shouldOpen ? -actionsWidth : 0;
		if (shouldOpen) onOpen?.();
	}
	function onPointerCancel(e: PointerEvent) {
		if (!dragging) return;
		// the browser took the gesture (e.g. pan-y scroll) — never settle open here
		endDrag(e);
		dragX = 0;
	}
</script>

<div class="swipe-wrap">
	<!-- inert while closed so the hidden buttons stay out of the tab order and the
	     accessibility tree. They are NOT clipped off-screen as previously claimed —
	     .swipe-content is opaque and simply covers them — so inert is what actually
	     hides them. Note inert is a no-op on iOS 15.0–15.4, where they are merely
	     obscured. Safe to keep now that toggle() gives a non-gesture way in. -->
	<div class="swipe-actions" inert={dragX >= 0}>{@render actions()}</div>
	<!-- role="group": a drag-to-reveal gesture surface, not a single actionable
	     control. The gesture itself has no keyboard equivalent by design — the parent
	     renders a visible trigger wired to toggle() instead. -->
	<div
		class="swipe-content"
		role="group"
		aria-label="{'Swipe left to reveal actions'}"
		style="transform:translateX({dragX}px);transition:{dragging ? 'none' : 'transform 0.2s ease'}"
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerCancel}
	>
		{@render children()}
	</div>
</div>

<style>
	.swipe-wrap {
		position: relative;
		overflow: hidden;
		border-radius: 14px;
	}
	.swipe-actions {
		position: absolute;
		inset: 0;
		display: flex;
		justify-content: flex-end;
		align-items: stretch;
	}
	.swipe-content {
		position: relative;
		background: var(--paper);
		touch-action: pan-y;
	}
</style>
