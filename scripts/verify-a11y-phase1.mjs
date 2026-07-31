// Phase-1 verification. Serves build/ and measures the real geometry that the
// audit findings were about. Run after `npm run build:ios`:
//   node scripts/verify-a11y-phase1.mjs
import { chromium } from '@playwright/test';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const BUILD = resolve('build');
const PORT = 4322;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain' };

function serve() {
	return new Promise((res) => {
		const s = http.createServer(async (req, resp) => {
			try {
				const p = decodeURIComponent((req.url || '/').split('?')[0]);
				let file = join(BUILD, p);
				if (p.endsWith('/')) file = join(file, 'index.html');
				if (extname(file) && existsSync(file)) { /* asset */ }
				else if (existsSync(file + '.html')) file = file + '.html';
				else if (!extname(file) || !existsSync(file)) file = join(BUILD, 'index.html');
				const body = await readFile(file);
				resp.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
				resp.end(body);
			} catch { resp.writeHead(404); resp.end(); }
		});
		s.listen(PORT, () => res(s));
	});
}

const NOW = Date.now(), day = 86_400_000;
const EX = 'b0000001-0000-4000-8000-000000000001';
const TPL = 'a0000001-0000-4000-8000-000000000001';
const SEED = {
	exercises: [{ id: EX, name: 'Barbell Bench Press', equipment: 'barbell', primaryMuscles: ['Chest'], secondaryMuscles: [], trackingType: 'weight_reps', loadType: 'total', defaultRestSec: 120, weightStep: 2.5, updatedAt: new Date(NOW - 30 * day).toISOString() }],
	templates: [{ id: TPL, name: 'Push Day', exercises: [{ exerciseId: EX, plannedSets: [{ targetReps: 8, targetWeight: 80, targetRestSec: 120 }, { targetReps: 8, targetWeight: 80, targetRestSec: 120 }] }], groups: [], createdAt: new Date(NOW - 30 * day).toISOString(), updatedAt: new Date(NOW - 5 * day).toISOString() }],
	sessions: [], bodyweights: [],
	settings: { id: 'singleton', defaultRestSec: 120, autoProgression: true, increments: { barbell: 2.5, dumbbellPerSide: 1, machinePin: 5 }, hapticAtRestEnd: true, writeToHealth: false, readRecoveryFromHealth: false, cloudSyncEnabled: false }
};

const results = [];
const check = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? '✓' : '✗ FAIL'}  ${name} — ${detail}`); };

const server = await serve();
const base = `http://localhost:${PORT}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2, colorScheme: 'light', serviceWorkers: 'block' });
const page = await ctx.newPage();

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

// ── 1. action-bar clearance: spacer must be >= bar height, on every screen that has one
for (const [route, label] of [[`/template/${TPL}`, 'template detail'], [`/template/${TPL}/progression`, 'progression']]) {
	await page.goto(base + route, { waitUntil: 'networkidle' });
	await page.waitForTimeout(700);
	const m = await page.evaluate(() => {
		const bar = document.querySelector('.actionbar');
		const sp = document.querySelector('.actionbar-clear');
		return { bar: bar ? bar.getBoundingClientRect().height : null, spacer: sp ? sp.getBoundingClientRect().height : null };
	});
	if (m.bar == null) { check(`${label}: action bar present`, false, 'no .actionbar found'); continue; }
	check(`${label}: spacer clears the bar`, m.spacer != null && m.spacer >= m.bar,
		`bar ${m.bar}px, spacer ${m.spacer}px, slack ${m.spacer != null ? (m.spacer - m.bar).toFixed(0) : '?'}px (constant on notched devices — both include the same env() term)`);
}

// ── 2. search wrapper: the whole 44pt box must focus the input (was ~20pt of live area)
await page.goto(base + '/picker', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
const sr = await page.evaluate(() => {
	const w = document.querySelector('.search');
	if (!w) return null;
	const r = w.getBoundingClientRect();
	return { tag: w.tagName, h: r.height, x: r.x + r.width - 12, yTop: r.y + 4, yBot: r.y + r.height - 4 };
});
if (!sr) check('picker search wrapper', false, 'not found');
else {
	await page.mouse.click(sr.x, sr.yBot); // bottom strip = previously dead padding
	const focused = await page.evaluate(() => document.activeElement?.tagName);
	check('picker search: bottom padding focuses the input', focused === 'INPUT', `<${sr.tag.toLowerCase()}> ${sr.h}px tall, click near bottom edge → activeElement=${focused}`);
}

// ── 3. invisible <select> overlay must cover its whole row, not just the top ~21px
await page.goto(base + '/exercise/new', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
const sel = await page.evaluate(() => {
	const s = document.querySelector('select[aria-label="Primary muscle"]');
	if (!s) return null;
	const sr = s.getBoundingClientRect();
	const row = s.parentElement.getBoundingClientRect();
	return { selH: sr.height, rowH: row.height, appearance: getComputedStyle(s).webkitAppearance || getComputedStyle(s).appearance };
});
if (!sel) check('muscle select overlay', false, 'not found');
else check('muscle select covers its row', Math.abs(sel.selH - sel.rowH) < 1.5, `select ${sel.selH.toFixed(1)}px vs row ${sel.rowH.toFixed(1)}px, appearance=${sel.appearance}`);

// ── 4. the dead meta must be gone
const meta = await page.evaluate(() => !!document.querySelector('meta[name="text-scale"]'));
check('dead text-scale meta removed', meta === false, meta ? 'still present' : 'absent');

await browser.close(); server.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
