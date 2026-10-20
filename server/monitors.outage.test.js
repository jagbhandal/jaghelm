// server/monitors.outage.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { initMonitors, fetchMonitors, selectUnclaimedMonitors, parseBeatTime } = await import('./monitors.js');

test('selectUnclaimedMonitors: up or down + active + unconsumed only', () => {
  const monitors = {
    1: { id: 1, name: 'grafana', status: 'down', active: true },
    2: { id: 2, name: 'gitea', status: 'up', active: true },       // up: kept for the push snapshot (#390)
    3: { id: 3, name: 'plex', status: 'down', active: true },   // consumed
    4: { id: 4, name: 'old', status: 'down', active: false },   // paused/retired
    5: { id: 5, name: 'pending', status: 'unknown', active: true }, // pending: neither up nor down
    6: { id: 6, name: 'paused-up', status: 'up', active: false },
  };
  const consumed = new Set([3]);
  const out = selectUnclaimedMonitors(monitors, consumed).map((m) => m.id);
  assert.deepEqual(out, [1, 2]);
});

test('selectUnclaimedMonitors: in id order, whatever order Kuma listed them in (#395)', () => {
  const list = [
    { id: 12, name: 'b', status: 'up', active: true },
    { id: 3, name: 'a', status: 'down', active: true },
    { id: 7, name: 'c', status: 'up', active: true },
  ];
  assert.deepEqual(selectUnclaimedMonitors(list, new Set()).map((m) => m.id), [3, 7, 12]);
  assert.deepEqual(selectUnclaimedMonitors([...list].reverse(), new Set()).map((m) => m.id), [3, 7, 12]);
});

test('selectUnclaimedMonitors: tolerates the empty-array fallback from a failed fetch', () => {
  assert.deepEqual(selectUnclaimedMonitors([], new Set()), []);
});

test('selectUnclaimedMonitors: a STALE monitor is excluded, down or up (paused/retired — heartbeat stopped)', () => {
  const now = 10_000_000;
  const monitors = {
    1: { id: 1, name: 'fresh-down', status: 'down', active: true, lastBeatAt: now - 30_000 },        // 30s old → fresh
    2: { id: 2, name: 'stale-down', status: 'down', active: true, lastBeatAt: now - 20 * 60_000 },   // 20min old → stale
    3: { id: 3, name: 'no-beat-time', status: 'down', active: true, lastBeatAt: null },              // unparseable → fresh default
    4: { id: 4, name: 'stale-up', status: 'up', active: true, lastBeatAt: now - 20 * 60_000 },       // paused while up → no false recovery
    5: { id: 5, name: 'fresh-up', status: 'up', active: true, lastBeatAt: now - 30_000 },
  };
  const out = selectUnclaimedMonitors(monitors, new Set(), { now, staleMs: 10 * 60_000 }).map((m) => m.id);
  assert.deepEqual(out, [1, 3, 5]);   // stale (2, 4) excluded; fresh (1, 5) + null-beat (3) kept
});

test('selectUnclaimedMonitors: the freshness boundary is inclusive (age === staleMs is still fresh)', () => {
  const now = 1_000_000;
  const monitors = { 1: { id: 1, name: 'edge', status: 'down', active: true, lastBeatAt: now - 600_000 } };
  assert.deepEqual(selectUnclaimedMonitors(monitors, new Set(), { now, staleMs: 600_000 }).map((m) => m.id), [1]);
});

test('parseBeatTime: parses a UTC Kuma timestamp and rejects junk', () => {
  // "YYYY-MM-DD HH:mm:ss.SSS" has no zone but is UTC → must equal the same instant with Z.
  assert.equal(parseBeatTime('2026-06-27 06:58:58.625'), Date.parse('2026-06-27T06:58:58.625Z'));
  assert.equal(parseBeatTime('2026-06-27T06:58:58.625Z'), Date.parse('2026-06-27T06:58:58.625Z')); // already ISO+Z
  assert.equal(parseBeatTime(null), null);
  assert.equal(parseBeatTime(''), null);
  assert.equal(parseBeatTime('not a date'), null);
});

test('fetchMonitors: carries lastBeatAt parsed from the LATEST heartbeat time', async () => {
  initMonitors('http://localhost:9999');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    mockResponse({
      ok: true,
      body: {
        publicGroupList: [{ monitorList: [{ id: 20, name: 'svc' }] }],
        heartbeatList: { 20: [
          { status: 1, ping: 5, time: '2026-06-27 06:00:00.000' },
          { status: 0, ping: 0, time: '2026-06-27 06:01:00.000' },  // latest
        ] },
        uptimeList: {},
      },
    });
  try {
    const { monitors: m } = await fetchMonitors(true);
    assert.equal(m[20].lastBeatAt, Date.parse('2026-06-27T06:01:00.000Z'));
  } finally {
    globalThis.fetch = realFetch;
  }
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
    const { monitors: m } = await fetchMonitors(true);
    assert.equal(m[10].active, false);
    assert.equal(m[11].active, true);
    assert.equal(m[10].status, 'down');           // heartbeat 0 → down
  } finally {
    globalThis.fetch = realFetch;
  }
});
