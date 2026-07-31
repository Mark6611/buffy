<script lang="ts">
	let {
		data,
		w = 358,
		h = 70,
		label = 'Trend chart'
	}: { data: number[]; w?: number; h?: number; label?: string } = $props();

	const padL = 26,
		padR = 8,
		padT = 8,
		padB = 18;
	const min = $derived(Math.min(...data) - 1);
	const max = $derived(Math.max(...data) + 1);
	const innerW = $derived(w - padL - padR);
	const innerH = $derived(h - padT - padB);
	const x = (i: number) => padL + (i / Math.max(1, data.length - 1)) * innerW;
	const y = (v: number) => padT + innerH - ((v - min) / (max - min || 1)) * innerH;
</script>

<svg viewBox="0 0 {w} {h}" width="100%" style="display:block" role="img" aria-label={label}>
	{#each data as v, i (i)}
		<circle cx={x(i)} cy={y(v)} r="4" fill="var(--accent-tint)" stroke="var(--accent)" stroke-width="1.5" />
		<text x={x(i)} y={y(v) - 8} text-anchor="middle" font-family="var(--font-mono)" font-size="8.5" fill="var(--ink-2)"
			>{v}</text
		>
	{/each}
</svg>
