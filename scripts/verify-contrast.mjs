// WCAG contrast gate. Resolves Buffy's oklch() tokens through a real browser
// (so the oklch->sRGB conversion is WebKit/Blink's, not hand arithmetic) and
// asserts every pairing the UI actually renders.
//   node scripts/verify-contrast.mjs      (after `npm run build:ios`)
import { chromium } from '@playwright/test';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const BUILD = resolve('build');
const PORT = 4323;
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

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// AA: 4.5 for normal text, 3.0 for large text (>=24px, or >=18.66px bold) and for
// UI component boundaries (SC 1.4.11).
const PAIRS = [
	// [label, foreground, background, min, note]
	['body text .txt / .ex-name', 'var(--ink)', 'var(--surface)', 4.5],
	['secondary --ink-2', 'var(--ink-2)', 'var(--surface)', 4.5],
	['tertiary --ink-3 on card', 'var(--ink-3)', 'var(--surface)', 4.5],
	['tertiary --ink-3 on page', 'var(--ink-3)', 'var(--paper)', 4.5],
	['tertiary --ink-3 on inset', 'var(--ink-3)', 'var(--surface-2)', 4.5],
	['tertiary --ink-3 on ACTIVE row', 'var(--ink-3)', 'var(--accent-tint)', 4.5],
	['accent ink on tint', 'var(--accent-ink)', 'var(--accent-tint)', 4.5],
	['white on .btn-accent fill', '#ffffff', 'var(--accent-solid)', 4.5],
	['white on .btn-accent PRESSED', '#ffffff', 'var(--accent-press)', 4.5],
	['white on .rest-banner.warn', '#ffffff', 'var(--warn)', 4.5],
	['--warn text on --warn-tint', 'var(--warn)', 'var(--warn-tint)', 4.5],
	['toggle-off boundary', 'var(--control-line)', 'var(--surface)', 3.0],
	['toggle-off boundary on page', 'var(--control-line)', 'var(--paper)', 3.0],
	['setcheck ring (idle)', 'var(--control-line)', 'var(--surface)', 3.0],
	['setcheck ring on ACTIVE row', 'var(--accent-ink)', 'var(--accent-tint)', 3.0],
];

const out = await page.evaluate(
	({ pairs }) => {
		const probe = document.createElement('div');
		document.body.appendChild(probe);
		// Rasterize through a canvas rather than parsing getComputedStyle: WebKit and
		// Chromium both return oklch() verbatim as the computed value, and scraping the
		// three numbers out of "oklch(0.24 0.012 60)" silently yields rgb(0,0,60).
		const cv = document.createElement('canvas');
		cv.width = cv.height = 1;
		const cx = cv.getContext('2d', { willReadFrequently: true });
		const toRgb = (v) => {
			probe.style.color = '';
			probe.style.color = v;
			const computed = getComputedStyle(probe).color;
			cx.clearRect(0, 0, 1, 1);
			cx.fillStyle = '#000';
			cx.fillStyle = computed;
			cx.fillRect(0, 0, 1, 1);
			const d = cx.getImageData(0, 0, 1, 1).data;
			return [d[0], d[1], d[2]];
		};
		const lum = ([r, g, b]) =>
			0.2126 * ((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))(r / 255) +
			0.7152 * ((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))(g / 255) +
			0.0722 * ((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))(b / 255);
		const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
		const over = (fg, a, bg) => fg.map((c, i) => c * a + bg[i] * (1 - a)); // alpha composite
		const res = pairs.map(([label, f, b, min]) => ({ label, min, ratio: ratio(toRgb(f), toRgb(b)), fg: toRgb(f), bg: toRgb(b) }));
		// composites the token list cannot express
		const solid = toRgb('var(--accent-solid)');
		const restFill = over([0, 0, 0], 0.12, solid);
		res.push({ label: 'rest-ctrl glyph on its wash', min: 4.5, ratio: ratio([255, 255, 255], restFill), fg: [255, 255, 255], bg: restFill });
		res.push({ label: 'rest-ctrl rim vs banner', min: 3.0, ratio: ratio(over([255, 255, 255], 0.7, solid), solid), fg: over([255, 255, 255], 0.7, solid), bg: solid });
		// press state must be DARKER than rest state or the press cue inverts
		res.push({ label: 'press darker than rest (cue)', min: 1, ratio: lum(toRgb('var(--accent-solid)')) > lum(toRgb('var(--accent-press)')) ? 99 : 0, fg: [0, 0, 0], bg: [0, 0, 0], bool: true });
		probe.remove();
		return res;
	},
	{ pairs: PAIRS }
);

const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
let fails = 0;
for (const r of out) {
	const ok = r.ratio >= r.min;
	if (!ok) fails++;
	const detail = r.bool ? (ok ? 'accent-press is darker than accent-solid' : 'INVERTED — press reads lighter than rest') : `${r.ratio.toFixed(2)}:1 (min ${r.min}) ${hex(r.fg)} on ${hex(r.bg)}`;
	console.log(`${ok ? '✓' : '✗ FAIL'}  ${r.label.padEnd(34)} ${detail}`);
}
await browser.close(); server.close();
console.log(`\n${out.length - fails}/${out.length} contrast checks passed`);
process.exit(fails ? 1 : 0);
