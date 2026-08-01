<script lang="ts">
	let { data, max }: { data: { l: string; v: number; low?: boolean }[]; max?: number } = $props();
	const m = $derived(max || Math.max(1, ...data.map((d) => d.v)));
</script>

<div style="display:flex;flex-direction:column;gap:9px">
	{#each data as d (d.l)}
		<div style="display:flex;align-items:center;gap:10px">
			<span style="width:78px;font-size:calc(var(--dt-base)*12.5/17);color:var(--ink-2);text-align:right;flex:0 0 auto">{d.l}</span>
			<div style="flex:1;height:18px;background:var(--surface-2);border-radius:6px;overflow:hidden">
				<div
					style="width:{(d.v / m) * 100}%;height:100%;border-radius:6px;background:{d.low
						? 'var(--warn)'
						: 'var(--accent)'};opacity:{d.low ? 0.85 : 1}"
				></div>
			</div>
			<span class="num" style="width:26px;font-size:calc(var(--dt-base)*12.5/17);color:var(--ink);flex:0 0 auto">{d.v}</span>
		</div>
	{/each}
</div>
