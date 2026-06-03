import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Lightweight config (no SvelteKit plugin) — the unit suites cover the pure
// logic modules (compute, format, progression), so we just need the $lib alias.
export default defineConfig({
	resolve: {
		alias: { $lib: path.resolve('src/lib') }
	},
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts']
	}
});
