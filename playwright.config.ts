import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	timeout: 30_000,
	fullyParallel: false,
	use: { baseURL: 'http://localhost:4173', trace: 'on-first-retry' },
	webServer: {
		command: 'npm run dev -- --port 4173',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000
	},
	projects: [{ name: 'chromium', use: { browserName: 'chromium' } }]
});
