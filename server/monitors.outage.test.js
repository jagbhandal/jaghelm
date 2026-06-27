// server/monitors.outage.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { initMonitors, fetchMonitors, selectOutageMonitors } = await import('./monitors.js');

test('selectOutageMonitors: down + active + unconsumed only', () => {
  const monitors = {
    1: { id: 1, name: 'grafana', status: 'down', active: true },
    2: { id: 2, name: 'gitea', status: 'up', active: true },
    3: { id: 3, name: 'plex', status: 'down', active: true },   // consumed
    4: { id: 4, name: 'old', status: 'down', active: false },   // paused/retired
    5: { id: 5, name: 'pending', status: 'unknown', active: true },
  };
  const consumed = new Set([3]);
  const out = selectOutageMonitors(monitors, consumed).map((m) => m.id);
  assert.deepEqual(out, [1]);
});

test('selectOutageMonitors: tolerates the empty-array fallback from a failed fetch', () => {
  assert.deepEqual(selectOutageMonitors([], new Set()), []);
});

function mockResponse({ ok, body }) {
  return { ok, status: ok ? 200 : 503, headers: { get: () => null }, body: null, json: async () => body };
}

test('fetchMonitors: carries active flag (false when Kuma marks inactive, true by default)', async () => {
  initMonitors('http://localhost:9999');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    mockResponse({
      ok: true,
      body: {
        publicGroupList: [{ monitorList: [
          { id: 10, name: 'paused-svc', active: false },
          { id: 11, name: 'live-svc' },           // no active field → defaults true
        ] }],
        heartbeatList: { 10: [{ status: 0, ping: 0 }], 11: [{ status: 0, ping: 1 }] },
        uptimeList: {},
      },
    });
  try {
    const m = await fetchMonitors(true);
    assert.equal(m[10].active, false);
    assert.equal(m[11].active, true);
    assert.equal(m[10].status, 'down');           // heartbeat 0 → down
  } finally {
    globalThis.fetch = realFetch;
  }
});
