<script lang="ts">
	import { ICONS, SOLID_ICONS, type IconName } from '$lib/icons';

	let {
		name,
		size = 20,
		sw = 1.9,
		color = 'currentColor',
		fill = 'none',
		style = ''
	}: { name: IconName; size?: number; sw?: number; color?: string; fill?: string; style?: string } = $props();

	const solid = $derived(SOLID_ICONS.has(name));
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	style="display:block;flex:0 0 auto;{style}"
	fill={solid ? color : fill}
	stroke={solid ? 'none' : color}
	stroke-width={sw}
	stroke-linecap="round"
	stroke-linejoin="round"
>
	<path d={ICONS[name]} />
</svg>
