/**
 * Kuma monitor fetcher — the stale-serving ceiling.
 *
 * The cache may serve last-known statuses while Kuma is briefly unreachable,
 * but only up to STALE_CEILING_MS (5 min). Past that, a sustained outage must
 * surface "unknown" (empty map) rather than freeze the board on stale "up"s.
 *
 * Regression guard for the !ok path, which previously returned the raw cache
 * (`cachedMonitors || {}`) and so bypassed the ceiling entirely.
 *
 * Runs in its own process (node:test spawns per file), and stubs globalThis.fetch
 * (which safeFetch ultimately calls) + Date.now to drive the clock past the ceiling.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { initMonitors, fetchMonitors } = await import('./monitors.js');

// A trusted loopback URL passes the SSRF guard; we never hit the network because
// globalThis.fetch is stubbed.
initMonitors('http://localhost:9999');

const realFetch = globalThis.fetch;
const realNow = Date.now;

function mockResponse({ ok, body }) {
  return {
    ok,
    status: ok ? 200 : 503,
    headers: { get: () => null }, // no location, no content-length → capBody passes through
    body: null,
    json: async () => body,
  };
}

test('monitors: a fresh ok fetch primes the cache with live statuses', async () => {
  globalThis.fetch = async () =>
    mockResponse({
      ok: true,
      body: {
        publicGroupList: [
          { monitorList: [{ id: 1, name: 'grafana' }] },
        ],
        heartbeatList: { 1: [{ status: 1, ping: 5 }] },
        uptimeList: { '1_24': 0.99 },
      },
    });
  try {
    const m = await fetchMonitors(true);
    assert.equal(m[1]?.status, 'up', 'live status loaded into cache');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('monitors: a stale cache PAST the ceiling is NOT served on !ok', async () => {
  // Kuma now returns 5xx on the status-page endpoint.
  globalThis.fetch = async () => mockResponse({ ok: false, body: {} });
  // Advance the clock well past STALE_CEILING_MS (5 min) since the cache was primed.
  const base = realNow();
  Date.now = () => base + 10 * 60 * 1000;
  try {
    const m = await fetchMonitors(true);
    assert.deepEqual(m, {}, 'stale cache past the ceiling is dropped, not frozen');
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
  }
});

test('monitors: a stale cache WITHIN the ceiling is still served on !ok', async () => {
  // Re-prime the cache fresh.
  globalThis.fetch = async () =>
    mockResponse({
      ok: true,
      body: {
        publicGroupList: [{ monitorList: [{ id: 1, name: 'grafana' }] }],
        heartbeatList: { 1: [{ status: 1, ping: 5 }] },
        uptimeList: { '1_24': 0.99 },
      },
    });
  await fetchMonitors(true);

  // Kuma goes 5xx, but only 1 minute has elapsed — within the 5-min ceiling.
  globalThis.fetch = async () => mockResponse({ ok: false, body: {} });
  const base = realNow();
  Date.now = () => base + 60 * 1000;
  try {
    const m = await fetchMonitors(true);
    assert.equal(m[1]?.status, 'up', 'recent cache still served during a brief outage');
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
  }
});
