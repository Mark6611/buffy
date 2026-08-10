// App Store Connect preflight for Buffy — answers "can I actually ship right now?"
// BEFORE spending ~15 minutes on an archive + upload (+ Apple's processing time).
//
// Two full archive+upload cycles in this app family were wasted discovering ASC
// blockers only at the FINAL step. Ported from the coffee app
// (~/Desktop/CODE/scripts/asc-preflight.mjs) with ONE semantic change:
//
// Buffy's ship.sh targets TESTFLIGHT. A version sitting WAITING_FOR_REVIEW does
// NOT block a TestFlight upload — it only blocks creating/submitting a new App
// Store version. So findings are classified into two tiers:
//
//   UPLOAD blockers      → always exit 1. Things that break ship.sh itself:
//                          missing ASC API key, missing/expired Apple Distribution
//                          signing cert, an explicit build number already on ASC,
//                          ASC unreachable.
//   SUBMISSION blockers  → printed as WARNINGS, exit 0 — UNLESS --strict is passed
//                          (use --strict before an App Store submission run):
//                          review slot occupied (WAITING_FOR_REVIEW / IN_REVIEW /
//                          etc.), mismatched pbxproj marketing versions.
//
// Run:  node scripts/asc-preflight.mjs [buildNumber] [--strict]
//   buildNumber  the explicit build number you intend to pass to ship.sh, if any.
//                Without it, the script reports the number ship.sh would compute
//                (max(local pbxproj, ASC highest) + 1 — collision-free by design).
//   --strict     promote SUBMISSION blockers to fatal (App Store runs, not TestFlight).
// Exit 0 = clear to ship for the requested mode. Exit 1 = blocked.

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_ID = '6785999682';
const KEY_ID = 'DUPV266J6S';
const KEY_PATH = join(homedir(), '.appstoreconnect/private_keys', `AuthKey_${KEY_ID}.p8`);

const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
const TARGET_BUILD = args.find((a) => !a.startsWith('--')) ?? null;

// A version in any of these states occupies Apple's single review slot. That blocks
// a new App Store SUBMISSION — it does not block a TestFlight upload.
const REVIEW_SLOT = new Set([
	'WAITING_FOR_REVIEW',
	'IN_REVIEW',
	'PENDING_DEVELOPER_RELEASE',
	'PENDING_APPLE_RELEASE',
	'PROCESSING_FOR_APP_STORE'
]);

// A version in any of these states has been APPROVED by Apple at some point. The 90062
// ceiling is the highest of THESE, not just the currently-live one — a version pulled
// from sale, or superseded, still counts as previously approved.
const APPROVED_STATES = new Set([
	'READY_FOR_SALE',
	'PENDING_DEVELOPER_RELEASE',
	'PENDING_APPLE_RELEASE',
	'PROCESSING_FOR_APP_STORE',
	'REPLACED_WITH_NEW_VERSION',
	'DEVELOPER_REMOVED_FROM_SALE',
	'REMOVED_FROM_SALE'
]);

/// Component-wise numeric compare, because a string compare puts 1.10 BELOW 1.9.
const cmpVersion = (a, b) => {
	const parts = (v) =>
		String(v)
			.split('.')
			.map((n) => (Number.isFinite(Number(n)) ? Number(n) : 0));
	const pa = parts(a);
	const pb = parts(b);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d) return d;
	}
	return 0;
};

const uploadBlockers = []; // exit 1 always
const submissionBlockers = []; // warnings; exit 1 only with --strict
const warnings = []; // informational, never fatal
const ok = [];
const sh = (c) => execSync(c, { cwd: REPO, encoding: 'utf8' }).trim();

console.log(`Buffy ASC preflight (${STRICT ? 'STRICT/submission' : 'TestFlight'} mode)`);
console.log('='.repeat(52));

// ── 1. Local version consistency (pbxproj covers App + RestWidget targets) ──
const pbx = readFileSync(`${REPO}/ios/App/App.xcodeproj/project.pbxproj`, 'utf8');
const uniq = (re) => [...new Set([...pbx.matchAll(re)].map((m) => m[1]))];
const marketing = uniq(/MARKETING_VERSION = ([^;]+);/g);
const build = uniq(/CURRENT_PROJECT_VERSION = ([^;]+);/g);
if (marketing.length !== 1)
	// App vs RestWidget disagreeing produces an ASC-rejected upload at SUBMIT time.
	submissionBlockers.push(`MARKETING_VERSION disagrees across configs: ${marketing}`);
else ok.push(`MARKETING_VERSION ${marketing[0]} (consistent)`);
if (build.length !== 1)
	// ship.sh normalizes CURRENT_PROJECT_VERSION on both targets before archiving,
	// so a local disagreement is self-healing — flag it, don't block on it.
	warnings.push(`CURRENT_PROJECT_VERSION disagrees across configs: ${build} (ship.sh normalizes this)`);
else ok.push(`CURRENT_PROJECT_VERSION ${build[0]} (consistent)`);

// ── 2. Signing cert — an expired/missing cert fails AFTER the E2E gates ─────
try {
	const ids = sh('security find-identity -v -p codesigning');
	if (/Apple Distribution/.test(ids)) ok.push('Apple Distribution signing cert present and valid');
	else uploadBlockers.push(
		'no valid "Apple Distribution" identity in the keychain (security find-identity) — the signed archive will fail'
	);
} catch {
	uploadBlockers.push('security find-identity failed — cannot verify the signing cert');
}

// ── 3. ASC API key ──────────────────────────────────────────────────────────
let ascUsable = false;
if (!existsSync(KEY_PATH)) {
	uploadBlockers.push(`ASC key missing at ${KEY_PATH} — upload and build-number query both fail`);
} else {
	ok.push(`ASC key present (AuthKey_${KEY_ID}.p8)`);
	ascUsable = true;
}

// ── 4. Git state (a dirty tree means the build won't match the commit) ──────
const dirty = sh('git status --porcelain');
if (dirty)
	warnings.push(
		`working tree is dirty (${dirty.split('\n').length} files) — build won't match a commit`
	);
else ok.push('working tree clean');
try {
	sh('git fetch origin --quiet');
	const behind = sh('git rev-list --count HEAD..origin/main');
	if (behind !== '0')
		warnings.push(`${behind} commit(s) on origin/main not in HEAD — rebase before shipping`);
	else ok.push('in sync with origin/main');
} catch {
	warnings.push('could not reach origin to compare');
}

// ── 5. ASC: build numbers + review-slot state ───────────────────────────────
if (ascUsable) {
	const { asc } = await import('./asc-api.mjs');

	const bres = await asc(
		'GET',
		`/v1/builds?filter[app]=${APP_ID}&sort=-uploadedDate&limit=50&fields[builds]=version,processingState,expired`
	);
	if (!bres.ok) {
		uploadBlockers.push(`could not list builds: HTTP ${bres.status} — ASC unreachable or key revoked`);
	} else {
		const builds = (bres.json?.data ?? []).map((b) => b.attributes);
		const nums = builds.map((b) => parseInt(b.version, 10)).filter(Number.isFinite);
		const ascMax = nums.length ? Math.max(...nums) : 0;
		const latest = builds[0];
		if (latest)
			ok.push(`newest ASC build: ${latest.version} (${latest.processingState}${latest.expired ? ', EXPIRED' : ''})`);
		if (TARGET_BUILD) {
			// An explicit build number that already exists on ASC = guaranteed duplicate
			// rejection at the upload step, after the full archive.
			if (builds.some((b) => b.version === TARGET_BUILD))
				uploadBlockers.push(
					`build ${TARGET_BUILD} already exists on ASC — the upload WILL be rejected as a duplicate`
				);
			else ok.push(`requested build number ${TARGET_BUILD} is free on ASC`);
		} else {
			const next = Math.max(parseInt(build[0] ?? '0', 10) || 0, ascMax) + 1;
			ok.push(`ship.sh will use build ${next} (max of local ${build[0] ?? '?'} and ASC ${ascMax}, +1)`);
		}
	}

	const vres = await asc(
		'GET',
		`/v1/apps/${APP_ID}/appStoreVersions?limit=10&fields[appStoreVersions]=versionString,appStoreState`
	);
	if (!vres.ok) {
		uploadBlockers.push(`could not list versions: HTTP ${vres.status}`);
	} else {
		const versions = vres.json?.data ?? [];
		const occupying = versions.filter((v) => REVIEW_SLOT.has(v.attributes.appStoreState));
		for (const v of occupying)
			submissionBlockers.push(
				`v${v.attributes.versionString} is ${v.attributes.appStoreState} — the review slot is occupied; ` +
					`a new App Store version cannot be created/submitted until it clears (TestFlight uploads are NOT affected)`
			);
		if (!occupying.length) ok.push('review slot free — a new App Store version could be created');
		const live = versions.filter((v) => v.attributes.appStoreState === 'READY_FOR_SALE');
		if (live.length) ok.push(`live: ${live.map((v) => 'v' + v.attributes.versionString).join(', ')}`);

		// Once a version has been APPROVED, Apple refuses every later upload whose
		// CFBundleShortVersionString is not strictly higher — TestFlight included
		// (error 90062). Bumping CURRENT_PROJECT_VERSION does not satisfy it, so the
		// build-number check above passes and the upload still dies. This cost a full
		// signed archive on 2026-08-10 shipping 1.2 (18) after 1.2 went live.
		const approved = versions
			.filter((v) => APPROVED_STATES.has(v.attributes.appStoreState))
			.map((v) => v.attributes.versionString);
		const ceiling = approved.sort(cmpVersion).at(-1);
		if (!ceiling) {
			ok.push('no approved version yet — any MARKETING_VERSION is uploadable');
		} else if (marketing.length !== 1) {
			// the disagreement is already reported above; comparing would be arbitrary
		} else if (cmpVersion(marketing[0], ceiling) > 0) {
			ok.push(`MARKETING_VERSION ${marketing[0]} > highest approved v${ceiling}`);
		} else {
			uploadBlockers.push(
				`MARKETING_VERSION ${marketing[0]} is not higher than the highest APPROVED version ` +
					`v${ceiling} — Apple rejects the upload with error 90062, TestFlight included. ` +
					`Bump MARKETING_VERSION (all ${build.length === 1 ? '' : 'mismatched '}configs: App + RestWidget, Debug + Release).`
			);
		}
	}
}

// ── 6. Things the API cannot see — stated, not silently assumed ─────────────
warnings.push(
	'NOT API-CHECKABLE: App Privacy answers and Pricing (web-UI only; surface as a 409 ' +
		'at App Store submit if unset — they persist per-app, so a previously shipped app is fine).'
);

// ── Report ──────────────────────────────────────────────────────────────────
const line = '-'.repeat(52);
console.log(`\n${line}\nPASS (${ok.length})`);
for (const o of ok) console.log(`  ✓ ${o}`);
if (warnings.length) {
	console.log(`\nWARN (${warnings.length})`);
	for (const w of warnings) console.log(`  ! ${w}`);
}
if (submissionBlockers.length) {
	console.log(`\nSUBMISSION BLOCKERS (${submissionBlockers.length}) — ${STRICT ? 'FATAL (--strict)' : 'non-fatal for TestFlight'}`);
	for (const s of submissionBlockers) console.log(`  ${STRICT ? '✗' : '!'} ${s}`);
}
if (uploadBlockers.length) {
	console.log(`\nUPLOAD BLOCKERS (${uploadBlockers.length})`);
	for (const b of uploadBlockers) console.log(`  ✗ ${b}`);
}
if (uploadBlockers.length || (STRICT && submissionBlockers.length)) {
	console.log(`\n${line}\nNOT clear to ship.`);
	process.exit(1);
}
console.log(`\n${line}\nClear to ${STRICT ? 'submit' : 'upload to TestFlight'}.`);
