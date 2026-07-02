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
		requestNotificationPermission,
		isNative
	} from '$lib/native';
	import { workout } from '$lib/stores/workout.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { runCloudSync } from '$lib/cloudSync';

	// Svelte 5 runes: `children` is the page being rendered inside the layout.
	let { children } = $props();

	// Sync on launch and whenever the app returns to the foreground — but not more
	// than once a minute, so rapid app-switching doesn't hammer CloudKit.
	// (runCloudSync itself serializes overlapping passes and records the last
	// successful sync time; this only rate-limits how often we ask.)
	const MIN_SYNC_INTERVAL_MS = 60_000;
	let lastSyncAttemptMs = 0;
	async function maybeCloudSync() {
		if (!isNative) return;
		await settings.load();
		if (!settings.current.cloudSyncEnabled) return;
		const now = Date.now();
		if (now - lastSyncAttemptMs < MIN_SYNC_INTERVAL_MS) return;
		lastSyncAttemptMs = now;
		await runCloudSync();
	}

	onMount(() => {
		hideSplash(); // app has painted — fade the native splash out (no black gap)
		ensurePersistentStorage();
		setupNativeChrome();
		requestNotificationPermission();
		// Resume an in-progress workout after an app restart / WebView purge, and
		// drop the user straight back into it.
		workout.restore();
		if (workout.active) goto('/workout');

		void maybeCloudSync();
		const onVisible = () => {
			if (document.visibilityState === 'visible') void maybeCloudSync();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => document.removeEventListener('visibilitychange', onVisible);
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app">
	{@render children()}
</div>
