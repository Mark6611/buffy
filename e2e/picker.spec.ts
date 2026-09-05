import { test, expect } from '@playwright/test';
import { freshHome } from './fresh';

// Pins the picker's search against the PRODUCTION build. The build-time paren-drop
// that silently disabled it exists only in the bundle (Rolldown's handling of
// vite-plugin-svelte output — the verified write-up is in src/lib/exerciseSearch.ts);
// the unit tests run the .ts module through esbuild and stayed green throughout.
// Under the default "All" chip a query must narrow the list, and a no-match must
// say so.
test.beforeEach(({ page }) => freshHome(page));

test('picker search narrows the catalog under the default "All" chip', async ({ page }) => {
	await page.getByRole('button', { name: /Quick log a workout/ }).click();
	await page.getByRole('button', { name: /Add exercise/ }).click();
	const rows = page.locator('button.row');
	await expect(rows.first()).toBeVisible();
	const catalog = await rows.count();
	expect(catalog).toBeGreaterThan(1);

	const search = page.getByLabel('Search exercises');
	await search.fill('zzzzqqq');
	await expect(rows).toHaveCount(0);
	await expect(page.getByText(/Nothing matches/)).toBeVisible();

	// Assert the shape, not a count pinned to today's seed: strictly fewer rows
	// than the catalog, and every one of them actually matches the query.
	await search.fill('bench');
	await expect(rows.first()).toBeVisible();
	const n = await rows.count();
	expect(n).toBeGreaterThan(0);
	expect(n).toBeLessThan(catalog);
	for (let i = 0; i < n; i++) await expect(rows.nth(i)).toContainText(/bench/i);

	await page.getByLabel('Clear search').click();
	await expect(rows).toHaveCount(catalog);
});
