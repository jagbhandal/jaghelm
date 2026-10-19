// Runs the service worker (public/sw.js) against a fake CacheStorage and checks
// what its install and activate handlers leave in the cache.
//
// The test lives here, not beside sw.js: Vite copies public/ into dist/ verbatim,
// and the node:test glob doesn't cover public/. Each test builds the worker the
// way `npm run build` does, through injectIntoSw, then runs it in a vm context
// whose `self` and `caches` are the fakes below.
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
const BUNDLES = ['/assets/index-NEW.css', '/assets/index-NEW.js', '/assets/vendor-react-NEW.js'];

const abs = (url) => new URL(url, SW_URL).href;
const keyOf = (request) => (typeof request === 'string' ? abs(request) : request.url);

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
    delete: async (request) => store.delete(keyOf(request)),
  });
  return {
    keys: async () => [...stores.keys()],
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Set());
      return cacheFor(stores.get(name));
    },
    delete: async (name) => stores.delete(name),
    /** Test view: cache name -> sorted URL paths. */
    snapshot: () =>
      Object.fromEntries(
        [...stores].map(([name, urls]) => [
          name,
          [...urls].map((u) => new URL(u).pathname + new URL(u).search).sort(),
        ])
      ),
  };
}

/** Load the built worker into a vm context; returns dispatch(type) that awaits the handler's waitUntil. */
function loadWorker(caches, assets = BUNDLES) {
  const listeners = {};
  const self = {
    location: new URL(SW_URL),
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const fetch = () => Promise.reject(new Error('no network in this test'));
  vm.runInNewContext(
    injectIntoSw(SW_SOURCE, assets, VERSION),
    { self, caches, fetch, URL, Request },
    { filename: 'sw.js' }
  );
  return async (type) => {
    const pending = [];
    listeners[type]({ waitUntil: (promise) => pending.push(promise) });
    await Promise.all(pending);
  };
}

test('sw activate trims the cache back to exactly what install precached', async () => {
  const caches = fakeCaches();
  const dispatch = loadWorker(caches);
  await dispatch('install');
  const precached = caches.snapshot()[CACHE];
  assert.deepEqual(precached, ['/', ...BUNDLES, '/favicon.svg', '/logo.svg'].sort());

  // Same version, so the same cache: a redeploy's leftovers and runtime fills.
  const cache = await caches.open(CACHE);
  for (const leftover of [
    '/assets/index-OLD.js', // previous deploy's first-paint bundle
    '/assets/SettingsView-OLD.js', // a lazy chunk cached on first use
    '/manifest.json', // a network-first copy of a public file
    '/?tab=services', // a navigation with a query string
  ]) {
    await cache.put(leftover);
  }

  await dispatch('activate');
  assert.deepEqual(caches.snapshot(), { [CACHE]: precached });
});

test('sw activate trims a cache the worker did not fill itself', async () => {
  const caches = fakeCaches({
    [CACHE]: ['/', '/logo.svg', '/assets/index-OLD.js', '/assets/index-NEW.js'],
  });
  const dispatch = loadWorker(caches);
  await dispatch('activate');
  // Only manifest entries survive; manifest entries missing from the cache stay missing.
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
