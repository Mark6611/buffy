// Dynamic Type gate. Chromium cannot resolve font: -apple-system-body, so this
// simulates the scaled states by overriding --dt-base directly (the same token
// the @supports block drives in WKWebView) and hunts for what scaling breaks:
// horizontal overflow, text clipped by an overflow-hidden ancestor, and controls
// shorter than their own content.
//   node scripts/verify-dynamic-type.mjs      (after `npm run build:ios`)
import { chromium } from '@playwright/test';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const BUILD = resolve('build'), PORT = 4370;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = await new Promise((res) => {
	const s = http.createServer(async (rq, rs) => {
		try {
			const p = decodeURIComponent((rq.url || '/').split('?')[0]);
			let f = join(BUILD, p);
			if (p.endsWith('/')) f = join(f, 'index.html');
			if (!(extname(f) && existsSync(f))) f = existsSync(f + '.html') ? f + '.html' : join(BUILD, 'index.html');
			rs.writeHead(200, { 'Content-Type': MIME[extname(f)] ?? 'application/octet-stream' });
			rs.end(await readFile(f));
		} catch { rs.writeHead(404); rs.end(); }
	});
	s.listen(PORT, () => res(s));
});

const NOW = Date.now(), day = 86_400_000;
const EX = 'b1', TPL = 't1';
const SEED = {
	exercises: [
		{ id: EX, name: 'Barbell Bench Press', equipment: 'barbell', primaryMuscles: ['Chest'], secondaryMuscles: [], trackingType: 'weight_reps', loadType: 'total', defaultRestSec: 120, weightStep: 2.5, updatedAt: new Date(NOW - 30 * day).toISOString() },
		{ id: 'row1', name: 'Rowing Machine', equipment: 'cardio', primaryMuscles: ['Full Body'], secondaryMuscles: [], trackingType: 'cardio', loadType: 'total', cardioMetric: 'distance', defaultRestSec: 120, updatedAt: new Date(NOW - 30 * day).toISOString() }
	],
	templates: [{ id: TPL, name: 'Push Day', exercises: [
		{ exerciseId: EX, plannedSets: [{ targetReps: 8, targetWeight: 82.5, targetRestSec: 120 }, { targetReps: 8, targetWeight: 82.5, targetRestSec: 120 }] },
		{ exerciseId: 'row1', plannedSets: [{ targetTimeSec: 480, targetDistanceMeters: 2000, targetRestSec: 120 }] }
	], groups: [], createdAt: new Date(NOW - 30 * day).toISOString(), updatedAt: new Date(NOW - 5 * day).toISOString() }],
	sessions: [{ id: 's1', startedAt: new Date(NOW - 2 * day).toISOString(), endedAt: new Date(NOW - 2 * day + 3600e3).toISOString(), sourceTemplateId: TPL, title: 'Push Day', exercises: [{ exerciseId: EX, sets: [{ index: 0, completed: true, weight: 82.5, reps: 8, rpe: 8 }] }], updatedAt: new Date(NOW - 2 * day).toISOString() }],
	bodyweights: [{ id: 'bw1', at: new Date(NOW - day).toISOString(), kg: 81.4 }],
	settings: { id: 'singleton', defaultRestSec: 120, autoProgression: true, increments: { barbell: 2.5, dumbbellPerSide: 1, machinePin: 5 }, hapticAtRestEnd: true, trackRpe: true, writeToHealth: false, readRecoveryFromHealth: false, cloudSyncEnabled: false }
};
const ACTIVE = { session: { id: 'e1', startedAt: new Date(NOW - 18 * 60e3).toISOString(), sourceTemplateId: TPL, title: 'Push Day', exercises: [{ exerciseId: EX, sets: [{ index: 0, completed: true, weight: 82.5, reps: 8, rpe: 8 }, { index: 1, completed: false, weight: 82.5, reps: 8 }] }] }, plannedRest: [[120, 120]], activeEx: 0, activeSet: 1, restRunning: true, restSeedSec: 120, restForSet: { ex: 0, set: 0 }, restStartedAtMs: NOW - 33e3, restAccumSec: 0 };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2, colorScheme: 'light', serviceWorkers: 'block' });
const page = await ctx.newPage();
const base = `http://localhost:${PORT}`;
await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.evaluate(async (d) => {
	const db = await new Promise((res, rej) => { const r = indexedDB.open('buffy'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
	const st = ['exercises', 'templates', 'sessions', 'settings', 'bodyweights'];
	await new Promise((res, rej) => {
		const tx = db.transaction(st, 'readwrite');
		for (const s of st) tx.objectStore(s).clear();
		for (const e of d.exercises) tx.objectStore('exercises').put(e);
		for (const t of d.templates) tx.objectStore('templates').put(t);
		for (const s of d.sessions) tx.objectStore('sessions').put(s);
		for (const b of d.bodyweights) tx.objectStore('bodyweights').put(b);
		tx.objectStore('settings').put(d.settings);
		tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
	});
	db.close(); localStorage.removeItem('buffy:activeWorkout');
}, SEED);

const SCREENS = [
	['/', 'home', false],
	['/picker', 'picker', false],
	['/settings', 'settings', false],
	[`/template/${TPL}`, 'template', false],
	[`/template/${TPL}/edit`, 'template-edit', false],
	['/trends', 'trends', false],
	['/history/s1', 'history', false],
	['/workout', 'workout', true],
];

const PROBE = `() => {
	const bad = [];
	// 1. horizontal overflow of the app column
	const app = document.querySelector('.app');
	if (app && app.scrollWidth > app.clientWidth + 1) bad.push('app column overflows horizontally: ' + app.scrollWidth + '>' + app.clientWidth);
	for (const sb of document.querySelectorAll('.screen-body'))
		if (sb.scrollWidth > sb.clientWidth + 1) bad.push('screen-body horizontal overflow: ' + sb.scrollWidth + '>' + sb.clientWidth);
	// 2. text clipped inside a fixed-height, overflow-hidden ancestor (skip deliberate
	//    truncation: white-space nowrap + text-overflow ellipsis, and the sr-only trick)
	for (const el of document.querySelectorAll('button, .btn, .chip, .inp, .h-app, .h-sec, .h-card, .txt, .txt-sm, td, th, label')) {
		const cs = getComputedStyle(el);
		if (cs.display === 'none' || el.closest('.sr-only')) continue;
		if (cs.textOverflow === 'ellipsis' || cs.whiteSpace === 'nowrap') continue;
		if (el.scrollHeight > el.clientHeight + 3 && cs.overflowY === 'hidden') bad.push('clipped: ' + (el.className || el.tagName) + ' ' + el.scrollHeight + '>' + el.clientHeight);
	}
	// 3. buttons whose REAL content exceeds the box. Measured via a Range over the
	//    child nodes: scrollHeight would also count the ::after hit-expansion boxes
	//    (their negative bottom insets extend past the padding box) and report
	//    every guarded control as overflowing even at the default scale.
	for (const b of document.querySelectorAll('.btn, button.chip')) {
		if (!b.childNodes.length) continue;
		const r = document.createRange();
		r.selectNodeContents(b);
		const cr = r.getBoundingClientRect(), br = b.getBoundingClientRect();
		if (cr.height > br.height + 2 || cr.width > br.width + 2)
			bad.push('button content overflow: ' + (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30));
	}
	return bad;
}`;

let failures = 0;
for (const [factor, label] of [[17, 'default 1.0x'], [21, 'large 1.24x'], [26, 'AX cap 1.53x']]) {
	console.log(`— scale ${label} —`);
	for (const [route, name, active] of SCREENS) {
		if (active) await page.evaluate((s) => localStorage.setItem('buffy:activeWorkout', JSON.stringify(s)), ACTIVE);
		else await page.evaluate(() => localStorage.removeItem('buffy:activeWorkout'));
		await page.goto(base + route, { waitUntil: 'networkidle' });
		await page.addStyleTag({ content: `:root { --dt-base: ${factor}px !important; }` });
		await page.waitForTimeout(500);
		const bad = await page.evaluate(new Function('return (' + PROBE + ')()'));
		if (bad.length) { failures += bad.length; console.log(`  ✗ ${name}: ${bad.slice(0, 4).join(' | ')}`); }
		else console.log(`  ✓ ${name}`);
	}
}
await browser.close(); server.close();
console.log(failures === 0 ? '\nDYNAMIC TYPE GATE: clean at all scales' : `\n${failures} scaling issue(s)`);
process.exit(failures ? 1 : 0);
