<script lang="ts">
	import Icon from './Icon.svelte';
	import { workout } from '$lib/stores/workout.svelte';
	import { mmss } from '$lib/format';

	const over = $derived(workout.restOver);
	const pct = $derived(
		workout.restSeedSec > 0 ? Math.max(0, Math.min(1, workout.restRemaining / workout.restSeedSec)) : 0
	);
</script>

<div class="rest-banner {over ? 'warn' : 'accent'}">
	<div style="flex:1;min-width:0">
		<div class="rest-label">{over ? 'Next set — logging rest overage' : 'Rest'}</div>
		<div style="display:flex;align-items:baseline;gap:10px;margin:4px 0 9px">
			<span class="rest-time">{mmss(workout.restRemaining)}</span>
			<span class="mono" style="font-size:12px;opacity:.7">/ {mmss(workout.restSeedSec)}</span>
		</div>
		<div class="rest-progress"><i style="width:{pct * 100}%"></i></div>
	</div>
	<div style="display:flex;gap:7px">
		<button class="rest-ctrl" onclick={() => workout.adjustRest(-15)}>−15</button>
		<button class="rest-ctrl" onclick={() => workout.togglePause()} aria-label="pause/resume">
			<Icon name={workout.restRunning ? 'pause' : 'play'} size={14} color="#fff" />
		</button>
		<button class="rest-ctrl" onclick={() => workout.adjustRest(15)}>+15</button>
		<button class="rest-ctrl" onclick={() => workout.skipRest()} aria-label="skip">
			<Icon name="skip" size={14} color="#fff" />
		</button>
	</div>
</div>
