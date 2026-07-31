<script lang="ts">
	let {
		series,
		labels,
		w = 358,
		h = 180,
		label = 'Line chart'
	}: {
		series: { data: number[]; color: string; dash?: boolean }[];
		labels: string[];
		w?: number;
		h?: number;
		label?: string;
	} = $props();

	const padL = 32,
		padB = 22,
		padT = 12,
		padR = 8;
	const all = $derived(series.flatMap((s) => s.data));
	const min = $derived(Math.floor(Math.min(...all) / 5) * 5 - 2);
	const max = $derived(Math.ceil(Math.max(...all) / 5) * 5 + 2);
	const innerW = $derived(w - padL - padR);
	const innerH = $derived(h - padB - padT);
	const x = (i: number) => padL + (i / Math.max(1, labels.length - 1)) * innerW;
	const y = (v: number) => padT + innerH - ((v - min) / (max - min || 1)) * innerH;
</script>

<svg viewBox="0 0 {w} {h}" width="100%" style="display:block" role="img" aria-label={label}>
	{#each [0, 0.5, 1] as f, i (i)}
		{@const val = min + (max - min) * f}
		{@const gy = y(val)}
		<line x1={padL} y1={gy} x2={w - padR} y2={gy} stroke="var(--line-soft)" stroke-width="1" />
		<text x={padL - 6} y={gy + 3} text-anchor="end" font-family="var(--font-mono)" font-size="9" fill="var(--ink-3)"
			>{Math.round(val)}</text
		>
	{/each}
	{#each series as s, si (si)}
		<polyline
			points={s.data.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
			fill="none"
			stroke={s.color}
			stroke-width={s.dash ? 1.6 : 2.4}
			stroke-dasharray={s.dash ? '4 4' : 'none'}
			stroke-linejoin="round"
			stroke-linecap="round"
		/>
		{#if !s.dash}
			{#each s.data as v, i (i)}
				<circle cx={x(i)} cy={y(v)} r="3" fill="var(--surface)" stroke={s.color} stroke-width="2" />
			{/each}
		{/if}
	{/each}
	{#each labels as l, i (i)}
		{#if i % 2 === 0}
			<text x={x(i)} y={h - 6} text-anchor="middle" font-family="var(--font-mono)" font-size="9" fill="var(--ink-3)"
				>{l}</text
			>
		{/if}
	{/each}
</svg>
