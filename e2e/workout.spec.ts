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
	await page.getByRole('checkbox').first().click();
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
	await page.getByRole('checkbox').first().click();

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
	await page.getByRole('checkbox').first().click();

	await page.getByRole('button', { name: 'Finish' }).click();
	await expect(page.getByText('Save as a template?')).toBeVisible();
	await page.getByPlaceholder('Template name').fill('My New Split');
	await page.getByRole('button', { name: 'Save as template' }).click();
	await expect(page).toHaveURL(/\/history\//);

	await page.goto('/');
	await expect(page.getByRole('button', { name: /My New Split/ })).toBeVisible();
});

async function swipeOpen(page: import('@playwright/test').Page, rowLocator: import('@playwright/test').Locator) {
	const box = await rowLocator.boundingBox();
	if (!box) throw new Error('swipe row not found');
	// mid-row, not the right edge: the overflow trigger lives there and stops
	// pointer propagation, so a drag started on it is deliberately a tap
	const startX = box.x + box.width * 0.5;
	const y = box.y + box.height / 2;
	await page.mouse.move(startX, y);
	await page.mouse.down();
	await page.mouse.move(startX - 80, y, { steps: 5 });
	await page.mouse.move(startX - 160, y, { steps: 5 });
	await page.mouse.up();
}

test('swiping an exercise row reveals delete/swap; delete removes it', async ({ page }) => {
	await page.getByRole('button', { name: /Shoulder Core/ }).first().click();
	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await expect(page).toHaveURL(/\/workout/);

	const firstBlock = page.locator('.ex-block').first();
	await swipeOpen(page, firstBlock.locator('.swipe-content'));
	await expect(firstBlock.getByRole('button', { name: 'Swap' })).toBeVisible();
	await expect(firstBlock.getByRole('button', { name: 'Delete' })).toBeVisible();

	page.once('dialog', (d) => d.accept());
	await firstBlock.getByRole('button', { name: 'Delete' }).click();
	await expect(page.getByText('Dumbbell Shoulder Press')).toHaveCount(0);
	await expect(page.locator('.ex-name').first()).toHaveText('Cable Lateral Raise');
});

test('swiping and tapping Swap replaces the exercise', async ({ page }) => {
	await page.getByRole('button', { name: /Shoulder Core/ }).first().click();
	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await expect(page).toHaveURL(/\/workout/);

	const firstBlock = page.locator('.ex-block').first();
	await swipeOpen(page, firstBlock.locator('.swipe-content'));
	await firstBlock.getByRole('button', { name: 'Swap' }).click();
	await expect(page).toHaveURL(/\/picker\?to=workout&swap=0/);
	await expect(page.getByText('Swap Exercise')).toBeVisible();

	await page.getByRole('button', { name: /Dumbbell Bicep Curl/ }).click();
	await expect(page).toHaveURL(/\/workout/);
	await expect(page.locator('.ex-name').first()).toHaveText('Dumbbell Bicep Curl');
});

test('an in-progress workout resumes after a reload', async ({ page }) => {
	await page.getByRole('button', { name: /Legs/ }).first().click();
	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await expect(page).toHaveURL(/\/workout/);
	await page.getByRole('checkbox').first().click();
	await expect(page.locator('tr.row-done')).toHaveCount(1);

	// hard reload — the app should restore the session and land back in /workout
	await page.reload();
	await expect(page).toHaveURL(/\/workout/);
	await expect(page.locator('tr.row-done')).toHaveCount(1);
});

test('a set row can be added and swipe-deleted mid-workout', async ({ page }) => {
	await page.getByRole('button', { name: /Shoulder Core/ }).first().click();
	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await expect(page).toHaveURL(/\/workout/);

	const firstBlock = page.locator('.ex-block').first();
	const rows = firstBlock.locator('tbody tr');
	const before = await rows.count();

	// add a set
	await firstBlock.getByRole('button', { name: 'Add set' }).click();
	await expect(rows).toHaveCount(before + 1);

	// full-swipe the new last row left → it deletes (real mouse drag, matching
	// the pointer-gesture pattern the exercise-row swipe tests established)
	const row = rows.last();
	const box = (await row.boundingBox())!;
	// start away from the inputs: the row number cell on the left
	const startX = box.x + 40;
	const y = box.y + box.height / 2;
	await page.mouse.move(startX, y);
	await page.mouse.down();
	for (let i = 1; i <= 6; i++) await page.mouse.move(startX - i * 20, y);
	await page.mouse.up();
	await expect(rows).toHaveCount(before);

	// the last remaining set refuses to delete
	while ((await rows.count()) > 1) {
		const r = rows.last();
		const b = (await r.boundingBox())!;
		await page.mouse.move(b.x + 40, b.y + b.height / 2);
		await page.mouse.down();
		for (let i = 1; i <= 6; i++) await page.mouse.move(b.x + 40 - i * 20, b.y + b.height / 2);
		await page.mouse.up();
	}
	const lastRow = rows.first();
	const lb = (await lastRow.boundingBox())!;
	await page.mouse.move(lb.x + 40, lb.y + lb.height / 2);
	await page.mouse.down();
	for (let i = 1; i <= 6; i++) await page.mouse.move(lb.x + 40 - i * 20, lb.y + lb.height / 2);
	await page.mouse.up();
	await expect(rows).toHaveCount(1);
});

test('exercises can be reordered from the swipe actions', async ({ page }) => {
	// Use "Legs" — a superset-free template — so blocks map 1:1 to exercises and a
	// Move-down is an exact adjacent swap. (Moving past a superset correctly jumps the
	// whole group, so a grouped template can't assert a simple positional swap.)
	await page.getByRole('button', { name: /Legs/ }).first().click();
	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await expect(page).toHaveURL(/\/workout/);

	const names = page.locator('.ex-name');
	const blocks = page.locator('.ex-block');
	const count = await blocks.count();
	const first = (await names.nth(0).textContent())!;
	const second = (await names.nth(1).textContent())!;

	// Move exercise 0 down → it must SWAP with exercise 1 (full order asserted), and
	// the block count must be unchanged. The old test only checked "name at 0 changed",
	// which also passes if Move-down deletes the exercise or scrambles the list.
	await swipeOpen(page, blocks.first().locator('.swipe-content'));
	await blocks.first().getByRole('button', { name: 'Move down' }).click();
	await expect(blocks).toHaveCount(count);
	await expect(names.nth(0)).toHaveText(second);
	await expect(names.nth(1)).toHaveText(first);

	// Move it back up → the original order is fully restored.
	await swipeOpen(page, blocks.nth(1).locator('.swipe-content'));
	await blocks.nth(1).getByRole('button', { name: 'Move up' }).click();
	await expect(blocks).toHaveCount(count);
	await expect(names.nth(0)).toHaveText(first);
	await expect(names.nth(1)).toHaveText(second);
});

test('the rest timer starts even when logging out of the superset round order', async ({ page }) => {
	// Shoulder Core is a superset template — previously, completing a set while the
	// partner exercise's same-round set was incomplete suppressed the timer entirely.
	await page.getByRole('button', { name: /Shoulder Core/ }).first().click();
	await page.getByRole('button', { name: 'Start', exact: true }).click();
	await expect(page).toHaveURL(/\/workout/);

	// log the SECOND set of the first exercise (out of round order)
	const firstBlock = page.locator('.ex-block').first();
	await firstBlock.getByRole('checkbox').nth(1).click();
	await expect(page.locator('.rest-banner')).toBeVisible();
});
