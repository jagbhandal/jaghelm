// Service worker — app-shell + build-asset caching for offline / PWA use.
//
// APP_VERSION, PRECACHE_ASSETS and BUILD_ASSETS are INJECTED AT BUILD TIME by
// scripts/inject-sw-precache.mjs (run after `vite build`): the version is taken
// from package.json (single-sourced — no manual edit needed on release),
// PRECACHE_ASSETS is filled with the content-hashed first-paint bundles the built
// index.html references, and BUILD_ASSETS with every file of this build's
// dist/assets, lazy chunks included. In dev (unbuilt) they stay at the fallbacks
// below, which is fine — the dev server doesn't rely on the worker.
const APP_VERSION = '1.3.0';
const PRECACHE_ASSETS = [];
const BUILD_ASSETS = [];
const CACHE_NAME = `jaghelm-v${APP_VERSION}`;

// The precache manifest: the app shell + the hashed first-paint bundles.
const PRECACHE_MANIFEST = ['/', '/logo.svg', '/favicon.svg', ...PRECACHE_ASSETS];

// Precache the manifest, so the dashboard can boot offline immediately — not
// only after a prior online visit happened to warm the runtime cache.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_MANIFEST)));
  self.skipWaiting();
});

// On activate, delete every other cache (a version bump changes CACHE_NAME) and
// trim earlier builds' files out of this one. A redeploy at the same version
// keeps CACHE_NAME, so without the trim each deploy's old hashed bundles would
// stay in it for good. Only /assets/ URLs change name from build to build; the
// shell, /uploads/ and public files keep one URL each and are overwritten in
// place, so they stay cached for offline use.
self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([deleteOtherCaches(), trimOldBuildAssets()]));
  self.clients.claim();
});

function deleteOtherCaches() {
  return caches
    .keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))));
}

// Delete the cached /assets/ files that aren't in this build's asset list. Cache
// keys are full URLs, so resolve the list's paths the same way, and drop a key's
// #fragment before comparing (cache matching ignores it). A query string makes a
// different URL, so `/assets/a.js?x=1` is trimmed even when `/assets/a.js` stays.
function trimOldBuildAssets() {
  const keep = new Set(BUILD_ASSETS.map((path) => new URL(path, self.location.href).href));
  const isOldBuildAsset = (request) => {
    const url = new URL(request.url);
    url.hash = '';
    return url.pathname.startsWith('/assets/') && !keep.has(url.href);
  };
  return caches
    .open(CACHE_NAME)
    .then((cache) =>
      cache
        .keys()
        .then((requests) => Promise.all(requests.filter(isOldBuildAsset).map((request) => cache.delete(request))))
    );
}

// A build asset is cached only when the server really had it: an ok response that
// isn't HTML. An HTML page under /assets/ is an index.html fallback for a missing
// chunk, such as one a deploy removed while an old tab still wanted it; cached,
// it would be served as that chunk's code from then on.
function isBuildAssetResponse(response) {
  const type = (response.headers.get('content-type') || '').toLowerCase();
  return isOwnOkResponse(response) && !type.includes('text/html');
}

// A response worth keeping: ok, and the server's own. Cloudflare Access answers an
// expired session with a redirect to its sign-in page (a cross-origin 302): a
// navigation gets an opaque redirect, and a followed one ends on another origin
// as a 200 sign-in page. Neither may be cached under the dashboard's URL, or
// the next offline visit would be served a sign-in page as the dashboard (#653).
function isOwnOkResponse(response) {
  if (!response.ok || response.redirected || response.type === 'opaqueredirect') return false;
  if (response.url) {
    try {
      if (new URL(response.url).origin !== self.location.origin) return false;
    } catch {
      return false;
    }
  }
  return true;
}

// Fetch and, when isCacheable(response) holds, store a clone in the cache. Shared
// by the cache-first and network-first branches below.
function fetchAndCache(request, isCacheable = isOwnOkResponse) {
  return fetch(request).then((response) => {
    if (isCacheable(response)) {
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
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetchAndCache(event.request, isBuildAssetResponse))
    );
    return;
  }

  // App shell + everything else: network-first (live data), fall back to cache
  // when offline. Every page of the app (/alerts, /apps/<id>, /settings/tabs...)
  // is the same index.html, and the router opens the page its URL names, so an
  // offline visit to a page with no copy of its own gets the precached shell.
  event.respondWith(
    fetchAndCache(event.request).catch(() =>
      caches
        .match(event.request)
        .then((hit) => hit || (event.request.mode === 'navigate' ? caches.match('/') : undefined))
    )
  );
});

// ── Web Push (#653) ────────────────────────────────────────────────────────
// The server sends a small encrypted JSON message per alert (server/push/
// webPush.js buildWebPayload): { v, title, body, tag, url, severity, type }.
// The text is the state and the service's name, nothing more, because it shows
// on a locked screen. The caching above is untouched by all of this.

const NOTIFICATION_ICON = '/icon-192.png';
const FALLBACK_NOTIFICATION = {
  title: 'JagHelm',
  body: 'Something changed. Open JagHelm to see what.',
};

// The payload as an object, or null for anything that isn't one (a push with
// no data, a malformed one, a test from DevTools): the notification is shown
// all the same, because a push that shows nothing counts against the site.
function readPushData(event) {
  try {
    const data = event.data && event.data.json();
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

const shortText = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

// Where a tap goes: a path on this origin, from the payload, or the dashboard's
// root. Anything that could leave the origin (an absolute URL, //host, a
// backslash trick, a javascript: URL) becomes '/'. The payload is encrypted for
// this browser and signed in by the server, but the page that opens is still
// decided here.
function safeTarget(url) {
  if (typeof url !== 'string' || url.length > 2048) return '/';
  if (!/^\/(?![/\\])/.test(url) || /[\u0000-\u001f\u007f\\]/.test(url)) return '/';
  try {
    const resolved = new URL(url, self.location.origin);
    if (resolved.origin !== self.location.origin) return '/';
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return '/';
  }
}

// What showNotification gets: one notification per `tag` (the alert's entity),
// so a repeat or the recovery replaces the earlier one, and `renotify` so the
// replacement still alerts.
function notificationFor(data) {
  const d = data || {};
  const title = shortText(d.title, 120) || FALLBACK_NOTIFICATION.title;
  const body = data ? shortText(d.body, 200) : FALLBACK_NOTIFICATION.body;
  const tag = shortText(d.tag, 200);
  return {
    title,
    options: {
      body,
      icon: NOTIFICATION_ICON,
      ...(tag ? { tag, renotify: true } : {}),
      requireInteraction: d.severity === 'critical',
      timestamp: Date.now(),
      data: { url: safeTarget(d.url) },
    },
  };
}

self.addEventListener('push', (event) => {
  const { title, options } = notificationFor(readPushData(event));
  event.waitUntil(self.registration.showNotification(title, options));
});

// A tap: focus the dashboard window that is open and take it to the alert's
// page, or open one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = safeTarget(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => {
        try {
          return new URL(client.url).origin === self.location.origin;
        } catch {
          return false;
        }
      });
      if (!open) return self.clients.openWindow(target);
      return open
        .focus()
        .then((focused) => (focused || open).navigate(target))
        .catch(() => self.clients.openWindow(target));
    })
  );
});
