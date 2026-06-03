<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
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
