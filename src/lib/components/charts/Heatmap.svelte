<script lang="ts">
	import { HEAT } from '$lib/charts';
	let {
		weeks,
		cell = 13,
		gap = 4,
		label
	}: { weeks: number[][]; cell?: number; gap?: number; label?: string } = $props();
	const rows = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
	const w = $derived(26 + weeks.length * (cell + gap));
	const h = $derived(16 + 7 * (cell + gap));
	const ariaLabel = $derived(label ?? `Training consistency heatmap, ${weeks.length} weeks`);
</script>

<svg viewBox="0 0 {w} {h}" width="100%" style="display:block" role="img" aria-label={ariaLabel}>
	{#each rows as r, di (di)}
		<text
			x="14"
			y={20 + di * (cell + gap) + cell - 3}
			text-anchor="end"
			font-family="var(--font-mono)"
			font-size="8.5"
			fill="var(--ink-3)">{r}</text
		>
	{/each}
	{#each weeks as wk, wi (wi)}
		{#each wk as lvl, di (di)}
			<rect
				x={22 + wi * (cell + gap)}
				y={14 + di * (cell + gap)}
				width={cell}
				height={cell}
				rx="3"
				fill={HEAT[lvl]}
				stroke={lvl === 0 ? 'var(--line)' : 'none'}
				stroke-width="1"
			/>
		{/each}
	{/each}
</svg>
