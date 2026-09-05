import { expect, type Page } from '@playwright/test';

/**
 * Start a spec from a clean, FULLY SEEDED home screen. Shared by every spec so the
 * template name and the 20s budget below get tuned in one place.
 */
export async function freshHome(page: Page) {
	await page.goto('/');
	// clear any in-progress workout so the layout doesn't auto-resume into /workout
	await page.evaluate(() => localStorage.removeItem('buffy:activeWorkout'));
	await page.reload();
	await expect(page.getByRole('button', { name: /Quick log a workout/ })).toBeVisible();
	// …and wait for real DATA, not just the static shell. The catalog and default
	// templates seed into IndexedDB on first load and the home list fills from an
	// async onMount, so the Quick-log button paints well before any template exists.
	// Only the COLD first run of a fresh build loses that race, which is precisely
	// the run the ship pipeline performs.
	await expect(page.getByRole('button', { name: /Shoulder Core/ }).first()).toBeVisible({
		timeout: 20000
	});
}
