// Asserts the VoiceOver-facing semantics actually exist in the RENDERED tree.
// Attributes are easy to add to the wrong element, so this checks the DOM the
// user's screen reader would see, not the source.
//   node scripts/verify-a11y-semantics.mjs      (after `npm run build:ios`)
import { chromium } from '@playwright/test';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const BUILD = resolve('build');
const PORT = 4324;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = await new Promise((res) => {
	const s = http.createServer(async (req, resp) => {
		try {
			const p = decodeURIComponent((req.url || '/').split('?')[0]);
			let f = join(BUILD, p);
			if (p.endsWith('/')) f = join(f, 'index.html');
			if (!(extname(f) && existsSync(f))) f = existsSync(f + '.html') ? f + '.html' : join(BUILD, 'index.html');
			resp.writeHead(200, { 'Content-Type': MIME[extname(f)] ?? 'application/octet-stream' });
			resp.end(await readFile(f));
		} catch { resp.writeHead(404); resp.end(); }
	});
	s.listen(PORT, () => res(s));
});

const NOW = Date.now(), day = 86_400_000;
const EX = 'b0000001-0000-4000-8000-000000000001';
const TPL = 'a0000001-0000-4000-8000-000000000001';
const SEED = {
	exercises: [{ id: EX, name: 'Barbell Bench Press', equipment: 'barbell', primaryMuscles: ['Chest'], secondaryMuscles: [], trackingType: 'weight_reps', loadType: 'total', defaultRestSec: 120, weightStep: 2.5, updatedAt: new Date(NOW - 30 * day).toISOString() }],
	templates: [{ id: TPL, name: 'Push Day', exercises: [{ exerciseId: EX, plannedSets: [{ targetReps: 8, targetWeight: 80, targetRestSec: 120 }, { targetReps: 8, targetWeight: 80, targetRestSec: 120 }] }], groups: [], createdAt: new Date(NOW - 30 * day).toISOString(), updatedAt: new Date(NOW - 5 * day).toISOString() }],
	settings: { id: 'singleton', defaultRestSec: 120, autoProgression: true, increments: { barbell: 2.5, dumbbellPerSide: 1, machinePin: 5 }, hapticAtRestEnd: true, trackRpe: true, writeToHealth: false, readRecoveryFromHealth: false, cloudSyncEnabled: false }
};
const ACTIVE = {
	session: { id: 'e0000000-0000-4000-8000-000000000001', startedAt: new Date(NOW - 18 * 60_000).toISOString(), sourceTemplateId: TPL, title: 'Push Day',
		exercises: [{ exerciseId: EX, sets: [
			{ index: 0, completed: true, weight: 82.5, reps: 8, rpe: 8 },
			{ index: 1, completed: false, weight: 82.5, reps: 8 }] }] },
	plannedRest: [[120, 120]], activeEx: 0, activeSet: 1,
	restRunning: true, restSeedSec: 120, restForSet: { ex: 0, set: 0 }, restStartedAtMs: NOW - 33_000, restAccumSec: 0
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2, colorScheme: 'light', serviceWorkers: 'block' });
const page = await ctx.newPage();
const base = `http://localhost:${PORT}`;
await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.evaluate(async (d) => {
	const db = await new Promise((res, rej) => { const r = indexedDB.open('buffy'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
	const stores = ['exercises', 'templates', 'sessions', 'settings', 'bodyweights'];
	await new Promise((res, rej) => {
		const tx = db.transaction(stores, 'readwrite');
		for (const s of stores) tx.objectStore(s).clear();
		for (const e of d.exercises) tx.objectStore('exercises').put(e);
		for (const t of d.templates) tx.objectStore('templates').put(t);
		tx.objectStore('settings').put(d.settings);
		tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
	});
	db.close(); localStorage.removeItem('buffy:activeWorkout');
}, SEED);

const results = [];
const check = (n, pass, d) => { results.push(pass); console.log(`${pass ? '✓' : '✗ FAIL'}  ${n} — ${d}`); };

// ── home
await page.goto(base + '/', { waitUntil: 'networkidle' }); await page.waitForTimeout(700);
check('home has an <h1>', await page.locator('h1').count() > 0, `${await page.locator('h1').count()} heading(s)`);

// ── settings
await page.goto(base + '/settings', { waitUntil: 'networkidle' }); await page.waitForTimeout(700);
const sw = await page.locator('[role="switch"]').count();
const swNamed = await page.evaluate(() => [...document.querySelectorAll('[role="switch"]')].filter((e) => e.getAttribute('aria-label') && e.hasAttribute('aria-checked')).length);
// Only 3 of the 6 switches render on web — Health x2 and iCloud sync live behind
// {#if isNative}. Assert every switch that IS rendered is fully described.
check('settings switches have role+state+name', sw >= 3 && swNamed === sw, `${sw} role=switch rendered (3 more are native-only), ${swNamed} with aria-checked AND aria-label`);
const unnamed = await page.evaluate(() => [...document.querySelectorAll('input:not([type=checkbox]):not([type=file])')].filter((e) => !e.getAttribute('aria-label') && !e.labels?.length && !e.getAttribute('placeholder')).length);
check('settings inputs all named', unnamed === 0, `${unnamed} unnamed input(s)`);
check('settings exposes headings', await page.locator('h1,h2').count() >= 5, `${await page.locator('h1,h2').count()} heading(s)`);

// ── live workout (seed a resumed session so the real set table renders)
await page.evaluate((s) => localStorage.setItem('buffy:activeWorkout', JSON.stringify(s)), ACTIVE);
await page.goto(base + '/workout', { waitUntil: 'networkidle' }); await page.waitForTimeout(900);
const cb = await page.locator('[role="checkbox"]').count();
const cbOk = await page.evaluate(() => [...document.querySelectorAll('[role="checkbox"]')].filter((e) => e.hasAttribute('aria-checked') && /set\s*\d/i.test(e.getAttribute('aria-label') || '')).length);
check('set circles are checkboxes with set number', cb > 0 && cbOk === cb, `${cb} role=checkbox, ${cbOk} named "Set N…" with aria-checked`);
const fieldsUnnamed = await page.evaluate(() => [...document.querySelectorAll('table.settable input')].filter((e) => !e.getAttribute('aria-label')).length);
const fieldsTotal = await page.locator('table.settable input').count();
check('every set-table field is named', fieldsTotal > 0 && fieldsUnnamed === 0, `${fieldsTotal} fields, ${fieldsUnnamed} unnamed`);
check('set table itself is labelled', await page.evaluate(() => !!document.querySelector('table.settable')?.getAttribute('aria-label')), await page.evaluate(() => document.querySelector('table.settable')?.getAttribute('aria-label') ?? 'MISSING'));
check('rest timer has a polite live region', await page.locator('[aria-live="polite"]').count() > 0, `${await page.locator('[aria-live="polite"]').count()} live region(s); digits hidden: ${await page.evaluate(() => document.querySelector('.rest-time')?.getAttribute('aria-hidden') === 'true')}`);
const removeBtn = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /remove (last )?set/i.test(b.getAttribute('aria-label') || b.textContent || '')).length);
check('non-gesture "Remove set" exists', removeBtn > 0, `${removeBtn} button(s)`);
// ── Phase 3: the move/swap/delete drawer must be reachable WITHOUT a drag
const trigger = page.locator('button[aria-label^="Actions for"]').first();
const hasTrigger = (await trigger.count()) > 0;
check('overflow trigger exists on each row', hasTrigger, hasTrigger ? await trigger.getAttribute('aria-label') : 'MISSING');
if (hasTrigger) {
	const inertBefore = await page.evaluate(() => document.querySelector('.swipe-actions')?.hasAttribute('inert'));
	check('drawer starts closed + inert', (await trigger.getAttribute('aria-expanded')) === 'false' && inertBefore === true, `aria-expanded=false, inert=${inertBefore}`);
	await trigger.click();
	await page.waitForTimeout(400);
	const inertAfter = await page.evaluate(() => document.querySelector('.swipe-actions')?.hasAttribute('inert'));
	const reachable = await page.evaluate(() => {
		const d = document.querySelector('.swipe-actions');
		if (!d || d.hasAttribute('inert')) return 0;
		return [...d.querySelectorAll('button')].filter((b) => (b.getAttribute('aria-label') || b.textContent || '').trim()).length;
	});
	check('trigger opens the drawer and un-inerts it', inertAfter === false && (await trigger.getAttribute('aria-expanded')) === 'true', `aria-expanded=true, inert=${inertAfter}`);
	check('all four actions become reachable', reachable >= 4, `${reachable} named action button(s) now in the tree`);
	await trigger.click();
	await page.waitForTimeout(400);
	check('trigger closes it again', (await trigger.getAttribute('aria-expanded')) === 'false', 'toggles back shut');

	// REGRESSION: the pointer drag is the sighted path and must be untouched by the
	// bindable/toggle work. Drag past the halfway threshold and it must settle open.
	// Start from mid-row, NOT the right edge: the overflow trigger lives there and
	// deliberately stops propagation, so a drag begun on it is a tap by design.
	const box = await page.locator('.swipe-content').first().boundingBox();
	const y = box.y + 30;
	await page.mouse.move(box.x + box.width * 0.45, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.45 - 180, y, { steps: 12 });
	await page.mouse.up();
	await page.waitForTimeout(450);
	const dragOpened = await page.evaluate(() => document.querySelector('.swipe-actions')?.hasAttribute('inert') === false);
	check('drag still opens the drawer (regression)', dragOpened, `inert=${!dragOpened}`);
	check('drag keeps aria-expanded in sync', (await trigger.getAttribute('aria-expanded')) === 'true', 'mirrored state tracks the gesture too');
	await trigger.click();
	await page.waitForTimeout(300);
}

// icons must be decorative, not noise
const iconsExposed = await page.evaluate(() => [...document.querySelectorAll('svg')].filter((s) => s.getAttribute('aria-hidden') !== 'true' && !s.getAttribute('aria-label') && s.getAttribute('role') !== 'img').length);
check('icons are decorative (not AT noise)', iconsExposed === 0, `${iconsExposed} unlabelled svg(s) still exposed`);

// ── picker chips. Clear the resumed workout first: +layout.svelte redirects to
// /workout whenever one is active, so navigating here would silently land there.
await page.evaluate(() => localStorage.removeItem('buffy:activeWorkout'));
await page.goto(base + '/picker', { waitUntil: 'networkidle' }); await page.waitForTimeout(900);
const chips = await page.locator('.chip').count();
const pressed = await page.locator('.chip[aria-pressed]').count();
check('filter chips expose selection', chips > 0 && pressed >= chips - 1, `${pressed}/${chips} chips with aria-pressed`);

await browser.close(); server.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} semantic checks passed`);
process.exit(failed ? 1 : 0);
