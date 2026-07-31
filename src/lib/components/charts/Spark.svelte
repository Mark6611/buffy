<script lang="ts">
	let {
		data,
		w = 80,
		h = 28,
		color = 'var(--accent)',
		label = 'Sparkline'
	}: { data: number[]; w?: number; h?: number; color?: string; label?: string } = $props();

	const min = $derived(Math.min(...data));
	const max = $derived(Math.max(...data));
	const x = (i: number) => (i / Math.max(1, data.length - 1)) * (w - 4) + 2;
	const y = (v: number) => h - 3 - ((v - min) / (max - min || 1)) * (h - 6);
	const pts = $derived(data.map((v, i) => `${x(i)},${y(v)}`).join(' '));
</script>

<svg viewBox="0 0 {w} {h}" width={w} height={h} style="display:block" role="img" aria-label={label}>
	<polyline points={pts} fill="none" stroke={color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
	<circle cx={x(data.length - 1)} cy={y(data[data.length - 1])} r="2.6" fill={color} />
</svg>
