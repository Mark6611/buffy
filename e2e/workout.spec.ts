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
	await expect(page.getByText(/Update .Shoulder Core.\?/)).toBeVisible();
	await page.getByRole('button', { name: 'Leave template as-is' }).click();
	await expect(page).toHaveURL(/\/history\//);
	await expect(page.getByRole('heading', { name: 'Shoulder Core' })).toBeVisible();
});

test('finishing a template workout can push edited weights back to the template', async ({ page }) => {
	await page.getByRole('button', { name: /Shoulder Core/ }).first().click();
	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await expect(page).toHaveURL(/\/workout/);

	// bump the first set's weight, then log it (row order: reps input, then weight input)
	const firstRow = page.locator('.ex-block').first().locator('tbody tr').first();
	await firstRow.locator('input[type="number"]').last().fill('16');
	await page.locator('button[aria-label="toggle set"]').first().click();

	await page.getByRole('button', { name: 'Finish' }).click();
	await page.getByRole('button', { name: 'Update weights only' }).click();
	await expect(page).toHaveURL(/\/history\//);

	// the template's summary line reads its first set's target weight
	await page.goto('/');
	await page.getByRole('button', { name: /Shoulder Core/ }).first().click();
	await expect(page.getByText(/16kg/)).toBeVisible();
});

test('a quick-log workout can be saved as a new template', async ({ page }) => {
	await page.getByRole('button', { name: /Quick log a workout/ }).click();
	await expect(page).toHaveURL(/\/workout/);

	await page.getByRole('button', { name: /Add exercise/ }).click();
	await page.getByRole('button', { name: /Dumbbell Bicep Curl/ }).click();
	await expect(page).toHaveURL(/\/workout/);
	await page.locator('button[aria-label="toggle set"]').first().click();

	await page.getByRole('button', { name: 'Finish' }).click();
	await expect(page.getByText('Save as a template?')).toBeVisible();
	await page.getByPlaceholder('Template name').fill('My New Split');
	await page.getByRole('button', { name: 'Save as template' }).click();
	await expect(page).toHaveURL(/\/history\//);

	await page.goto('/');
	await expect(page.getByRole('button', { name: /My New Split/ })).toBeVisible();
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
