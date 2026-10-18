#!/usr/bin/env node
// verify-bundle-css.mjs — gate the BUILT css bundle against three bugs that each
// shipped once in this app family (ported from the coffee app, CODE/scripts/).
//
// WHY: source linting cannot see what the bundler emits. In Buffy, Vite's own
// Lightning CSS minify pass rewrites hand-written `(max-width: 700px)` into the
// media RANGE form `(width<=700px)` unless build.cssTarget pins the browser floor —
// and Safari < 16.4 cannot parse range syntax, so every rule inside such a query is
// silently dropped there. Buffy's floor is iOS 15 (IPHONEOS_DEPLOYMENT_TARGET), and
// the casualty was the input focus-zoom guard: on iOS 15.0–16.3 every number field
// zoomed the screen when tapped. The other two checks are the coffee app's shipped
// bugs; they are cheap and Buffy uses backdrop-filter on its glass surfaces:
//   1. an unprefixed backdrop-filter deleted, shipping -webkit- alone;
//   2. hand-written color-mix() with no @supports fallback (fails on Safari < 16.2).
//
// WHAT: scans every .css file in build/ (adapter-static output; the same directory
// ships inside the Capacitor shell) and asserts, on the emitted CSS:
//   A. every declaration block that sets backdrop-filter sets BOTH the
//      -webkit- prefixed and unprefixed forms;
//   B. every color-mix( usage sits inside an @supports block testing color-mix;
//   C. no @media / @container prelude uses range syntax (<, >, <=, >=).
//
// HOW TO RUN:   npm run build:ios && node scripts/verify-bundle-css.mjs
//               (or: node scripts/verify-bundle-css.mjs <dir-to-scan>)
// Exits 1 with file + rule context + snippet per violation; 0 when clean.
//
// NOTE: builds nothing itself — run the build first.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const scanDir = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(repoRoot, 'build');

if (!existsSync(scanDir)) {
	console.error(`verify-bundle-css: ${scanDir} does not exist — run \`npm run build\` first.`);
	process.exit(1);
}

const cssFiles = readdirSync(scanDir, { recursive: true })
	.map((p) => join(scanDir, String(p)))
	.filter((p) => p.endsWith('.css') && statSync(p).isFile());

if (cssFiles.length === 0) {
	console.error(`verify-bundle-css: no .css files under ${scanDir} — is the build complete?`);
	process.exit(1);
}

// ─── Minimal CSS walker ─────────────────────────────────────────────
// Splits a (minified) stylesheet into declaration chunks and rule preludes,
// each annotated with its stack of enclosing preludes. Not a spec parser —
// just enough structure for the three checks. Parens are tracked so a `;`
// inside url(data:...;base64,...) doesn't split a declaration boundary.

function lastTopLevelSemicolon(s) {
	let depth = 0;
	for (let i = s.length - 1; i >= 0; i--) {
		const ch = s[i];
		if (ch === ')') depth++;
		else if (ch === '(') depth--;
		else if (ch === ';' && depth === 0) return i;
	}
	return -1;
}

function walkCss(css) {
	const stack = [];
	const declChunks = []; // { text, offset, stack }
	const preludes = []; // { text, offset, stack }
	let buf = '';
	let bufStart = 0;
	for (let i = 0; i < css.length; i++) {
		const ch = css[i];
		if (ch === '{') {
			const cut = lastTopLevelSemicolon(buf);
			const prelude = buf.slice(cut + 1).trim();
			const before = buf.slice(0, cut + 1).trim();
			if (before) declChunks.push({ text: before, offset: bufStart, stack: [...stack] });
			preludes.push({ text: prelude, offset: bufStart + cut + 1, stack: [...stack] });
			stack.push(prelude);
			buf = '';
			bufStart = i + 1;
		} else if (ch === '}') {
			if (buf.trim()) declChunks.push({ text: buf.trim(), offset: bufStart, stack: [...stack] });
			stack.pop();
			buf = '';
			bufStart = i + 1;
		} else {
			buf += ch;
		}
	}
	return { declChunks, preludes };
}

function declarationsOf(chunk) {
	// Property/value pairs; a ';' inside url() may over-split, but the garbage
	// fragment then has no recognizable property name, which is harmless here.
	return chunk.text
		.split(';')
		.map((d) => d.trim())
		.filter(Boolean)
		.map((d) => {
			const colon = d.indexOf(':');
			return colon === -1
				? { prop: d.toLowerCase(), value: '' }
				: { prop: d.slice(0, colon).trim().toLowerCase(), value: d.slice(colon + 1) };
		});
}

// ─── Checks ─────────────────────────────────────────────────────────

const violations = [];
function violation(kind, file, context, snippet) {
	violations.push({ kind, file, context, snippet });
}

function snippetAt(css, offset) {
	return css
		.slice(Math.max(0, offset - 40), offset + 140)
		.replace(/\s+/g, ' ')
		.trim();
}

for (const file of cssFiles) {
	const css = readFileSync(file, 'utf8');
	const rel = relative(repoRoot, file);
	const { declChunks, preludes } = walkCss(css);

	for (const chunk of declChunks) {
		const decls = declarationsOf(chunk);
		const props = new Set(decls.map((d) => d.prop));

		// A. backdrop-filter must ship prefixed AND unprefixed in the same block.
		const hasUnprefixed = props.has('backdrop-filter');
		const hasWebkit = props.has('-webkit-backdrop-filter');
		if (hasUnprefixed !== hasWebkit) {
			violation(
				'backdrop-filter-unpaired',
				rel,
				chunk.stack.join(' > ') || '(top level)',
				snippetAt(css, chunk.offset)
			);
		}

		// B. color-mix() only inside an @supports block that tests color-mix.
		const usesColorMix = decls.some((d) => d.value.includes('color-mix('));
		if (usesColorMix) {
			const guarded = chunk.stack.some(
				(p) => p.startsWith('@supports') && p.includes('color-mix(')
			);
			if (!guarded) {
				violation(
					'color-mix-unguarded',
					rel,
					chunk.stack.join(' > ') || '(top level)',
					snippetAt(css, chunk.offset)
				);
			}
		}
	}

	// C. no range syntax in @media / @container preludes.
	for (const p of preludes) {
		if (/^@(media|container)\b/.test(p.text) && /[<>]/.test(p.text)) {
			violation('media-range-syntax', rel, p.text, snippetAt(css, p.offset));
		}
	}
}

// ─── Report ─────────────────────────────────────────────────────────

if (violations.length > 0) {
	console.error(`verify-bundle-css: ${violations.length} violation(s) in the built bundle\n`);
	for (const v of violations) {
		console.error(`  ✗ [${v.kind}] ${v.file}`);
		console.error(`      rule:    ${v.context}`);
		console.error(`      snippet: ${v.snippet}\n`);
	}
	console.error(
		'Fix patterns: pair -webkit-/unprefixed backdrop-filter; guard color-mix with ' +
			'@supports (color: color-mix(...)); avoid media range syntax (the lightningcss ' +
			'targets in vite.config.ts lower it — check they are still in place).'
	);
	process.exit(1);
}

console.log(
	`verify-bundle-css: OK — ${cssFiles.length} css file(s) scanned, ` +
		'backdrop-filter pairing / color-mix guards / media range syntax all clean.'
);
