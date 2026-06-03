<script lang="ts">
	let {
		data,
		w = 358,
		h = 168,
		highlightLast = true,
		yticks = 3
	}: { data: { l: string; v: number }[]; w?: number; h?: number; highlightLast?: boolean; yticks?: number } =
		$props();

	const padL = 30,
		padB = 22,
		padT = 10;
	const max = $derived(Math.max(0.1, ...data.map((d) => d.v)) * 1.1);
	const innerW = $derived(w - padL);
	const innerH = $derived(h - padB - padT);
	const slot = $derived(innerW / Math.max(1, data.length));
	const barW = $derived(Math.min(slot * 0.62, 26));
</script>

<svg viewBox="0 0 {w} {h}" width="100%" style="display:block">
	{#each Array.from({ length: yticks + 1 }) as _, i (i)}
		{@const val = (max / yticks) * i}
		{@const y = padT + innerH - (val / max) * innerH}
		<line x1={padL} y1={y} x2={w} y2={y} stroke="var(--line-soft)" stroke-width="1" />
		<text
			x={padL - 6}
			y={y + 3}
			text-anchor="end"
			font-family="var(--font-mono)"
			font-size="9"
			fill="var(--ink-3)"
			style="font-variant-numeric:tabular-nums">{val >= 1 ? Math.round(val) : ''}</text
		>
	{/each}
	{#each data as d, i (i)}
		{@const bh = (d.v / max) * innerH}
		{@const x = padL + i * slot + (slot - barW) / 2}
		{@const y = padT + innerH - bh}
		{@const hot = highlightLast && i === data.length - 1}
		<rect
			{x}
			{y}
			width={barW}
			height={Math.max(bh, 1)}
			rx="3"
			fill={hot ? 'var(--accent)' : 'var(--accent-tint)'}
			stroke={hot ? 'none' : 'var(--line)'}
			stroke-width="1"
		/>
		{#if i % 2 === 0 || data.length <= 8}
			<text
				x={x + barW / 2}
				y={h - 6}
				text-anchor="middle"
				font-family="var(--font-mono)"
				font-size="9"
				fill="var(--ink-3)"
				style="font-variant-numeric:tabular-nums">{d.l}</text
			>
		{/if}
	{/each}
</svg>
