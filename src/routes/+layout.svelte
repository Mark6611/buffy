<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	// Svelte 5 runes: `children` is the page being rendered inside the layout.
	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app">
	{@render children()}
</div>
