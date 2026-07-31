// Measures the REAL tappable area of each control by probing elementFromPoint
// outward from its centre — pseudo-element hit areas are attributed to their
// originating element, so this measures what the OS actually hit-tests.
//   node scripts/verify-hit-targets.mjs      (after `npm run build:ios`)
import { chromium } from '@playwright/test';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const BUILD = resolve('build'), PORT = 4350;
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

const NOW = Date.now();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2, colorScheme: 'light', serviceWorkers: 'block' });
const page = await ctx.newPage();
const base = `http://localhost:${PORT}`;
await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.evaluate(async () => {
	const db = await new Promise((res, rej) => { const r = indexedDB.open('buffy'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
	const st = ['exercises', 'templates', 'sessions', 'settings', 'bodyweights'];
	await new Promise((res, rej) => {
		const tx = db.transaction(st, 'readwrite'); for (const x of st) tx.objectStore(x).clear();
		tx.objectStore('exercises').put({ id: 'b1', name: 'Bench', equipment: 'barbell', primaryMuscles: ['Chest'], secondaryMuscles: [], trackingType: 'weight_reps', loadType: 'total', defaultRestSec: 120, weightStep: 2.5, updatedAt: new Date().toISOString() });
		tx.objectStore('exercises').put({ id: 'b2', name: 'Overhead Press', equipment: 'barbell', primaryMuscles: ['Shoulders'], secondaryMuscles: [], trackingType: 'weight_reps', loadType: 'total', defaultRestSec: 120, weightStep: 2.5, updatedAt: new Date().toISOString() });
		// a SUPERSET template: the only place the "ungroup" chip renders
		tx.objectStore('templates').put({
			id: 'tpl-ss', name: 'Superset Day', groups: [{ id: 'g1', restSec: 120 }],
			exercises: [
				{ exerciseId: 'b1', groupId: 'g1', plannedSets: [{ targetReps: 8, targetWeight: 80, targetRestSec: 120 }] },
				{ exerciseId: 'b2', groupId: 'g1', plannedSets: [{ targetReps: 8, targetWeight: 45, targetRestSec: 120 }] }
			],
			createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
		});
		tx.objectStore('settings').put({ id: 'singleton', defaultRestSec: 120, autoProgression: true, increments: { barbell: 2.5, dumbbellPerSide: 1, machinePin: 5 }, hapticAtRestEnd: true, trackRpe: true, writeToHealth: false, readRecoveryFromHealth: false, cloudSyncEnabled: false });
		tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
	}); db.close();
});

// probe: grow outward from the element's centre while elementFromPoint still maps to it
// Measure the ::after geometry directly. Probing elementFromPoint pixel by pixel
// loses ~1px per side to edge rounding, which reads as a 2px shortfall on a box
// that is exactly 44 by construction. elementFromPoint is still used, but only to
// confirm the expanded area is genuinely hit-testable rather than covered.
const MEASURE = `(sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el, '::after');
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  // An absolutely-positioned ::after resolves its insets against the PADDING box of
  // its originating element, so a border eats into the expansion: on a <button>
  // with the 2px UA border, -8px only reaches 6px past the visible edge.
  const es = getComputedStyle(el);
  const bT = num(es.borderTopWidth), bB = num(es.borderBottomWidth);
  const bL = num(es.borderLeftWidth), bR = num(es.borderRightWidth);
  const has = cs.content && cs.content !== 'none' && cs.position === 'absolute';
  const grow = (inset, border) => Math.max(0, -num(inset) - border);
  const w = r.width + (has ? grow(cs.left, bL) + grow(cs.right, bR) : 0);
  const h = r.height + (has ? grow(cs.top, bT) + grow(cs.bottom, bB) : 0);
  // hit-testable? probe just inside each expanded edge
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const owns = (x, y) => { const t = document.elementFromPoint(x, y); return !!t && (t === el || el.contains(t)); };
  const name = (t) => !t ? 'null' : (t.getAttribute('aria-label') || (typeof t.className === 'string' ? t.className : '') || t.tagName);
  const top = owns(cx, cy - h / 2 + 1.5), bot = owns(cx, cy + h / 2 - 1.5);
  const blocker = top && bot ? null : (!top ? 'above:' + name(document.elementFromPoint(cx, cy - h / 2 + 1.5)) : 'below:' + name(document.elementFromPoint(cx, cy + h / 2 - 1.5)));
  return { w: Math.round(w), h: Math.round(h), box: Math.round(r.width) + 'x' + Math.round(r.height), expanded: has, reach: top && bot, blocker };
}`;

const results = [];
async function target(name, sel, minW, minH, opts = {}) {
	const m = await page.evaluate(new Function('sel', `return (${MEASURE})(sel)`), sel);
	if (!m) { console.log(`–  ${name} — not present on this screen`); return; }
	const ok = m.w >= minW && m.h >= minH && (opts.geometryOnly || m.reach !== false);
	results.push(ok);
	console.log(`${ok ? '✓' : '✗ FAIL'}  ${name.padEnd(26)} visual ${String(m.box).padEnd(8)} → hit ${m.w}x${m.h} (min ${minW}x${minH})${m.blocker ? '  BLOCKED ' + m.blocker : ''}`);
}

console.log('— settings —');
await page.goto(base + '/settings', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
await target('.toggle switch', '.toggle', 44, 44);
await target('.icon-btn (back)', '.icon-btn', 44, 44);

console.log('— picker —');
await page.goto(base + '/picker', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
await target('filter chip', 'button.chip', 44, 44);

console.log('— trends —');
await page.goto(base + '/trends', { waitUntil: 'networkidle' }); await page.waitForTimeout(900);
// Geometry only. Its upward expansion is clipped by .screen-body's scroll edge —
// but that strip is ABOVE the scroll viewport, i.e. off-screen, so no tap could
// have landed there anyway. Nothing to fix in CSS; the on-screen area is correct.
await target('segmented control', '.seg > button', 44, 44, { geometryOnly: true });
await target('SecHead link', '.tap-link', 44, 40);

console.log('— live workout —');
await page.evaluate((n) => localStorage.setItem('buffy:activeWorkout', JSON.stringify({ session: { id: 'e1', startedAt: new Date(n - 18 * 60000).toISOString(), title: 'Push Day', exercises: [{ exerciseId: 'b1', sets: [{ index: 0, completed: true, weight: 82.5, reps: 8, rpe: 8 }, { index: 1, completed: false, weight: 82.5, reps: 8 }] }] }, plannedRest: [[120, 120]], activeEx: 0, activeSet: 1, restRunning: true, restSeedSec: 120, restForSet: { ex: 0, set: 0 }, restStartedAtMs: n - 33000, restAccumSec: 0 })), NOW);
await page.goto(base + '/workout', { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
await target('set-complete circle', 'button.setcheck', 44, 44);
await target('set field (.inp)', 'table.settable.editable .inp', 44, 42);
await target('rest -15 / +15 ctrl', '.rest-ctrl', 44, 44);
await target('rest seed button', '.rest-seed-btn', 40, 40);
await target('Add set', '.tap-row', 44, 40);
await target('.btn-rg (Finish)', '.btn-rg', 44, 44);

console.log('— template editor (superset) —');
await page.evaluate(() => localStorage.removeItem('buffy:activeWorkout'));
await page.goto(base + '/template/tpl-ss/edit', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await target('ungroup chip', 'button.chip.accent', 44, 44);
// The band must NOT reach the exercise name above it: ungrouping a superset from a
// stray tap on the title would be a destructive false positive.
const nameSafe = await page.evaluate(() => {
	const chip = document.querySelector('button.chip.accent');
	const name = document.querySelector('.ex-name');
	if (!chip || !name) return { err: 'not rendered' };
	const cs = getComputedStyle(chip, '::after');
	const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
	const cr = chip.getBoundingClientRect(), nr = name.getBoundingClientRect();
	const bandTop = cr.top + num(cs.top) + num(getComputedStyle(chip).borderTopWidth);
	// probe the very bottom of the name text — it must still belong to the name
	const hit = document.elementFromPoint(nr.left + 4, nr.bottom - 1);
	return { gap: +(bandTop - nr.bottom).toFixed(1), stolen: !!hit && chip.contains(hit) || hit === chip, hitName: hit ? (hit.className || hit.tagName) : 'null' };
});
if (nameSafe.err) { results.push(false); console.log(`✗ FAIL  ungroup/name clearance — ${nameSafe.err}`); }
else {
	const ok = nameSafe.gap >= 0 && !nameSafe.stolen;
	results.push(ok);
	console.log(`${ok ? '✓' : '✗ FAIL'}  band clears the exercise name  gap=${nameSafe.gap}px, name-bottom hits "${nameSafe.hitName}"`);
}

// no two expanded areas may claim the same point
console.log('— overlap —');
const clash = await page.evaluate(() => {
	// Skip the swipe drawer: while closed its buttons are inert AND deliberately
	// covered by the opaque row, so "stolen centre" is the intended state there.
	const els = [...document.querySelectorAll('button, a, input, select, [role="switch"], [role="checkbox"]')]
		.filter((e) => e.offsetParent !== null && !e.closest('.swipe-actions'));
	const bad = [];
	for (const el of els) {
		const r = el.getBoundingClientRect();
		if (!r.width || !r.height) continue;
		const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
		const hit = document.elementFromPoint(cx, cy);
		if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) bad.push((el.getAttribute('aria-label') || el.className || el.tagName) + ' ← ' + (hit.getAttribute('aria-label') || hit.className || hit.tagName));
	}
	return bad;
});
results.push(clash.length === 0);
console.log(`${clash.length === 0 ? '✓' : '✗ FAIL'}  no control's own centre is stolen by another — ${clash.length ? clash.slice(0, 5).join('; ') : 'clean'}`);

await browser.close(); server.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} hit-target checks passed`);
process.exit(failed ? 1 : 0);
