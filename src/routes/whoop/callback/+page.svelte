<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';

	// Whoop's OAuth redirect lands here (registered redirect URI on the deployed
	// site — Whoop requires https, so it can't point straight at the app). This
	// page just relays the code into the native app via the buffy:// scheme.
	// Prerender-safe: everything happens client-side from location.search.
	let failed = $state(false);
	let appUrl = $state('');

	onMount(() => {
		const qs = window.location.search;
		appUrl = 'buffy://whoop-callback' + qs;
		if (new URLSearchParams(qs).get('code') || new URLSearchParams(qs).get('error')) {
			window.location.replace(appUrl);
			// If the app didn't open (e.g. viewed on a desktop browser), show the manual link.
			setTimeout(() => (failed = true), 1500);
		} else {
			failed = true;
		}
	});
</script>

<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:14px;padding:24px;text-align:center">
	<div class="h-app" style="font-size:calc(var(--dt-base)*22/17)">Connecting Whoop…</div>
	{#if failed}
		<div class="txt-sm">If Buffy didn't open automatically, tap below on your iPhone.</div>
		<Button variant="dark" href={appUrl}>Open Buffy</Button>
	{/if}
</div>
