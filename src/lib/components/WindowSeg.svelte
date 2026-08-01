<script lang="ts">
	import type { TrendWindow } from '$lib/analytics';
	let { value = $bindable('12w'), width = 168 }: { value?: TrendWindow; width?: number } = $props();
	const opts: { k: TrendWindow; l: string }[] = [
		{ k: '4w', l: '4w' },
		{ k: '12w', l: '12w' },
		{ k: 'all', l: 'All' }
	];
</script>

<div class="seg" style="width:{width}px" role="group" aria-label="Time window">
	{#each opts as o (o.k)}
		<button
			class={value === o.k ? 'on' : ''}
			style="font-family:var(--font-mono);font-size:calc(var(--dt-base)*12/17)"
			aria-pressed={value === o.k}
			onclick={() => (value = o.k)}>{o.l}</button
		>
	{/each}
</div>
