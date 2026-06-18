// Service worker — app-shell + build-asset caching for offline / PWA use.
//
// APP_VERSION and PRECACHE_ASSETS are INJECTED AT BUILD TIME by
// scripts/inject-sw-precache.mjs (run after `vite build`): the version is taken
// from package.json (single-sourced — no manual edit needed on release) and
// PRECACHE_ASSETS is filled with the content-hashed first-paint bundles the built
// index.html references. In dev (unbuilt) they stay at the fallbacks below, which
// is fine — the dev server doesn't rely on the worker.
const APP_VERSION = '1.2.0';
const PRECACHE_ASSETS = [];
const CACHE_NAME = `jaghelm-v${APP_VERSION}`;

// Precache the app shell + the hashed first-paint bundles, so the dashboard can
// boot offline immediately — not only after a prior online visit happened to
// warm the runtime cache.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(['/', '/logo.svg', '/favicon.svg', ...PRECACHE_ASSETS]))
  );
  self.skipWaiting();
});

// Clean up old caches on activate (a version bump changes CACHE_NAME).
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
  );
  self.clients.claim();
});

// Fetch and, on a successful response, store a clone in the cache. Shared by the
// cache-first and network-first branches below.
function fetchAndCache(request) {
  return fetch(request).then((response) => {
    if (response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
    }
    return response;
  });
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // API calls: always network, never cache (live + possibly sensitive data).
  if (event.request.url.includes('/api/')) return;

  const url = new URL(event.request.url);
  // Only manage same-origin GETs; cross-origin requests go straight to network.
  if (url.origin !== self.location.origin) return;

  // Content-hashed build assets are immutable — serve them cache-first (instant
  // and offline-safe), filling the cache on a miss. A new deploy ships new
  // filenames, so cache-first here never serves stale code.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetchAndCache(event.request)));
    return;
  }

  // App shell + everything else: network-first (live data), fall back to cache
  // when offline.
  event.respondWith(fetchAndCache(event.request).catch(() => caches.match(event.request)));
});
