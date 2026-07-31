<script lang="ts">
	import Icon from './Icon.svelte';
	import type { IconName } from '$lib/icons';

	// Action buttons are identified by icon NAME, which is not a label a human would
	// recognise ("trash"). Map the ones we ship to their real verb.
	const ACTION_LABEL: Partial<Record<IconName, string>> = { trash: 'Delete', edit: 'Edit' };

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
	<h1 class="topbar-title">{title}</h1>
	<div style="display:flex;gap:8px">
		{#each actions as a (a)}
			<button class="icon-btn" onclick={() => onAction?.(a)} aria-label={ACTION_LABEL[a] ?? a}
				><Icon name={a} size={18} /></button
			>
		{/each}
		{#if !actions.length}<div style="width:36px"></div>{/if}
	</div>
</div>
