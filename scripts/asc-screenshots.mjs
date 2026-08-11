// Upload App Store screenshots to a version localization via the ASC API.
// Flow per image: reserve (POST) → PUT bytes to the returned upload URL(s) →
// commit (PATCH uploaded=true + md5).
//
// Usage:
//   node scripts/asc-screenshots.mjs <versionLocalizationId> [--replace]
//
// Without --replace a display set that already has screenshots is left alone.
// With --replace its existing screenshots are deleted first — which is what a
// new version needs, since ASC copies the previous version's images forward and
// they then show the OLD UI (a 2.3.3 "accurate metadata" risk after a redesign).
//
// Ported from the coffee app (~/Desktop/CODE/scripts/asc-screenshots.mjs), which
// carries its hard-won ordering: nothing is DELETEd until replacement images are
// confirmed on disk, and a half-uploaded set fails loudly rather than exiting 0.
// Only DEVICES differs — Buffy's listing uses the 6.5" iPhone size, not 6.7".
import { asc } from './asc-api.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

// Resolve image dirs against the repo, not the caller's cwd — run from elsewhere
// and the readdir would throw AFTER --replace had already deleted the live set.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Required, never defaulted: a forgotten argument must not aim a destructive run
// at the live listing's localization.
const VER_LOC = process.argv[2];
const REPLACE = process.argv.includes('--replace');
if (!VER_LOC || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(VER_LOC)) {
	console.error('Usage: node scripts/asc-screenshots.mjs <versionLocalizationId> [--replace]');
	console.error(
		'Find the id with: asc-api.mjs GET /v1/appStoreVersions/<verId>/appStoreVersionLocalizations'
	);
	process.exit(1);
}
console.log(`target localization ${VER_LOC}${REPLACE ? ' (replacing existing)' : ''}`);

const DEVICES = [
	{ displayType: 'APP_IPHONE_65', dir: 'appstore-screenshots-6.5' }, // 1242×2688
	{ displayType: 'APP_IPAD_PRO_3GEN_129', dir: 'appstore-screenshots-ipad13' } // 2048×2732
];

async function findOrCreateSet(displayType) {
	const existing = await asc(
		'GET',
		`/v1/appStoreVersionLocalizations/${VER_LOC}/appScreenshotSets?limit=50`
	);
	if (!existing.ok) throw new Error(`list sets: ${JSON.stringify(existing.json)}`);
	const found = (existing.json?.data ?? []).find(
		(s) => s.attributes?.screenshotDisplayType === displayType
	);
	if (found) return found.id;
	const created = await asc('POST', '/v1/appScreenshotSets', {
		data: {
			type: 'appScreenshotSets',
			attributes: { screenshotDisplayType: displayType },
			relationships: {
				appStoreVersionLocalization: {
					data: { type: 'appStoreVersionLocalizations', id: VER_LOC }
				}
			}
		}
	});
	if (!created.ok) throw new Error(`create set ${displayType}: ${JSON.stringify(created.json)}`);
	return created.json.data.id;
}

async function setScreenshots(setId) {
	const r = await asc('GET', `/v1/appScreenshotSets/${setId}/appScreenshots?limit=50`);
	// An unchecked failure here would read as "no existing screenshots", skipping
	// the --replace deletion and stacking new images on top of the carried-over
	// ones — the exact mixed-UI listing this flag exists to prevent.
	if (!r.ok) throw new Error(`list screenshots for set ${setId}: ${JSON.stringify(r.json)}`);
	return r.json?.data ?? [];
}

async function clearSet(setId) {
	const shots = await setScreenshots(setId);
	for (const shot of shots) {
		const del = await asc('DELETE', `/v1/appScreenshots/${shot.id}`);
		if (!del.ok) throw new Error(`delete ${shot.id}: ${JSON.stringify(del.json)}`);
	}
	return shots.length;
}

async function uploadOne(setId, dir, file) {
	const bytes = readFileSync(join(dir, file));
	const md5 = crypto.createHash('md5').update(bytes).digest('hex');
	const reserve = await asc('POST', '/v1/appScreenshots', {
		data: {
			type: 'appScreenshots',
			attributes: { fileName: file, fileSize: bytes.length },
			relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } } }
		}
	});
	if (!reserve.ok) throw new Error(`reserve ${file}: ${JSON.stringify(reserve.json)}`);
	const id = reserve.json.data.id;
	const ops = reserve.json.data.attributes.uploadOperations ?? [];
	for (const op of ops) {
		const headers = {};
		for (const h of op.requestHeaders ?? []) headers[h.name] = h.value;
		const slice = bytes.subarray(op.offset, op.offset + op.length);
		const put = await fetch(op.url, { method: op.method, headers, body: slice });
		if (!put.ok) throw new Error(`PUT ${file}: HTTP ${put.status} ${await put.text()}`);
	}
	const commit = await asc('PATCH', `/v1/appScreenshots/${id}`, {
		data: { type: 'appScreenshots', id, attributes: { uploaded: true, sourceFileChecksum: md5 } }
	});
	if (!commit.ok) throw new Error(`commit ${file}: ${JSON.stringify(commit.json)}`);
	return id;
}

for (const dev of DEVICES) {
	const dir = join(REPO, dev.dir);
	// Everything that can fail without touching ASC happens first: no DELETE is
	// issued until we know there are replacement images on disk to upload.
	const files = readdirSync(dir)
		.filter((f) => f.endsWith('.png'))
		.sort();
	if (files.length === 0)
		throw new Error(`${dir} contains no .png — refusing to clear ${dev.displayType}`);

	const setId = await findOrCreateSet(dev.displayType);
	const already = (await setScreenshots(setId)).length;
	if (already > 0) {
		if (!REPLACE) {
			console.log(`• ${dev.displayType}: already has ${already} screenshots — skipping`);
			continue;
		}
		const removed = await clearSet(setId);
		console.log(`• ${dev.displayType}: removed ${removed} carried-over screenshots`);
	}
	for (const f of files) {
		await uploadOne(setId, dir, f);
		console.log(`✓ ${dev.displayType}  ${f}`);
	}
	// A half-uploaded set is worse than an untouched one: the version would go to
	// review short. Surface it rather than exiting 0.
	const final = (await setScreenshots(setId)).length;
	if (final !== files.length) {
		throw new Error(
			`${dev.displayType}: expected ${files.length} screenshots, ASC reports ${final}`
		);
	}
}
console.log('screenshots done.');
