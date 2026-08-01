// Minimal App Store Connect API client for Buffy. Auth is a short-lived ES256 JWT
// signed with the provisioned .p8 key (a machine credential — NOT an Apple ID login).
// Ported from the coffee app (~/Desktop/CODE/scripts/asc-api.mjs); ship.sh keeps its
// own embedded python JWT calls — this module exists for node tooling (preflight etc.).
// Usage:
//   node scripts/asc-api.mjs GET  /v1/apps/6785999682/appStoreVersions
//   node scripts/asc-api.mjs POST /v1/appStoreVersionLocalizations  '<json>'
//   node scripts/asc-api.mjs PATCH /v1/appInfos/<id> '<json>'
// Or import { asc } from './asc-api.mjs' and call asc(method, path, body).

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const KEY_ID = 'DUPV266J6S';
const ISSUER_ID = 'b0021702-5324-4cc1-9ddd-66a5a1535fe6';
const KEY_PATH = join(homedir(), '.appstoreconnect/private_keys', `AuthKey_${KEY_ID}.p8`);
const BASE = 'https://api.appstoreconnect.apple.com';

function b64url(buf) {
	return Buffer.from(buf)
		.toString('base64')
		.replace(/=/g, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_');
}

function token() {
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
	const payload = { iss: ISSUER_ID, iat: now, exp: now + 1000, aud: 'appstoreconnect-v1' };
	const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
	const key = crypto.createPrivateKey(readFileSync(KEY_PATH, 'utf8'));
	const sig = crypto.sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
	return `${signingInput}.${b64url(sig)}`;
}

export async function asc(method, path, body) {
	const url = path.startsWith('http') ? path : BASE + path;
	const res = await fetch(url, {
		method,
		headers: {
			Authorization: `Bearer ${token()}`,
			'Content-Type': 'application/json'
		},
		body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined
	});
	const text = await res.text();
	let json;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = { raw: text };
	}
	return { status: res.status, ok: res.ok, json };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
	const [, , method = 'GET', path, body] = process.argv;
	if (!path) {
		console.error('usage: node scripts/asc-api.mjs <METHOD> <path> [jsonBody]');
		process.exit(2);
	}
	const r = await asc(method, path, body);
	console.log('HTTP', r.status);
	console.log(JSON.stringify(r.json, null, 2));
	process.exit(r.ok ? 0 : 1);
}
