import { test, expect } from '@playwright/test';

// Pins the picker's search against the PRODUCTION build. The svelte-compiler
// paren-drop that silently disabled it (see exerciseSearch.ts) only exists in
// compiled output — the unit tests run the .ts module through esbuild and stayed
// green the whole time. Under the default "All" chip a query must narrow the
// list, and a no-match must say so.
test.beforeEach(async ({ page }) => {
	await page.goto('/');
	await page.evaluate(() => localStorage.removeItem('buffy:activeWorkout'));
	await page.reload();
	// wait for real data, not the static shell — see workout.spec.ts
	await expect(page.getByRole('button', { name: /Shoulder Core/ }).first()).toBeVisible({
		timeout: 20000
	});
});

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

	await search.fill('bench');
	await expect(rows).toHaveCount(1);
	await expect(rows.first()).toContainText('Bench');

	await page.getByLabel('Clear search').click();
	await expect(rows).toHaveCount(catalog);
});
