import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';

// Unit suites cover the pure logic modules (compute, format, progression) plus
// the workout store. The svelte plugin compiles runes ($state) in .svelte.ts
// modules; no SvelteKit plugin needed — $lib is aliased directly.
export default defineConfig({
	plugins: [svelte()],
	resolve: {
		alias: { $lib: path.resolve('src/lib') }
	},
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts']
	}
});
