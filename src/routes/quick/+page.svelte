<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { workout } from '$lib/stores/workout.svelte';

	onMount(() => {
		workout.startAdhoc();
		goto('/workout', { replaceState: true });
	});
</script>

<div class="screen">
	<div class="pad" style="padding-top:40px"><div class="txt">Starting quick log…</div></div>
</div>
