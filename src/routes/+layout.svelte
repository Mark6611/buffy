<script lang="ts">
	import { onMount } from 'svelte';
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
	import { ensurePersistentStorage, setupNativeChrome } from '$lib/native';

	// Svelte 5 runes: `children` is the page being rendered inside the layout.
	let { children } = $props();

	onMount(() => {
		ensurePersistentStorage();
		setupNativeChrome();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app">
	{@render children()}
</div>
