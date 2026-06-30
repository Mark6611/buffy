<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import '../app.css';
	// Self-hosted fonts — bundled into the app so they load instantly and work
	// offline (no Google Fonts request, which blanks the screen inside a WebView).
	import '@fontsource/space-grotesk/400.css';
	import '@fontsource/space-grotesk/500.css';
	import '@fontsource/space-grotesk/600.css';
	import '@fontsource/space-grotesk/700.css';
	import '@fontsource/jetbrains-mono/400.css';
	import '@fontsource/jetbrains-mono/500.css';
	import '@fontsource/jetbrains-mono/600.css';
	import '@fontsource/jetbrains-mono/700.css';
	import favicon from '$lib/assets/favicon.svg';
	import {
		ensurePersistentStorage,
		setupNativeChrome,
		hideSplash,
		requestNotificationPermission
	} from '$lib/native';
	import { workout } from '$lib/stores/workout.svelte';

	// Svelte 5 runes: `children` is the page being rendered inside the layout.
	let { children } = $props();

	onMount(() => {
		hideSplash(); // app has painted — fade the native splash out (no black gap)
		ensurePersistentStorage();
		setupNativeChrome();
		requestNotificationPermission();
		// Resume an in-progress workout after an app restart / WebView purge, and
		// drop the user straight back into it.
		workout.restore();
		if (workout.active) goto('/workout');
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app">
	{@render children()}
</div>
