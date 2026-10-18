// Verifies the layout at the iPhone Duo's logical viewports against the PRODUCTION
// build, including the live resize that folding produces. There is no Duo simulator
// in the installed Xcode, and in any case the WebView is the whole UI — these are
// the exact point sizes iOS hands it once the app is built with the iOS 27.1 SDK.
//
//   node scripts/verify-duo-layout.mjs      (after `npm run build:ios`)
//   DUO_OUT=/some/dir  … to keep the screenshots somewhere other than a temp dir
//
// Numbers: inner display 669×951pt, outer display 466×678pt (both @3x — they are
// the App Store Connect screenshot sizes 2007×2853 and 1398×2034 exactly), Split View
// on the inner display ≈ 334pt. 320pt (iPhone SE) is the floor the app already has
// to survive; 440pt and 1280pt are controls for the two sides of the width band.
//
// What a failure means: a horizontal scrollbar on the Duo, a column that leaves
// gutters on one display or floats like a phone on the other, or a set table that
// no longer fits beside another app in Split View.
import { chromium } from '@playwright/test';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const BUILD = resolve('build');
const PORT = 4360;
const OUT = process.env.DUO_OUT ?? join(tmpdir(), 'buffy-duo-verify');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };

if (!existsSync(join(BUILD, 'index.html'))) {
	console.error('build/ is missing — run `npm run build:ios` first');
	process.exit(2);
}

const server = await new Promise((res) => {
	const s = http.createServer(async (rq, rs) => {
		try {
			const p = decodeURIComponent((rq.url || '/').split('?')[0]);
			let f = join(BUILD, p);
			if (p.endsWith('/')) f = join(f, 'index.html');
			if (!(extname(f) && existsSync(f))) f = existsSync(f + '.html') ? f + '.html' : join(BUILD, 'index.html');
			rs.writeHead(200, { 'Content-Type': MIME[extname(f)] ?? 'application/octet-stream' });
			rs.end(await readFile(f));
		} catch {
			rs.writeHead(404);
			rs.end();
		}
	});
	s.listen(PORT, () => res(s));
});
const base = `http://localhost:${PORT}`;

// The width band from app.css: at or below this the column fills the viewport.
const FILL_MAX = 700;
const COLUMN = 440;

const VIEWPORTS = [
	{ name: 'duo-outer', width: 466, height: 678, note: 'closed, portrait' },
	{ name: 'duo-inner', width: 669, height: 951, note: 'open, portrait' },
	{ name: 'duo-split', width: 334, height: 951, note: 'open, Split View half' },
	// 951pt is above the fill band on purpose: open-and-turned, the Duo gets the same
	// centred column an iPad landscape gets. Widening that column is an iPad/desktop
	// decision, not a Duo one.
	{ name: 'duo-inner-landscape', width: 951, height: 669, note: 'open, turned — floats like iPad' },
	{ name: 'se-floor', width: 320, height: 568, note: 'control: narrowest iPhone' },
	{ name: 'pro-max', width: 440, height: 956, note: 'control: widest flat iPhone' },
	{ name: 'desktop', width: 1280, height: 900, note: 'control: floating column' }
];

const ROUTES = ['/', '/picker?to=workout', '/trends', '/history', '/settings', '/workout'];

const failures = [];
const fail = (where, what) => {
	failures.push(`${where}: ${what}`);
	console.log(`  ✗ ${where}: ${what}`);
};

/** Everything that can overflow horizontally, measured where the OS would show a bar.
 *  A real function, not a string: page.evaluate() of an argument-less string that
 *  happens to be an arrow function returns the function object, serialised as
 *  undefined — which is how the first run of this script died. */
const measure = () => {
	const de = document.documentElement;
	const app = document.querySelector('.app');
	const bodies = [...document.querySelectorAll('.screen-body')];
	const tables = [...document.querySelectorAll('.settable')];
	return {
		vw: window.innerWidth,
		docOverflow: de.scrollWidth - de.clientWidth,
		appWidth: app ? app.getBoundingClientRect().width : null,
		bodyOverflow: bodies.map((b) => b.scrollWidth - b.clientWidth),
		tableOverflow: tables.map((t) => {
			const host = t.parentElement;
			return t.getBoundingClientRect().width - host.getBoundingClientRect().width;
		})
	};
};

function check(where, m) {
	if (m.docOverflow > 0) fail(where, `page scrolls horizontally by ${m.docOverflow}px`);
	m.bodyOverflow.forEach((o, i) => { if (o > 0) fail(where, `.screen-body[${i}] overflows by ${o}px`); });
	m.tableOverflow.forEach((o, i) => { if (o > 0.5) fail(where, `set table[${i}] wider than its card by ${o.toFixed(1)}px`); });
	if (m.appWidth == null) return fail(where, 'no .app element');
	const want = m.vw <= FILL_MAX ? m.vw : COLUMN;
	if (Math.abs(m.appWidth - want) > 0.5) {
		fail(where, `.app is ${m.appWidth}px wide, expected ${want}px (${m.vw <= FILL_MAX ? 'fill the viewport' : 'floating column'})`);
	}
}

/** Put the heaviest set table on screen: a per-side exercise (kg ×2 column) with RPE on. */
async function startWorkout(page) {
	await page.goto(base + '/', { waitUntil: 'networkidle' });
	await page.getByRole('button', { name: /Shoulder Core/ }).first().waitFor({ timeout: 20000 });
	await page.evaluate(async () => {
		const db = await new Promise((res, rej) => { const r = indexedDB.open('buffy'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
		await new Promise((res, rej) => {
			const tx = db.transaction('settings', 'readwrite');
			const st = tx.objectStore('settings');
			const g = st.get('singleton');
			g.onsuccess = () => { st.put({ ...(g.result ?? { id: 'singleton' }), trackRpe: true }); };
			tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
		});
		db.close();
		localStorage.removeItem('buffy:activeWorkout');
	});
	await page.reload({ waitUntil: 'networkidle' });
	await page.getByRole('button', { name: /Quick log a workout/ }).click();
	for (const name of [/Dumbbell Bicep Curl/, /Incline Bench Press/]) {
		await page.getByRole('button', { name: /Add exercise/ }).click();
		await page.getByRole('button', { name }).click();
		await page.waitForURL(/\/workout/);
	}
	await page.waitForTimeout(400);
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
try {
	for (const vp of VIEWPORTS) {
		console.log(`\n── ${vp.name}  ${vp.width}×${vp.height}  (${vp.note})`);
		const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, colorScheme: 'light', serviceWorkers: 'block' });
		const page = await ctx.newPage();
		page.on('pageerror', (e) => fail(`${vp.name} pageerror`, e.message));

		for (const route of ROUTES) {
			if (route === '/workout') await startWorkout(page);
			else await page.goto(base + route, { waitUntil: 'networkidle' });
			await page.waitForTimeout(500);
			const m = await page.evaluate(measure);
			check(`${vp.name} ${route}`, m);
			const file = join(OUT, `${vp.name}${route.replace(/[^a-z]+/gi, '-').replace(/-$/, '') || '-home'}.png`);
			await page.screenshot({ path: file });
		}

		// The fold: iOS resizes the window continuously between poses. Stay on the
		// workout screen (the densest one) and walk closed → open → Split View → closed.
		if (vp.name === 'duo-outer') {
			const poses = [
				{ w: 669, h: 951, label: 'open' },
				{ w: 334, h: 951, label: 'split view' },
				{ w: 951, h: 669, label: 'open landscape' },
				{ w: 466, h: 678, label: 'closed again' }
			];
			console.log('   fold transition on /workout:');
			for (const p of poses) {
				await page.setViewportSize({ width: p.w, height: p.h });
				await page.waitForTimeout(350);
				const m = await page.evaluate(measure);
				check(`fold→${p.label} ${p.w}×${p.h}`, m);
				await page.screenshot({ path: join(OUT, `fold-${p.label.replace(/\s+/g, '-')}.png`) });
				console.log(`   ${p.label.padEnd(16)} .app=${m.appWidth}px docOverflow=${m.docOverflow} tableOverflow=${m.tableOverflow.map((n) => n.toFixed(0)).join(',') || '-'}`);
			}
		}
		await ctx.close();
	}

	// ── Safe-area insets ────────────────────────────────────────────────────────
	// Chromium reports every env(safe-area-inset-*) as 0, so nothing above can see
	// how the side insets behave — which is how a regression slipped through: the
	// insets were applied unconditionally, squeezing the centred 440pt column by
	// ~118pt in iPhone landscape, where that column already clears the notch.
	// Simulate real insets by rewriting env() in the built CSS as it is served,
	// then read the computed padding the browser actually resolves.
	console.log('\n── safe-area insets (env() rewritten in the served CSS)');
	const INSET_CASES = [
		// floating column: margins already clear the notch, so NO side padding
		{ name: 'iphone-landscape', w: 932, h: 430, inset: { top: 0, right: 59, bottom: 21, left: 59 }, wantSide: { left: 0, right: 0 } },
		// fill band, asymmetric: pad exactly the inset side, never mirror it
		{ name: 'duo-outer-asym', w: 466, h: 678, inset: { top: 48, right: 28, bottom: 21, left: 0 }, wantSide: { left: 0, right: 28 } },
		{ name: 'duo-split-asym', w: 334, h: 951, inset: { top: 48, right: 0, bottom: 21, left: 24 }, wantSide: { left: 24, right: 0 } }
	];
	for (const c of INSET_CASES) {
		const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, deviceScaleFactor: 2, colorScheme: 'light', serviceWorkers: 'block' });
		await ctx.route('**/*.css', async (route) => {
			const res = await route.fetch();
			const css = (await res.text()).replace(
				/env\(\s*safe-area-inset-(top|right|bottom|left)\s*(?:,[^)]*)?\)/g,
				(_, side) => `${c.inset[side]}px`
			);
			await route.fulfill({ response: res, body: css });
		});
		const page = await ctx.newPage();
		await page.goto(base + '/', { waitUntil: 'networkidle' });
		await page.waitForTimeout(400);
		const got = await page.evaluate(() => {
			const px = (v) => parseFloat(v) || 0;
			const screen = document.querySelector('.screen');
			const s = screen ? getComputedStyle(screen) : null;
			// the sheet only exists while open; a detached probe reads the same rules
			const probe = document.createElement('div');
			probe.className = 'sheet';
			document.body.appendChild(probe);
			const p = getComputedStyle(probe);
			const out = {
				screen: s ? { left: px(s.paddingLeft), right: px(s.paddingRight), width: screen.getBoundingClientRect().width } : null,
				sheet: { left: px(p.paddingLeft), right: px(p.paddingRight) }
			};
			probe.remove();
			return out;
		});
		const where = `insets ${c.name} ${c.w}×${c.h}`;
		if (!got.screen) fail(where, 'no .screen on /');
		else {
			if (got.screen.left !== c.wantSide.left || got.screen.right !== c.wantSide.right)
				fail(where, `.screen side padding ${got.screen.left}/${got.screen.right}px, expected ${c.wantSide.left}/${c.wantSide.right}px`);
			// the sheet keeps its own 20px gutter and adds the same inset on top
			const wantSheet = { left: 20 + c.wantSide.left, right: 20 + c.wantSide.right };
			if (got.sheet.left !== wantSheet.left || got.sheet.right !== wantSheet.right)
				fail(where, `.sheet side padding ${got.sheet.left}/${got.sheet.right}px, expected ${wantSheet.left}/${wantSheet.right}px`);
		}
		console.log(`   ${c.name.padEnd(17)} .screen L/R=${got.screen?.left}/${got.screen?.right} width=${got.screen?.width}  .sheet L/R=${got.sheet.left}/${got.sheet.right}`);
		await page.screenshot({ path: join(OUT, `insets-${c.name}.png`) });
		await ctx.close();
	}
} finally {
	await browser.close();
	server.close();
}

console.log(`\nscreenshots: ${OUT}`);
if (failures.length) {
	console.log(`\n${failures.length} failure(s)`);
	process.exit(1);
}
console.log('\nduo layout: all viewports, the fold transition and the safe-area insets pass');
