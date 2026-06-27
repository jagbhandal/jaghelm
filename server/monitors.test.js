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

// Canonical status-page response body (one 'grafana' monitor, up, 99% 24h).
const STATUS_PAGE_BODY = {
  publicGroupList: [{ monitorList: [{ id: 1, name: 'grafana' }] }],
  heartbeatList: { 1: [{ status: 1, ping: 5 }] },
  uptimeList: { '1_24': 0.99 },
};

test('monitors: a fresh ok fetch primes the cache with live statuses', async () => {
  globalThis.fetch = async () => mockResponse({ ok: true, body: STATUS_PAGE_BODY });
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
  globalThis.fetch = async () => mockResponse({ ok: true, body: STATUS_PAGE_BODY });
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

// ── /metrics path + status-page fallback ───────────────────────────────────
// Mirrors a real Kuma 2.3.2 /metrics block (tag label, monitor_id, 1d/30d/365d).
const METRICS_SAMPLE = `monitor_status{Infrastructure="",monitor_id="2",monitor_name="Vaultwarden",monitor_type="http",monitor_url="https://vault.jagbhandal.com",monitor_hostname="null",monitor_port="null"} 1
monitor_response_time{Infrastructure="",monitor_id="2",monitor_name="Vaultwarden",monitor_type="http",monitor_url="https://vault.jagbhandal.com",monitor_hostname="null",monitor_port="null"} 137
monitor_uptime_ratio{Infrastructure="",monitor_id="2",monitor_name="Vaultwarden",monitor_type="http",monitor_url="https://vault.jagbhandal.com",monitor_hostname="null",monitor_port="null",window="1d"} 1`;

function mockText({ ok, status, text = '' }) {
  return {
    ok,
    status: status ?? (ok ? 200 : 503),
    headers: { get: () => null },
    body: null,
    text: async () => text,
    json: async () => ({}),
  };
}

test('monitors: with KUMA_API_KEY, a good /metrics response is used (status-page NOT called)', async () => {
  initMonitors('http://localhost:9999', 'uk1_testkey');
  let statusPageHit = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/metrics')) return mockText({ ok: true, text: METRICS_SAMPLE });
    statusPageHit++;
    return mockResponse({ ok: true, body: STATUS_PAGE_BODY });
  };
  try {
    const m = await fetchMonitors(true);
    assert.equal(m[2]?.status, 'up', 'parsed live status from /metrics');
    assert.equal(m[2]?.ping, 137);
    assert.equal(m[2]?.uptime24, 1);
    assert.equal(statusPageHit, 0, 'status-page API not called when /metrics succeeds');
  } finally {
    globalThis.fetch = realFetch;
    initMonitors('http://localhost:9999'); // reset to no-key for any later tests
  }
});

test('monitors: with KUMA_API_KEY, a 401 on /metrics falls back to the status-page API', async () => {
  initMonitors('http://localhost:9999', 'uk1_badkey');
  let statusPageHit = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/metrics')) return mockText({ ok: false, status: 401 });
    statusPageHit++;
    return mockResponse({ ok: true, body: STATUS_PAGE_BODY });
  };
  try {
    const m = await fetchMonitors(true);
    assert.equal(m[1]?.status, 'up', 'fell back to the status-page monitor');
    assert.ok(statusPageHit >= 1, 'status-page API was used as fallback');
  } finally {
    globalThis.fetch = realFetch;
    initMonitors('http://localhost:9999');
  }
});

test('monitors: with KUMA_API_KEY, a /metrics body with no monitor_id falls back (Kuma < 2.1)', async () => {
  initMonitors('http://localhost:9999', 'uk1_oldkuma');
  let statusPageHit = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/metrics')) {
      // pre-2.1 Kuma: monitor series carry no monitor_id label
      return mockText({ ok: true, text: 'monitor_status{monitor_name="grafana"} 1' });
    }
    statusPageHit++;
    return mockResponse({ ok: true, body: STATUS_PAGE_BODY });
  };
  try {
    const m = await fetchMonitors(true);
    assert.equal(m[1]?.status, 'up', 'empty parse → status-page fallback');
    assert.ok(statusPageHit >= 1);
  } finally {
    globalThis.fetch = realFetch;
    initMonitors('http://localhost:9999');
  }
});
