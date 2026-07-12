/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `buffy-cache-${version}`;
// ssr=false + prerender=false ⇒ every route boots from this one static HTML shell.
// Precache it: the old precache held only JS/CSS and depended on a RUNTIME-cached copy
// of '/' that a fresh install never had and every deploy's activate() wiped — so the
// first offline launch (and the first launch after any deploy) got the browser's
// offline page despite all chunks being cached.
const SHELL = '/';
const PRECACHE = [...build, ...files, SHELL];

sw.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
	// Deliberately NO skipWaiting: a new SW waits until every tab from the previous
	// deploy has closed before it activates. Those tabs keep lazy-loading their build's
	// hashed chunks from the still-present old cache instead of 404ing on Vercel (which
	// serves only the current deploy's assets). Updates land on the next cold relaunch.
});

sw.addEventListener('activate', (event) => {
	// Safe to prune old caches here — without skipWaiting, activate() runs only once no
	// client from the previous version remains, so nothing is still relying on them. No
	// clients.claim() for the same reason: don't seize tabs mid-session onto a new build.
	event.waitUntil(
		caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
	);
});

sw.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;
	const url = new URL(req.url);
	if (url.origin !== location.origin) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);

			// Navigations → the precached shell (cache-first). It always matches THIS
			// build's precached chunk set and boots fully offline.
			if (req.mode === 'navigate') {
				const shell = await cache.match(SHELL);
				if (shell) return shell;
			}

			// precached static assets — cache first
			if (PRECACHE.includes(url.pathname)) {
				const hit = await cache.match(url.pathname);
				if (hit) return hit;
			}

			// everything else — network first, fall back to cache (offline)
			try {
				const res = await fetch(req);
				if (res.ok) cache.put(req, res.clone());
				return res;
			} catch {
				const hit = await cache.match(req);
				if (hit) return hit;
				throw new Error('offline and not cached');
			}
		})()
	);
});
