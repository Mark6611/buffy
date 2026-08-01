<script lang="ts">
	import Icon from './Icon.svelte';
	import type { IconName } from '$lib/icons';
	import type { Snippet } from 'svelte';

	let { icon, children }: { icon: IconName; children?: Snippet } = $props();
</script>

<div class="stat-row">
	<div class="stat-ic"><Icon name={icon} size={18} /></div>
	<div style="font-size:calc(var(--dt-base)*16/17);font-weight:500">{@render children?.()}</div>
</div>
