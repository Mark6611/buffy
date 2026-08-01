// App Store screenshot generator for Buffy 1.1.
// Serves the static build/ (adapter-static, BUILD_TARGET=capacitor), seeds IndexedDB
// (+ a resumed workout in localStorage) with realistic sample data, and captures
// exact device-pixel PNGs for the two sizes the 1.1 listing uses:
//   iPhone 6.5" -> 1242x2688 (viewport 414x896  @ dsf 3)  [APP_IPHONE_65]
//   iPad  12.9" -> 2048x2732 (viewport 1024x1366 @ dsf 2)  [APP_IPAD_PRO_3GEN_129]
// Run from repo root after `npm run build:ios`:  node scripts/gen-shots.mjs
import { chromium } from '@playwright/test';
import http from 'node:http';
import { readFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const BUILD = resolve('build');
const PORT = 4321;
const MIME = {
	'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
	'.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
	'.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain'
};

function serve() {
	return new Promise((res) => {
		const server = http.createServer(async (req, resp) => {
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
			} catch {
				try { resp.writeHead(200, { 'Content-Type': 'text/html' }); resp.end(await readFile(join(BUILD, 'index.html'))); }
				catch { resp.writeHead(404); resp.end(); }
			}
		});
		server.listen(PORT, () => res(server));
	});
}

// ── sample data ──────────────────────────────────────────────────────────
const NOW = Date.now();
const day = 86_400_000;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

const EX_BENCH = 'b0000001-0000-4000-8000-000000000001';
const EX_SQUAT = 'b0000002-0000-4000-8000-000000000002';
const EX_OHP   = 'b0000003-0000-4000-8000-000000000003';
const EX_CURL  = 'b0000004-0000-4000-8000-000000000004';
const EX_PULL  = 'b0000005-0000-4000-8000-000000000005';
const EX_LATP  = 'b0000006-0000-4000-8000-000000000006';
const EX_ROW   = 'b0000007-0000-4000-8000-000000000007';
const TPL_PUSH = 'a0000001-0000-4000-8000-000000000001';
const TPL_PULL = 'a0000002-0000-4000-8000-000000000002';
const TPL_LEGS = 'a0000003-0000-4000-8000-000000000003';
const SID_DETAIL = 'c0000001-0000-4000-8000-000000000001'; // history-detail target (bench + row)

const ex30 = iso(30 * day);
const exercises = [
	{ id: EX_BENCH, name: 'Barbell Bench Press', equipment: 'barbell', primaryMuscles: ['Chest'], secondaryMuscles: ['Triceps', 'Shoulders'], trackingType: 'weight_reps', loadType: 'total', defaultRestSec: 120, weightStep: 2.5, updatedAt: ex30 },
	{ id: EX_SQUAT, name: 'Barbell Back Squat', equipment: 'barbell', primaryMuscles: ['Quads'], secondaryMuscles: ['Glutes', 'Hamstrings'], trackingType: 'weight_reps', loadType: 'total', defaultRestSec: 150, weightStep: 2.5, updatedAt: ex30 },
	{ id: EX_OHP, name: 'Overhead Press', equipment: 'barbell', primaryMuscles: ['Shoulders'], secondaryMuscles: ['Triceps'], trackingType: 'weight_reps', loadType: 'total', defaultRestSec: 120, weightStep: 2.5, updatedAt: ex30 },
	{ id: EX_CURL, name: 'Dumbbell Curl', equipment: 'dumbbell', primaryMuscles: ['Biceps'], secondaryMuscles: [], trackingType: 'weight_reps', loadType: 'per_side', defaultRestSec: 75, weightStep: 1, updatedAt: ex30 },
	{ id: EX_PULL, name: 'Pull-up', equipment: 'bodyweight', primaryMuscles: ['Back'], secondaryMuscles: ['Biceps'], trackingType: 'weight_reps', loadType: 'bodyweight', defaultRestSec: 120, updatedAt: ex30 },
	{ id: EX_LATP, name: 'Lat Pulldown', equipment: 'cable', primaryMuscles: ['Back'], secondaryMuscles: ['Biceps'], trackingType: 'weight_reps', loadType: 'total', defaultRestSec: 90, weightStep: 5, updatedAt: ex30 },
	{ id: EX_ROW, name: 'Rowing Machine', equipment: 'cardio', primaryMuscles: ['Full Body'], secondaryMuscles: [], trackingType: 'cardio', loadType: 'total', cardioMetric: 'distance', defaultRestSec: 120, updatedAt: ex30 }
];

const ps = (reps, weight) => ({ targetReps: reps, ...(weight != null ? { targetWeight: weight } : {}), targetRestSec: 120 });
const templates = [
	{ id: TPL_PUSH, name: 'Push Day', notes: 'Chest · shoulders · triceps', exercises: [
		{ exerciseId: EX_BENCH, plannedSets: [ps(8, 80), ps(8, 80), ps(8, 80)] },
		{ exerciseId: EX_OHP, plannedSets: [ps(8, 45), ps(8, 45), ps(8, 45)] },
		{ exerciseId: EX_CURL, plannedSets: [ps(12, 14), ps(12, 14), ps(12, 14)] }
	], groups: [], createdAt: ex30, updatedAt: iso(5 * day) },
	{ id: TPL_PULL, name: 'Pull Day', notes: 'Back · biceps · conditioning', exercises: [
		{ exerciseId: EX_PULL, plannedSets: [ps(8), ps(8), ps(8)] },
		{ exerciseId: EX_LATP, plannedSets: [ps(10, 50), ps(10, 50), ps(10, 50)] },
		{ exerciseId: EX_ROW, plannedSets: [{ targetTimeSec: 600, targetDistanceMeters: 2500, targetRestSec: 120 }] }
	], groups: [], createdAt: ex30, updatedAt: iso(3 * day) },
	{ id: TPL_LEGS, name: 'Leg Day', notes: 'Quads · glutes · hamstrings', exercises: [
		{ exerciseId: EX_SQUAT, plannedSets: [ps(5, 100), ps(5, 100), ps(5, 100), ps(5, 100)] }
	], groups: [], createdAt: ex30, updatedAt: iso(6 * day) }
];

const setsOf = (arr) => arr.map((s, i) => ({ index: i, completed: true, ...s }));
function sess(id, daysAgo, title, tpl, exList) {
	const started = NOW - daysAgo * day - 19 * 60_000;
	const ended = started + (46 + (daysAgo % 4) * 6) * 60_000;
	return {
		id, startedAt: new Date(started).toISOString(), endedAt: new Date(ended).toISOString(),
		sourceTemplateId: tpl, title,
		exercises: exList.map((e) => ({ exerciseId: e.ex, sets: setsOf(e.sets) })),
		updatedAt: new Date(ended).toISOString()
	};
}
// weight/reps set: { weight, reps, rpe? }  ·  cardio-distance set: { timeSec, distanceMeters }
const sessions = [
	sess(SID_DETAIL === SID_DETAIL ? SID_DETAIL : '', 2, 'Push Day', TPL_PUSH, [
		{ ex: EX_BENCH, sets: [{ weight: 82.5, reps: 8, rpe: 8 }, { weight: 82.5, reps: 8, rpe: 8 }, { weight: 82.5, reps: 7, rpe: 9 }] },
		{ ex: EX_OHP, sets: [{ weight: 47.5, reps: 8, rpe: 8 }, { weight: 47.5, reps: 7, rpe: 9 }, { weight: 47.5, reps: 6, rpe: 9 }] },
		{ ex: EX_ROW, sets: [{ timeSec: 480, distanceMeters: 2000 }, { timeSec: 240, distanceMeters: 1000 }] }
	]),
	sess('c0000000-0000-4000-8000-000000000102', 1, 'Pull Day', TPL_PULL, [
		{ ex: EX_PULL, sets: [{ reps: 9, rpe: 8 }, { reps: 8, rpe: 9 }, { reps: 7, rpe: 9 }] },
		{ ex: EX_LATP, sets: [{ weight: 52.5, reps: 10, rpe: 8 }, { weight: 52.5, reps: 10, rpe: 8 }, { weight: 52.5, reps: 9, rpe: 9 }] },
		{ ex: EX_ROW, sets: [{ timeSec: 600, distanceMeters: 2550 }] }
	]),
	sess('c0000000-0000-4000-8000-000000000103', 3, 'Leg Day', TPL_LEGS, [
		{ ex: EX_SQUAT, sets: [{ weight: 102.5, reps: 5, rpe: 8 }, { weight: 102.5, reps: 5, rpe: 8 }, { weight: 102.5, reps: 5, rpe: 9 }, { weight: 102.5, reps: 5, rpe: 9 }] }
	]),
	sess('c0000000-0000-4000-8000-000000000104', 5, 'Push Day', TPL_PUSH, [
		{ ex: EX_BENCH, sets: [{ weight: 80, reps: 8, rpe: 8 }, { weight: 80, reps: 8, rpe: 8 }, { weight: 80, reps: 8, rpe: 8 }] },
		{ ex: EX_OHP, sets: [{ weight: 45, reps: 8, rpe: 8 }, { weight: 45, reps: 8, rpe: 8 }, { weight: 45, reps: 8, rpe: 9 }] },
		{ ex: EX_CURL, sets: [{ weight: 14, reps: 12, perSide: true }, { weight: 14, reps: 11, perSide: true }] }
	]),
	sess('c0000000-0000-4000-8000-000000000105', 6, 'Pull Day', TPL_PULL, [
		{ ex: EX_PULL, sets: [{ reps: 8, rpe: 8 }, { reps: 8, rpe: 9 }, { reps: 7, rpe: 9 }] },
		{ ex: EX_LATP, sets: [{ weight: 50, reps: 10, rpe: 8 }, { weight: 50, reps: 10, rpe: 8 }, { weight: 50, reps: 10, rpe: 9 }] }
	]),
	sess('c0000000-0000-4000-8000-000000000106', 8, 'Leg Day', TPL_LEGS, [
		{ ex: EX_SQUAT, sets: [{ weight: 100, reps: 5, rpe: 8 }, { weight: 100, reps: 5, rpe: 8 }, { weight: 100, reps: 5, rpe: 8 }, { weight: 100, reps: 5, rpe: 9 }] }
	]),
	sess('c0000000-0000-4000-8000-000000000107', 10, 'Push Day', TPL_PUSH, [
		{ ex: EX_BENCH, sets: [{ weight: 80, reps: 7, rpe: 9 }, { weight: 80, reps: 7, rpe: 9 }, { weight: 80, reps: 6, rpe: 9 }] },
		{ ex: EX_OHP, sets: [{ weight: 45, reps: 7, rpe: 9 }, { weight: 45, reps: 7, rpe: 9 }] }
	]),
	sess('c0000000-0000-4000-8000-000000000108', 12, 'Pull Day', TPL_PULL, [
		{ ex: EX_PULL, sets: [{ reps: 8, rpe: 8 }, { reps: 7, rpe: 9 }, { reps: 7, rpe: 9 }] },
		{ ex: EX_ROW, sets: [{ timeSec: 900, distanceMeters: 3750 }] }
	]),
	sess('c0000000-0000-4000-8000-000000000109', 13, 'Leg Day', TPL_LEGS, [
		{ ex: EX_SQUAT, sets: [{ weight: 97.5, reps: 5, rpe: 8 }, { weight: 97.5, reps: 5, rpe: 8 }, { weight: 97.5, reps: 5, rpe: 8 }] }
	]),
	sess('c0000000-0000-4000-8000-000000000110', 15, 'Push Day', TPL_PUSH, [
		{ ex: EX_BENCH, sets: [{ weight: 77.5, reps: 8, rpe: 8 }, { weight: 77.5, reps: 8, rpe: 8 }, { weight: 77.5, reps: 8, rpe: 8 }] },
		{ ex: EX_CURL, sets: [{ weight: 13, reps: 12, perSide: true }, { weight: 13, reps: 12, perSide: true }] }
	]),
	sess('c0000000-0000-4000-8000-000000000111', 17, 'Pull Day', TPL_PULL, [
		{ ex: EX_LATP, sets: [{ weight: 47.5, reps: 10, rpe: 8 }, { weight: 47.5, reps: 10, rpe: 8 }] },
		{ ex: EX_ROW, sets: [{ timeSec: 1200, distanceMeters: 5000 }] }
	]),
	sess('c0000000-0000-4000-8000-000000000112', 19, 'Leg Day', TPL_LEGS, [
		{ ex: EX_SQUAT, sets: [{ weight: 95, reps: 5, rpe: 8 }, { weight: 95, reps: 5, rpe: 8 }, { weight: 95, reps: 5, rpe: 8 }] }
	])
];

const bodyweights = [
	{ d: 20, kg: 83.6 }, { d: 17, kg: 83.2 }, { d: 13, kg: 82.7 }, { d: 9, kg: 82.3 }, { d: 5, kg: 81.8 }, { d: 1, kg: 81.4 }
].map((b, i) => ({ id: `d0000000-0000-4000-8000-0000000000${(i + 1).toString().padStart(2, '0')}`, at: new Date(NOW - b.d * day).toISOString(), kg: b.kg }));

const settings = {
	id: 'singleton', defaultRestSec: 120, autoProgression: true,
	increments: { barbell: 2.5, dumbbellPerSide: 1, machinePin: 5 },
	hapticAtRestEnd: true, trackRpe: true, writeToHealth: false, readRecoveryFromHealth: false,
	sex: 'male', birthYear: 1996, bodyWeightKg: 81.4, cloudSyncEnabled: false
};

// Active resumed workout (for the /workout shot): mid Push Day, resting after bench set 1.
const activeWorkout = {
	session: {
		id: 'e0000000-0000-4000-8000-000000000001',
		startedAt: new Date(NOW - 18 * 60_000).toISOString(),
		sourceTemplateId: TPL_PUSH, title: 'Push Day',
		exercises: [
			{ exerciseId: EX_BENCH, sets: [
				{ index: 0, completed: true, weight: 82.5, reps: 8, rpe: 8 },
				{ index: 1, completed: false, weight: 82.5, reps: 8 },
				{ index: 2, completed: false, weight: 82.5, reps: 8 }
			] },
			{ exerciseId: EX_OHP, sets: [
				{ index: 0, completed: false, weight: 47.5, reps: 8 },
				{ index: 1, completed: false, weight: 47.5, reps: 8 },
				{ index: 2, completed: false, weight: 47.5, reps: 8 }
			] }
		]
	},
	plannedRest: [[120, 120, 120], [120, 120, 120]],
	activeEx: 0, activeSet: 1,
	restRunning: true, restSeedSec: 120,
	restForSet: { ex: 0, set: 0 },
	restStartedAtMs: NOW - 33_000, restAccumSec: 0
};

const SEED = { exercises, templates, sessions, bodyweights, settings };

async function seedDB(page, data) {
	return page.evaluate(async (d) => {
		const db = await new Promise((res, rej) => {
			const req = indexedDB.open('buffy');
			req.onsuccess = () => res(req.result);
			req.onerror = () => rej(req.error);
		});
		const stores = ['exercises', 'templates', 'sessions', 'settings', 'bodyweights'];
		await new Promise((res, rej) => {
			const tx = db.transaction(stores, 'readwrite');
			for (const s of stores) tx.objectStore(s).clear();
			for (const e of d.exercises) tx.objectStore('exercises').put(e);
			for (const t of d.templates) tx.objectStore('templates').put(t);
			for (const s of d.sessions) tx.objectStore('sessions').put(s);
			for (const b of d.bodyweights) tx.objectStore('bodyweights').put(b);
			tx.objectStore('settings').put(d.settings);
			tx.oncomplete = () => res();
			tx.onerror = () => rej(tx.error);
		});
		const counts = {};
		for (const s of stores) counts[s] = await new Promise((r) => { const q = db.transaction(s).objectStore(s).count(); q.onsuccess = () => r(q.result); });
		db.close();
		localStorage.removeItem('buffy:activeWorkout');
		return counts;
	}, data);
}

const HIDE_CSS = `
	[aria-label*="theme" i], [aria-label*="Theme" i] { display: none !important; }
	* { transition: none !important; animation: none !important; caret-color: transparent !important; }
`;

const SCREENS_CLEAN = [
	{ file: '01-home', route: '/' },
	{ file: '03-trends', route: '/trends' },
	{ file: '05-history', route: `/history/${SID_DETAIL}` },
	{ file: '06-settings', route: '/settings' }
];

const DEVICES = [
	{ dir: 'appstore-screenshots-6.5', viewport: { width: 414, height: 896 }, dsf: 3 }, // 1242x2688
	// iPad 12.9" 2048x2732: Buffy is phone-first (~590px column), so a 1024-wide viewport
	// marooned the UI in empty margins. Render the phone layout full-bleed at 512x683 @ dsf 4
	// (= 2048x2732) so the "scaled phone UI" fills the frame instead.
	{ dir: 'appstore-screenshots-ipad13', viewport: { width: 512, height: 683 }, dsf: 4 }
];

async function run() {
	const server = await serve();
	const base = `http://localhost:${PORT}`;
	const browser = await chromium.launch();
	try {
		for (const dev of DEVICES) {
			await mkdir(resolve(dev.dir), { recursive: true });
			// wipe any stale PNGs (e.g. carried-over 1.0 shots) so the dir holds ONLY this run
			for (const f of await readdir(resolve(dev.dir))) if (f.endsWith('.png')) await unlink(join(dev.dir, f));
			const ctx = await browser.newContext({ viewport: dev.viewport, deviceScaleFactor: dev.dsf, colorScheme: 'light', serviceWorkers: 'block' });
			const page = await ctx.newPage();
			await page.goto(base + '/', { waitUntil: 'networkidle' });
			await page.waitForTimeout(900);
			const counts = await seedDB(page, SEED);
			console.log(`[${dev.dir}] seeded`, counts);

			for (const s of SCREENS_CLEAN) {
				await page.goto(base + s.route, { waitUntil: 'networkidle' });
				await page.addStyleTag({ content: HIDE_CSS });
				await page.waitForTimeout(800);
				const out = join(dev.dir, `${s.file}.png`);
				await page.screenshot({ path: out });
				console.log(`✓ ${out}`);
			}

			// 04 body-weight trend: scroll the trends page down to the Body weight card
			await page.goto(base + '/trends', { waitUntil: 'networkidle' });
			await page.addStyleTag({ content: HIDE_CSS });
			await page.waitForTimeout(600);
			await page.evaluate(() => {
				const el = [...document.querySelectorAll('*')].find(
					(e) => e.children.length === 0 && e.textContent.trim() === 'Body weight'
				);
				if (el) el.scrollIntoView({ block: 'center' });
			});
			await page.waitForTimeout(700);
			const bw = join(dev.dir, '04-bodyweight.png');
			await page.screenshot({ path: bw });
			console.log(`✓ ${bw}`);

			// workout shot last: set the resume snapshot, then load (layout restore()s it)
			await page.evaluate((snap) => localStorage.setItem('buffy:activeWorkout', JSON.stringify(snap)), activeWorkout);
			await page.goto(base + '/workout', { waitUntil: 'networkidle' });
			await page.addStyleTag({ content: HIDE_CSS });
			await page.waitForTimeout(900);
			const wout = join(dev.dir, '02-workout.png');
			await page.screenshot({ path: wout });
			console.log(`✓ ${wout}`);

			await ctx.close();
		}
	} finally {
		await browser.close();
		server.close();
	}
}
run().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
