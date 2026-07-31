<script lang="ts">
	import { shade } from '$lib/charts';
	let {
		vals,
		side = 'front',
		label
	}: { vals: Record<string, number>; side?: 'front' | 'back'; label?: string } = $props();
	const v = (k: string) => shade(vals[k] || 0);
	const ariaLabel = $derived(label ?? `Muscle activity body map, ${side} view`);
</script>

<svg viewBox="0 0 160 240" width="100%" style="display:block;max-height:300px" role="img" aria-label={ariaLabel}>
	<circle cx="80" cy="22" r="13" fill="var(--surface-2)" stroke="var(--line)" stroke-width="1" />
	<rect x="74" y="33" width="12" height="8" rx="3" fill="var(--surface-2)" stroke="var(--line)" stroke-width="1" />
	{#if side === 'front'}
		<ellipse cx="52" cy="50" rx="13" ry="10" fill={v('Shoulders')} stroke="var(--line)" stroke-width="1" />
		<ellipse cx="108" cy="50" rx="13" ry="10" fill={v('Shoulders')} stroke="var(--line)" stroke-width="1" />
		<rect x="58" y="46" width="20" height="22" rx="7" fill={v('Chest')} stroke="var(--line)" stroke-width="1" />
		<rect x="82" y="46" width="20" height="22" rx="7" fill={v('Chest')} stroke="var(--line)" stroke-width="1" />
		<rect x="66" y="70" width="28" height="34" rx="8" fill={v('Abs')} stroke="var(--line)" stroke-width="1" />
		<rect x="38" y="58" width="13" height="30" rx="6" fill={v('Biceps')} stroke="var(--line)" stroke-width="1" />
		<rect x="109" y="58" width="13" height="30" rx="6" fill={v('Biceps')} stroke="var(--line)" stroke-width="1" />
		<rect x="36" y="90" width="11" height="26" rx="5" fill="var(--surface-2)" stroke="var(--line)" stroke-width="1" />
		<rect x="113" y="90" width="11" height="26" rx="5" fill="var(--surface-2)" stroke="var(--line)" stroke-width="1" />
		<rect x="60" y="108" width="16" height="46" rx="7" fill={v('Quads')} stroke="var(--line)" stroke-width="1" />
		<rect x="84" y="108" width="16" height="46" rx="7" fill={v('Quads')} stroke="var(--line)" stroke-width="1" />
		<rect x="62" y="158" width="13" height="40" rx="6" fill="var(--surface-2)" stroke="var(--line)" stroke-width="1" />
		<rect x="85" y="158" width="13" height="40" rx="6" fill="var(--surface-2)" stroke="var(--line)" stroke-width="1" />
	{:else}
		<rect x="64" y="44" width="32" height="14" rx="6" fill={v('Traps')} stroke="var(--line)" stroke-width="1" />
		<ellipse cx="50" cy="52" rx="12" ry="9" fill={v('Shoulders')} stroke="var(--line)" stroke-width="1" />
		<ellipse cx="110" cy="52" rx="12" ry="9" fill={v('Shoulders')} stroke="var(--line)" stroke-width="1" />
		<rect x="58" y="58" width="44" height="30" rx="9" fill={v('Back')} stroke="var(--line)" stroke-width="1" />
		<rect x="38" y="58" width="13" height="30" rx="6" fill={v('Triceps')} stroke="var(--line)" stroke-width="1" />
		<rect x="109" y="58" width="13" height="30" rx="6" fill={v('Triceps')} stroke="var(--line)" stroke-width="1" />
		<rect x="66" y="89" width="28" height="16" rx="6" fill={v('Back')} stroke="var(--line)" stroke-width="1" />
		<rect x="62" y="106" width="17" height="18" rx="7" fill={v('Glutes')} stroke="var(--line)" stroke-width="1" />
		<rect x="81" y="106" width="17" height="18" rx="7" fill={v('Glutes')} stroke="var(--line)" stroke-width="1" />
		<rect x="61" y="126" width="16" height="32" rx="7" fill={v('Hamstrings')} stroke="var(--line)" stroke-width="1" />
		<rect x="83" y="126" width="16" height="32" rx="7" fill={v('Hamstrings')} stroke="var(--line)" stroke-width="1" />
		<rect x="62" y="160" width="13" height="38" rx="6" fill={v('Calves')} stroke="var(--line)" stroke-width="1" />
		<rect x="85" y="160" width="13" height="38" rx="6" fill={v('Calves')} stroke="var(--line)" stroke-width="1" />
	{/if}
</svg>
