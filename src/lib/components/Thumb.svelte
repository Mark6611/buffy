<script lang="ts">
	import Icon from './Icon.svelte';
	import { EQUIP_ICON } from '$lib/icons';
	import type { Equipment } from '$lib/types';

	let { equip = 'dumbbell', size = '' }: { equip?: Equipment; size?: '' | 'sm' | 'lg' } = $props();
</script>

<div class="thumb {size}" title={equip}>
	<Icon name={EQUIP_ICON[equip] ?? 'dumbbell'} size={size === 'sm' ? 18 : 22} sw={1.7} />
</div>
