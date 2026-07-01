import { test, expect } from '@playwright/test';

// Start from a clean slate: clear any in-progress workout so the layout doesn't
// auto-resume into /workout before the test drives the flow.
test.beforeEach(async ({ page }) => {
	await page.goto('/');
	await page.evaluate(() => localStorage.removeItem('buffy:activeWorkout'));
	await page.reload();
	await expect(page.getByRole('button', { name: /Quick log a workout/ })).toBeVisible();
});

test('template → log a set → rest → finish → history', async ({ page }) => {
	await page.getByRole('button', { name: /Shoulder Core/ }).first().click();
	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await expect(page).toHaveURL(/\/workout/);

	// log the first set → rest banner appears
	await page.locator('button[aria-label="toggle set"]').first().click();
	await expect(page.locator('.rest-banner')).toBeVisible();
	await expect(page.locator('tr.row-done')).toHaveCount(1);

	await page.getByRole('button', { name: 'Finish' }).click();
	await expect(page).toHaveURL(/\/history\//);
	await expect(page.getByRole('heading', { name: 'Shoulder Core' })).toBeVisible();
});

test('an in-progress workout resumes after a reload', async ({ page }) => {
	await page.getByRole('button', { name: /Legs/ }).first().click();
	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await expect(page).toHaveURL(/\/workout/);
	await page.locator('button[aria-label="toggle set"]').first().click();
	await expect(page.locator('tr.row-done')).toHaveCount(1);

	// hard reload — the app should restore the session and land back in /workout
	await page.reload();
	await expect(page).toHaveURL(/\/workout/);
	await expect(page.locator('tr.row-done')).toHaveCount(1);
});
