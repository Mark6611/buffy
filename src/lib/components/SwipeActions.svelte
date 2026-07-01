<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		children,
		actions,
		actionsWidth = 152,
		onOpen
	}: { children: Snippet; actions: Snippet; actionsWidth?: number; onOpen?: () => void } = $props();

	let dragX = $state(0);
	let dragging = $state(false);
	let startX = 0;
	let startDragX = 0;

	/** Snap shut — called by the parent on every other row when one opens. */
	export function close() {
		dragX = 0;
	}

	function onPointerDown(e: PointerEvent) {
		dragging = true;
		startX = e.clientX;
		startDragX = dragX;
	}
	function onPointerMove(e: PointerEvent) {
		if (!dragging) return;
		const delta = e.clientX - startX;
		dragX = Math.min(0, Math.max(-actionsWidth, startDragX + delta));
	}
	function onPointerUp() {
		if (!dragging) return;
		dragging = false;
		const shouldOpen = dragX < -actionsWidth / 2;
		dragX = shouldOpen ? -actionsWidth : 0;
		if (shouldOpen) onOpen?.();
	}
</script>

<div class="swipe-wrap">
	<!-- inert while closed: the buttons are clipped off-screen (still laid out under
	     overflow:hidden), so without this they'd stay in the tab order and accessibility
	     tree — reachable/announced even though nothing is visible there. -->
	<div class="swipe-actions" inert={dragX >= 0}>{@render actions()}</div>
	<!-- role="group": a drag-to-reveal gesture surface, not a single actionable control —
	     screen-reader users reach the same actions directly via the (real, focusable)
	     buttons rendered in the `actions` snippet, so no keyboard equivalent is added here. -->
	<div
		class="swipe-content"
		role="group"
		aria-label="{'Swipe left to reveal actions'}"
		style="transform:translateX({dragX}px);transition:{dragging ? 'none' : 'transform 0.2s ease'}"
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
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
