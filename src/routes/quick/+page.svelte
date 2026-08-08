<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { workout } from '$lib/stores/workout.svelte';
	import Button from '$lib/components/Button.svelte';

	// startAdhoc() refuses to overwrite a live workout, so this route can land in two
	// states: it started one (go straight in), or one was already running and the user
	// has to say what happens to it. Never decide that for them — the running workout
	// may hold sets that exist nowhere else yet.
	let blocked = $state(false);

	onMount(async () => {
		const res = await workout.startAdhoc();
		if (res.ok) goto('/workout', { replaceState: true });
		else blocked = true;
	});

	async function discardAndStart() {
		workout.cancel();
		const res = await workout.startAdhoc();
		if (res.ok) goto('/workout', { replaceState: true });
	}
</script>

<div class="screen">
	<div class="pad" style="padding-top:40px">
		{#if blocked}
			<div class="h-card" style="margin-bottom:6px">A workout is already in progress</div>
			<div class="txt" style="margin-bottom:18px">
				“{workout.session?.title ?? 'Your workout'}” is still running. Starting a new quick log would
				throw away everything logged in it.
			</div>
			<div style="display:flex;flex-direction:column;gap:9px">
				<Button full onclick={() => goto('/workout', { replaceState: true })}>Resume it</Button>
				<Button variant="bordered" full onclick={() => goto('/')}>Go back</Button>
				<Button variant="destructive" full onclick={discardAndStart}>Discard it and start a new quick log</Button>
			</div>
		{:else}
			<div class="txt">Starting quick log…</div>
		{/if}
	</div>
</div>
