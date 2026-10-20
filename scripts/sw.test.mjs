// Runs the service worker (public/sw.js) against a fake CacheStorage and checks
// what its install, activate and fetch handlers leave in the cache.
//
// The test lives here, not beside sw.js: Vite copies public/ into dist/ verbatim,
// and the node:test glob doesn't cover public/. Each test builds the worker the
// way `npm run build` does, through injectIntoSw, then runs it in a vm context
// whose `self`, `caches` and `fetch` are the fakes below.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { injectIntoSw } from './inject-sw-precache.mjs';

const SW_SOURCE = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sw.js'),
  'utf8'
);
const SW_URL = 'https://jaghelm.test/sw.js';
const VERSION = '9.9.9';
const CACHE = `jaghelm-v${VERSION}`;
// The first-paint bundles (PRECACHE_ASSETS) and the whole build (BUILD_ASSETS).
const BUNDLES = ['/assets/index-NEW.css', '/assets/index-NEW.js', '/assets/vendor-react-NEW.js'];
const BUILD = [...BUNDLES, '/assets/IframeView-NEW.js', '/assets/SettingsView-NEW.js'].sort();

const abs = (url) => new URL(url, SW_URL).href;
const keyOf = (request) => (typeof request === 'string' ? abs(request) : request.url);
// Real cache deletes settle later than a microtask. Without this, a trim left
// outside event.waitUntil would still finish before dispatch() returns, and the
// tests couldn't tell it apart from an awaited one.
const nextMacrotask = () => new Promise((resolve) => setImmediate(resolve));

/** A CacheStorage holding only URLs (no responses), seeded with { cacheName: [url, ...] }. */
function fakeCaches(seed = {}) {
  const stores = new Map(
    Object.entries(seed).map(([name, urls]) => [name, new Set(urls.map(abs))])
  );
  const cacheFor = (store) => ({
    keys: async () => [...store].map((url) => new Request(url)),
    addAll: async (requests) => {
      for (const request of requests) store.add(keyOf(request));
    },
    put: async (request) => {
      store.add(keyOf(request));
    },
    delete: async (request) => {
      await nextMacrotask();
      return store.delete(keyOf(request));
    },
  });
  return {
    keys: async () => [...stores.keys()],
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Set());
      return cacheFor(stores.get(name));
    },
    delete: async (name) => stores.delete(name),
    match: async (request) =>
      [...stores.values()].some((store) => store.has(keyOf(request)))
        ? new Response('cached', { headers: { 'x-cached-url': keyOf(request) } })
        : undefined,
    /** Test view: cache name -> sorted URL paths. */
    snapshot: () =>
      Object.fromEntries(
        [...stores].map(([name, urls]) => [
          name,
          [...urls]
            .map((u) => {
              const url = new URL(u);
              return url.pathname + url.search + url.hash;
            })
            .sort(),
        ])
      ),
  };
}

/**
 * Load the built worker into a vm context. Returns dispatch(type, event) that
 * awaits the handler's waitUntil. `network` maps a path to the Response the
 * fake fetch answers with; any other request fails as if offline.
 */
function loadWorker(caches, { assets = BUNDLES, buildAssets = BUILD, network = {} } = {}) {
  const listeners = {};
  const self = {
    location: new URL(SW_URL),
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const fetch = async (request) => {
    const answer = network[new URL(request.url).pathname];
    if (!answer) throw new Error('no network in this test');
    return answer();
  };
  vm.runInNewContext(
    injectIntoSw(SW_SOURCE, assets, VERSION, buildAssets),
    { self, caches, fetch, URL, Request },
    { filename: 'sw.js' }
  );
  return async (type, event = {}) => {
    const pending = [];
    listeners[type]({ ...event, waitUntil: (promise) => pending.push(promise) });
    await Promise.all(pending);
  };
}

/**
 * Send a GET through the worker's fetch handler; resolves once its cache write
 * has settled. `mode: 'navigate'` sends a page load, as the browser does (a
 * Request can't be built in that mode, so it is a plain object with what the
 * worker reads).
 */
async function fetchThrough(dispatch, path, { mode } = {}) {
  let responded;
  await dispatch('fetch', {
    request: mode ? { url: abs(path), method: 'GET', mode } : new Request(abs(path)),
    respondWith: (promise) => {
      responded = promise;
    },
  });
  const response = await responded;
  await nextMacrotask(); // fetchAndCache stores without awaiting
  return response;
}

const reply = (status, type) => () =>
  new Response('body', { status, headers: { 'content-type': type } });

test('sw activate trims /assets/ files of earlier builds and keeps this build, lazy chunks included', async () => {
  const caches = fakeCaches();
  const dispatch = loadWorker(caches);
  await dispatch('install');
  const precached = caches.snapshot()[CACHE];
  assert.deepEqual(precached, ['/', ...BUNDLES, '/favicon.svg', '/logo.svg'].sort());

  // Same version, so the same cache: a redeploy's leftovers and runtime fills.
  const kept = [
    '/assets/SettingsView-NEW.js', // this build's lazy chunk, cached on first use
    '/assets/IframeView-NEW.js#top', // cache matching ignores the fragment
    '/uploads/logo.png', // the custom logo: one URL, overwritten in place
    '/manifest.json', // a network-first copy of a public file
    '/register-sw.js',
    '/?tab=services', // a navigation with a query string
  ];
  const trimmed = [
    '/assets/index-OLD.js', // previous deploy's first-paint bundle
    '/assets/SettingsView-OLD.js', // previous deploy's lazy chunk
    '/assets/index-NEW.js?v=1', // not this build's URL
  ];
  const cache = await caches.open(CACHE);
  for (const url of [...kept, ...trimmed]) await cache.put(url);

  await dispatch('activate');
  assert.deepEqual(caches.snapshot(), { [CACHE]: [...precached, ...kept].sort() });
});

test('sw activate trims a cache the worker did not fill itself', async () => {
  const caches = fakeCaches({
    [CACHE]: ['/', '/logo.svg', '/assets/index-OLD.js', '/assets/index-NEW.js'],
  });
  const dispatch = loadWorker(caches);
  await dispatch('activate');
  // Old build files go; build files missing from the cache stay missing.
  assert.deepEqual(caches.snapshot(), { [CACHE]: ['/', '/assets/index-NEW.js', '/logo.svg'] });
});

test('sw activate still deletes every other cache, such as an older version', async () => {
  const caches = fakeCaches({
    'jaghelm-v9.9.8': ['/', '/assets/index-OLD.js'],
    'some-other-cache': ['/x'],
    [CACHE]: ['/'],
  });
  const dispatch = loadWorker(caches);
  await dispatch('activate');
  assert.deepEqual(caches.snapshot(), { [CACHE]: ['/'] });
});

test('sw fetch caches an /assets/ response only when it is ok and not HTML', async () => {
  const caches = fakeCaches();
  const dispatch = loadWorker(caches, {
    network: {
      '/assets/SettingsView-NEW.js': reply(200, 'text/javascript; charset=utf-8'),
      // An index.html fallback for a removed chunk, from an older server or a proxy.
      '/assets/SettingsView-OLD.js': reply(200, 'text/html; charset=UTF-8'),
      '/assets/IframeView-OLD.js': reply(404, 'application/json; charset=utf-8'),
    },
  });

  const good = await fetchThrough(dispatch, '/assets/SettingsView-NEW.js');
  const html = await fetchThrough(dispatch, '/assets/SettingsView-OLD.js');
  const missing = await fetchThrough(dispatch, '/assets/IframeView-OLD.js');

  // The page still gets every answer; only the good one is kept.
  assert.deepEqual([good.status, html.status, missing.status], [200, 200, 404]);
  assert.deepEqual(caches.snapshot(), { [CACHE]: ['/assets/SettingsView-NEW.js'] });
});

test('sw fetch still caches the HTML app shell for offline use', async () => {
  const caches = fakeCaches();
  const dispatch = loadWorker(caches, { network: { '/': reply(200, 'text/html; charset=UTF-8') } });
  const shell = await fetchThrough(dispatch, '/');
  assert.equal(shell.status, 200);
  assert.deepEqual(caches.snapshot(), { [CACHE]: ['/'] });
});

test('sw fetch answers an offline visit to any page of the app with the cached shell', async () => {
  const caches = fakeCaches({ [CACHE]: ['/'] });
  const dispatch = loadWorker(caches);
  for (const page of ['/alerts', '/apps/grafana', '/settings/tabs']) {
    const shell = await fetchThrough(dispatch, page, { mode: 'navigate' });
    assert.ok(shell, `${page} gets an answer`);
    assert.equal(shell.headers.get('x-cached-url'), abs('/'), page);
  }
});

test('sw fetch serves a page its own cached copy offline, before the shell', async () => {
  const caches = fakeCaches({ [CACHE]: ['/', '/alerts'] });
  const dispatch = loadWorker(caches);
  const page = await fetchThrough(dispatch, '/alerts', { mode: 'navigate' });
  assert.equal(page.headers.get('x-cached-url'), abs('/alerts'));
});

test('sw fetch answers only a page load with the shell: a missing file offline stays missing', async () => {
  const caches = fakeCaches({ [CACHE]: ['/'] });
  const dispatch = loadWorker(caches);
  assert.equal(await fetchThrough(dispatch, '/uploads/logo.png'), undefined);
  assert.equal(await fetchThrough(dispatch, '/uploads/logo.png', { mode: 'no-cors' }), undefined);
});

test('sw fetch leaves /api to the network, even for a page load', async () => {
  const caches = fakeCaches({ [CACHE]: ['/'] });
  const dispatch = loadWorker(caches);
  assert.equal(await fetchThrough(dispatch, '/api/status', { mode: 'navigate' }), undefined);
});
