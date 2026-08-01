<script lang="ts">
	import Icon from './Icon.svelte';
	import type { IconName } from '$lib/icons';
	let {
		icon,
		big,
		label,
		delta,
		deltaUp = false,
		accent = false
	}: { icon: IconName; big: string; label: string; delta?: string; deltaUp?: boolean; accent?: boolean } = $props();
</script>

<div class="card" style="padding:13px 14px;flex:1;min-width:0">
	<div style="display:flex;align-items:center;gap:7px;margin-bottom:8px">
		<span class="stat-ic" style="width:28px;height:28px;background:{accent ? 'var(--accent)' : 'var(--accent-tint)'}">
			<Icon name={icon} size={15} sw={2} color={accent ? '#fff' : 'var(--accent-ink)'} />
		</span>
		{#if delta}
			<span
				class="num"
				style="margin-left:auto;font-size:calc(var(--dt-base)*11/17);font-weight:600;display:inline-flex;align-items:center;gap:2px;color:{deltaUp
					? 'var(--accent-ink)'
					: 'var(--ink-3)'}"
			>
				<Icon name={deltaUp ? 'arrowU' : 'arrowD'} size={11} sw={2.4} />{delta}
			</span>
		{/if}
	</div>
	<div class="num" style="font-size:calc(var(--dt-base)*23/17);font-weight:700;letter-spacing:-0.5px;line-height:1">{big}</div>
	<div class="txt-sm" style="margin-top:4px">{label}</div>
</div>
