// Cache key is versioned so a new deploy invalidates the old app shell.
// The version is hardcoded to match package.json ("version") at build time.
// FOLLOW-UP (owned by the deploy pipeline): single-source this from the build
// SHA / package.json version so it auto-bumps on every release instead of
// needing a manual edit here. See docs/IMPROVEMENT-PLAN.md Phase 6.
const APP_VERSION = '1.2.0';
const CACHE_NAME = `jaghelm-v${APP_VERSION}`;

// Cache the app shell on install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/logo.svg',
        '/favicon.svg',
      ]);
    })
  );
  self.skipWaiting();
});

// Clean up old caches on activate
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Network-first strategy — dashboard needs live data
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // API calls: always network, never cache
  if (event.request.url.includes('/api/')) return;

  // App shell: try network first, fall back to cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses for offline fallback
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
