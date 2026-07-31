<script lang="ts">
	import Icon from './Icon.svelte';
	import type { Snippet } from 'svelte';
	let { link, onlink, children }: { link?: string; onlink?: () => void; children?: Snippet } = $props();
</script>

<div style="display:flex;align-items:center;justify-content:space-between;margin:0 0 10px">
	<h2 class="h-sec">{@render children?.()}</h2>
	{#if link}
		<button
			class="txt-sm"
			style="color:var(--accent-ink);display:inline-flex;align-items:center;gap:3px;font-weight:500;background:none;border:none;cursor:pointer;padding:0"
			onclick={onlink}>{link}<Icon name="chevR" size={13} color="var(--accent)" /></button
		>
	{/if}
</div>
