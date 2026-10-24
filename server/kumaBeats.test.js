/**
 * Kuma's heartbeat strip (#312): each monitor's recent checks, at most
 * BEATS_KEPT (50) whatever Kuma sends, from Kuma's own beats when the load
 * read them (the status page path) and from a ring sampled once a cycle when
 * it didn't (the /metrics path), encoded compactly for /api/services and
 * decoded by the web.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BEATS_KEPT,
  createBeatStore,
  decodeBeats,
  decodeHistory,
  encodeBeats,
  kumaBeats,
  parseBeatTime,
} from './kumaBeats.js';

const T0 = Date.UTC(2026, 9, 23, 12, 0, 0);
const SECOND = 1000;

/** Kuma's heartbeatList entry for a beat `i` intervals of 30 s after T0. */
const raw = (i, status = 1, ping = 20 + (i % 5)) => ({
  status,
  ping: status === 1 ? ping : null,
  time: new Date(T0 + i * 30 * SECOND).toISOString().replace('T', ' ').replace('Z', ''),
});

test('BEATS_KEPT is the card\'s 50', () => {
  assert.equal(BEATS_KEPT, 50);
});

test("parseBeatTime reads Kuma's UTC time without a zone", () => {
  assert.equal(parseBeatTime('2026-10-23 12:00:30.000'), T0 + 30 * SECOND);
  assert.equal(parseBeatTime('2026-10-23T12:00:30Z'), T0 + 30 * SECOND);
  assert.equal(parseBeatTime('nonsense'), null);
  assert.equal(parseBeatTime(undefined), null);
});

test("kumaBeats: Kuma's own beats, oldest first, at most 50 whatever Kuma sends", () => {
  const list = Array.from({ length: 120 }, (_, i) => raw(i, i === 100 ? 0 : 1));
  const beats = kumaBeats(list);
  assert.equal(beats.length, BEATS_KEPT, 'bounded');
  assert.deepEqual(beats[0], { t: T0 + 70 * 30 * SECOND, s: 1, p: 20 }, 'the oldest kept is beat 70');
  assert.deepEqual(beats.at(-1), { t: T0 + 119 * 30 * SECOND, s: 1, p: 24 }, 'the newest last');
  assert.deepEqual(beats[30], { t: T0 + 100 * 30 * SECOND, s: 0, p: null }, 'a down beat has no ping');
});

test('kumaBeats: pending and maintenance kept, a beat without a time dropped, junk ignored', () => {
  const beats = kumaBeats([raw(0, 2), raw(1, 3), { status: 1, ping: 5 }, null, 'x', raw(2, 7)]);
  assert.deepEqual(
    beats.map((b) => b.s),
    [2, 3, null],
    "Kuma's pending (2) and maintenance (3); an unknown status is no data"
  );
  assert.deepEqual(kumaBeats(undefined), []);
  assert.deepEqual(kumaBeats({}), []);
});

test('kumaBeats: newest last even when Kuma lists them newest first', () => {
  const beats = kumaBeats([raw(3), raw(2), raw(1)]);
  assert.deepEqual(
    beats.map((b) => b.t),
    [1, 2, 3].map((i) => T0 + i * 30 * SECOND)
  );
});

test('encodeBeats and decodeBeats: a round trip, to the second, each beat its state', () => {
  const beats = [
    { t: T0, s: 1, p: 21 },
    { t: T0 + 30 * SECOND, s: 0, p: null },
    { t: T0 + 60 * SECOND, s: 2, p: 0 },
    { t: T0 + 90 * SECOND, s: 3, p: 18.6 },
    { t: T0 + 121 * SECOND, s: null, p: null },
  ];
  const encoded = encodeBeats(beats);
  assert.deepEqual(encoded, { t: T0 / 1000, d: [30, 30, 30, 31], s: '1023-', p: [21, 0, 0, 19, 0] });
  assert.deepEqual(decodeBeats(encoded), [
    { state: 'ok', time: T0, ping: 21 },
    { state: 'crit', time: T0 + 30 * SECOND, ping: null },
    { state: 'warn', time: T0 + 60 * SECOND, ping: null },
    { state: 'maintenance', time: T0 + 90 * SECOND, ping: 19 },
    { state: 'unknown', time: T0 + 121 * SECOND, ping: null },
  ]);
});

test('encodeBeats: none is an empty strip, not no strip', () => {
  const encoded = encodeBeats([]);
  assert.deepEqual(encoded, { t: null, d: [], s: '', p: [] });
  assert.deepEqual(decodeBeats(encoded), []);
});

test('decodeBeats: anything else is no strip (null); at most 50 beats', () => {
  for (const bad of [undefined, null, 'x', [], { s: 5 }, { s: '11', t: 'x' }]) {
    assert.equal(decodeBeats(bad), null, JSON.stringify(bad));
  }
  const long = { t: T0 / 1000, d: Array(79).fill(30), s: '1'.repeat(80), p: Array(80).fill(9) };
  const decoded = decodeBeats(long);
  assert.equal(decoded.length, BEATS_KEPT, 'a server sending more draws only the newest 50');
  assert.equal(decoded.at(-1).time, T0 + 79 * 30 * SECOND);
  // A short or missing time list: the beats still draw, without their times.
  assert.deepEqual(
    decodeBeats({ s: '10', p: [] }).map((b) => [b.state, b.time, b.ping]),
    [
      ['ok', null, null],
      ['crit', null, null],
    ]
  );
});

// ── The store: Kuma's beats, else a ring ─────────────────────────────────

/** A monitor as fetchMonitors gives it, from /metrics (no beats). */
const metricsMonitor = (id, kumaStatus = 'up', ping = 12) => ({
  id,
  name: `m${id}`,
  status: kumaStatus === 'up' || kumaStatus === 'down' ? kumaStatus : 'unknown',
  kumaStatus,
  ping,
  uptime24: 1,
  active: true,
  lastBeatAt: null,
});

test('store: a monitor with Kuma\'s beats serves them, bounded to 50', () => {
  const store = createBeatStore();
  const beats = Array.from({ length: 70 }, (_, i) => ({ t: T0 + i * SECOND, s: 1, p: 5 }));
  store.record({ ok: true, monitors: { 4: { ...metricsMonitor(4), beats } }, now: T0 });
  const out = store.encodedFor({ 'vm:app': '4' }, { ok: true });
  assert.deepEqual(Object.keys(out), ['vm:app']);
  assert.equal(out['vm:app'].s.length, BEATS_KEPT);
  assert.equal(store.size('4'), BEATS_KEPT);
});

test('store: without Kuma\'s beats, one beat per cycle in a ring that never grows past 50', () => {
  const store = createBeatStore();
  for (let i = 0; i < 75; i += 1) {
    const kumaStatus = i === 74 ? 'down' : i === 73 ? 'pending' : 'up';
    store.record({ ok: true, monitors: { 1: metricsMonitor(1, kumaStatus, 10 + i) }, now: T0 + i * 30 * SECOND });
    assert.ok(store.size('1') <= BEATS_KEPT, `cycle ${i}: ${store.size('1')}`);
  }
  assert.equal(store.size('1'), BEATS_KEPT);
  const [beats] = Object.values(store.encodedFor({ 'pi:adguard': '1' }, { ok: true })).map(decodeBeats);
  assert.equal(beats.length, BEATS_KEPT);
  assert.equal(beats[0].time, T0 + 25 * 30 * SECOND, 'the oldest 25 dropped');
  assert.deepEqual(beats.at(-1), { state: 'crit', time: T0 + 74 * 30 * SECOND, ping: null });
  assert.equal(beats.at(-2).state, 'warn');
  assert.equal(beats.at(-3).ping, 82, "the cycle's response time");
});

test('store: a cycle that could not read Kuma adds a beat with no data to each, still bounded', () => {
  const store = createBeatStore();
  const monitors = { 1: metricsMonitor(1), 2: { ...metricsMonitor(2), beats: [{ t: T0, s: 1, p: 3 }] } };
  store.record({ ok: true, monitors, now: T0 });
  // The failed load's monitors are the last ones Kuma gave: not read as new beats.
  for (let i = 1; i <= 60; i += 1) store.record({ ok: false, monitors, now: T0 + i * 30 * SECOND });
  assert.equal(store.size('1'), BEATS_KEPT);
  assert.equal(store.size('2'), BEATS_KEPT);
  const out = store.encodedFor({}, { ok: false });
  assert.deepEqual(Object.keys(out), [], 'no uid asked for, none given');
});

test('store: while Kuma is unreadable the last uids still get their beats', () => {
  const store = createBeatStore();
  store.record({ ok: true, monitors: { 1: metricsMonitor(1) }, now: T0 });
  store.encodedFor({ 'pi:adguard': '1' }, { ok: true });
  store.record({ ok: false, monitors: {}, now: T0 + 30 * SECOND });
  // Past Kuma's stale ceiling the load has no monitors, so no uid maps to one.
  const out = store.encodedFor({}, { ok: false });
  assert.deepEqual(Object.keys(out), ['pi:adguard']);
  assert.equal(out['pi:adguard'].s, '1-');
});

test("store: a status-page load whose heartbeat read failed (beats null) keeps the last beats, emptied or sampled over never", () => {
  const store = createBeatStore();
  const beats = Array.from({ length: 50 }, (_, i) => ({ t: T0 + i * SECOND, s: i === 49 ? 0 : 1, p: 7 }));
  store.record({ ok: true, monitors: { 4: { ...metricsMonitor(4), beats } }, now: T0 });
  const before = store.encodedFor({ 'vm:app': '4' }, { ok: true });
  // Kuma's page answered, its heartbeats didn't: no beats this time, not none.
  store.record({ ok: true, monitors: { 4: { ...metricsMonitor(4, 'unknown'), beats: null } }, now: T0 + 60 * SECOND });
  assert.deepEqual(store.encodedFor({ 'vm:app': '4' }, { ok: true }), before);
  assert.equal(store.size('4'), 50);
  // A monitor first seen on such a load has an empty strip until the next read.
  store.record({ ok: true, monitors: { 4: { ...metricsMonitor(4), beats: null }, 5: { ...metricsMonitor(5), beats: null } }, now: T0 + 90 * SECOND });
  assert.equal(store.encodedFor({ new: '5' }, { ok: true }).new.s, '');
});

test('store: a monitor Kuma no longer has is dropped, so the store holds only current monitors', () => {
  const store = createBeatStore();
  store.record({ ok: true, monitors: { 1: metricsMonitor(1), 2: metricsMonitor(2) }, now: T0 });
  store.record({ ok: true, monitors: { 2: metricsMonitor(2) }, now: T0 + 30 * SECOND });
  assert.equal(store.size('1'), 0);
  assert.equal(store.size('2'), 2);
  assert.deepEqual(Object.keys(store.encodedFor({ a: '1', b: '2' }, { ok: true })), ['b']);
});

test('store: a uid without a monitor gets no beats', () => {
  const store = createBeatStore();
  store.record({ ok: true, monitors: { 1: metricsMonitor(1) }, now: T0 });
  assert.deepEqual(store.encodedFor({}, { ok: true }), {});
  assert.deepEqual(Object.keys(store.encodedFor({ x: '9' }, { ok: true })), []);
});

test("store: a monitor from Kuma's status page with no beats yet is an empty strip", () => {
  const store = createBeatStore();
  store.record({ ok: true, monitors: { 3: { ...metricsMonitor(3), beats: [] } }, now: T0 });
  assert.deepEqual(store.encodedFor({ 'vm:new': '3' }, { ok: true }), {
    'vm:new': { t: null, d: [], s: '', p: [] },
  });
});

// #671: a monitor off Kuma's status page has only the ring JagHelm samples.
const monitor = (id, extra = {}) => ({ id, kumaStatus: 'up', ping: 12, ...extra });

test('#671: a monitor with Kuma beats is history "kuma"; one sampled is "since-restart"', () => {
  const store = createBeatStore();
  store.record({
    ok: true,
    now: T0,
    monitors: { a: monitor('1', { beats: [{ t: T0, s: 1, p: 5 }] }), b: monitor('2') },
  });
  const out = store.encodedFor({ 'n:a': '1', 'n:b': '2' }, { ok: true });
  assert.equal(out['n:a'].history, undefined);
  assert.equal(out['n:b'].history, 'since-restart');
  assert.equal(decodeHistory(out['n:a']), 'kuma');
  assert.equal(decodeHistory(out['n:b']), 'since-restart');
});

test('#671: a Kuma ring stays "kuma" through a cycle whose heartbeat read failed', () => {
  const store = createBeatStore();
  store.record({ ok: true, now: T0, monitors: { a: monitor('1', { beats: [{ t: T0, s: 1, p: 5 }] }) } });
  // /metrics path, heartbeat read failed: no `beats` key, so the cycle is sampled.
  store.record({ ok: true, now: T0 + 30 * SECOND, monitors: { a: monitor('1') } });
  assert.equal(store.encodedFor({ u: '1' }, { ok: true }).u.history, undefined);
  // Kuma unreadable: the label does not change either.
  store.record({ ok: false, now: T0 + 60 * SECOND, monitors: {} });
  assert.equal(store.encodedFor({ u: '1' }, { ok: false }).u.history, undefined);
});

test('#671: a monitor that leaves the status page, after being dropped, is "since-restart" again', () => {
  const store = createBeatStore();
  store.record({ ok: true, now: T0, monitors: { a: monitor('1', { beats: [{ t: T0, s: 1, p: 5 }] }) } });
  store.record({ ok: true, now: T0 + SECOND, monitors: {} });
  store.record({ ok: true, now: T0 + 2 * SECOND, monitors: { a: monitor('1') } });
  assert.equal(store.encodedFor({ u: '1' }, { ok: true }).u.history, 'since-restart');
});

test('#671: decodeHistory reads an older server (no field) and junk as "kuma": no label', () => {
  assert.equal(decodeHistory({ t: 1, d: [], s: '1', p: [0] }), 'kuma');
  assert.equal(decodeHistory(null), 'kuma');
  assert.equal(decodeHistory({ history: 'nonsense' }), 'kuma');
});
