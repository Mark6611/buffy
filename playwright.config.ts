import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	// The FIRST test of a cold run pays for a just-booted preview server, the browser's
	// first parse of the production bundle and the initial IndexedDB seed, all inside one
	// test's budget. 30s was enough right up until it wasn't, and it failed as a "flaky
	// selector" rather than as the timeout it actually was. Raised rather than papered
	// over with retries, which would hide a genuine regression.
	timeout: 60_000,
	fullyParallel: false,
	use: { baseURL: 'http://localhost:4173', trace: 'on-first-retry' },
	webServer: {
		// CI and the ship pipeline (which runs `CI=1 npm run test:e2e`) exercise the
		// MINIFIED PRODUCTION build via preview — the only place a prod-only codegen
		// difference (the Svelte-compiler paren-drop that bricked build 11) can surface.
		// Local dev stays on the fast dev server.
		command: process.env.CI
			? 'npm run build && npm run preview -- --port 4173'
			: 'npm run dev -- --port 4173',
		// url, not port: a listening socket only proves the process bound the port, while
		// this waits for the app to actually SERVE — and warms the first request.
		url: 'http://localhost:4173/',
		// Never reuse an already-running server under CI/ship — always boot from the
		// exact working tree being shipped, not whatever was left listening on 4173.
		reuseExistingServer: !process.env.CI,
		timeout: 180_000
	},
	projects: [{ name: 'chromium', use: { browserName: 'chromium' } }]
});
