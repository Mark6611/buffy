<script lang="ts">
	import Icon from './Icon.svelte';
	import { EQUIP_ICON } from '$lib/icons';
	import { equipLabel } from '$lib/format';
	import type { Equipment } from '$lib/types';

	let { equip }: { equip: Equipment } = $props();
</script>

<span class="chip">
	<Icon name={EQUIP_ICON[equip] ?? 'dumbbell'} size={13} sw={1.8} />
	<span class="chip-eq">{equipLabel(equip)}</span>
</span>
