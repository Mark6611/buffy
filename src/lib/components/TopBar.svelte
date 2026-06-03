<script lang="ts">
	import Icon from './Icon.svelte';
	import type { IconName } from '$lib/icons';

	let {
		title = '',
		back = true,
		actions = [],
		onAction
	}: { title?: string; back?: boolean; actions?: IconName[]; onAction?: (a: IconName) => void } = $props();

	function goBack() {
		history.back();
	}
</script>

<div class="topbar">
	{#if back}
		<button class="icon-btn" onclick={goBack} aria-label="Back"><Icon name="back" size={20} /></button>
	{:else}
		<div style="width:36px"></div>
	{/if}
	<div class="topbar-title">{title}</div>
	<div style="display:flex;gap:8px">
		{#each actions as a (a)}
			<button class="icon-btn" onclick={() => onAction?.(a)} aria-label={a}><Icon name={a} size={18} /></button>
		{/each}
		{#if !actions.length}<div style="width:36px"></div>{/if}
	</div>
</div>
