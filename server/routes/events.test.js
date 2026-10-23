/**
 * GET /api/events (#267): the alert history, newest first, a page at a time.
 * The cursor is an event's id, so a page holds still while new events arrive;
 * `entity` and `severity` filter; the page size is bounded. The route is
 * mounted here over a real push snapshot in a temp dir; auth is the app's
 * (server/refresh.events.test.js asks it through index.js).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

import { createPushSnapshot } from '../push/dispatch.js';
import { EVENTS_PAGE_DEFAULT, EVENTS_PAGE_MAX } from '../push/alertHistory.js';
import { createEventsRoutes } from './events.js';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const dir = mkdtempSync(join(tmpdir(), 'jh-267-events-'));
after(() => rmSync(dir, { recursive: true, force: true }));

let files = 0;
/** An app serving the history of a fresh snapshot file, and that snapshot. */
function appWith() {
  const clock = { now: Date.UTC(2026, 9, 23, 9, 0, 0) };
  const snapshot = createPushSnapshot({ path: join(dir, `snap-${(files += 1)}.json`), logger: silent, now: () => clock.now });
  const app = express();
  app.use('/api/events', createEventsRoutes({ history: snapshot }));
  return { app, snapshot, clock };
}

const service = (key, state) => ({ services: { [key]: state }, hosts: {}, ups: { state: 'online' }, cron: {} });
const event = (type, key, severity) => ({
  type,
  id: key,
  node: key.split(':')[0],
  title: type,
  body: `${key} · words`,
  severity,
  reason: 'words',
});

/** Record `n` service_down events, one a cycle, keys s1..sn on n1; then more with `from`. */
function recordDowns(snapshot, n, from = 1) {
  for (let i = from; i < from + n; i += 1) {
    snapshot.advance(service(`n1:s${i}`, 'down'), [event('service_down', `n1:s${i}`, 'critical')], { push: false });
  }
}

const ids = (res) => res.body.events.map((e) => e.id);

test('#267: newest first, with each event as recorded and a cursor to the older ones', async () => {
  const { app, snapshot } = appWith();
  recordDowns(snapshot, 3);
  const res = await request(app).get('/api/events?limit=2');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /json/);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(ids(res), ['3', '2']);
  assert.equal(res.body.next, '2');
  assert.deepEqual(res.body.events[0], {
    id: '3',
    at: '2026-10-23T09:00:00.000Z',
    type: 'service_down',
    severity: 'critical',
    entity: 'services/n1:s3',
    title: 'service_down',
    body: 'n1:s3 · words',
    reason: 'words',
    node: 'n1',
    key: 'n1:s3',
    push: { state: 'off', phones: 0, suppressed: 0 },
  });
  const rest = await request(app).get(`/api/events?limit=2&before=${res.body.next}`);
  assert.deepEqual([ids(rest), rest.body.next], [['1'], null]);
});

test('#267: nothing recorded: an empty page, no cursor', async () => {
  const { app } = appWith();
  const res = await request(app).get('/api/events');
  assert.deepEqual([res.status, res.body], [200, { events: [], next: null }]);
});

test('#267: pagination is stable under new arrivals: the next page has no repeat and no gap', async () => {
  const { app, snapshot } = appWith();
  recordDowns(snapshot, 5);
  const first = await request(app).get('/api/events?limit=2');
  assert.deepEqual(ids(first), ['5', '4']);
  recordDowns(snapshot, 3, 6); // three new events while the client reads page one
  const second = await request(app).get(`/api/events?limit=2&before=${first.body.next}`);
  assert.deepEqual(ids(second), ['3', '2']);
  const third = await request(app).get(`/api/events?limit=2&before=${second.body.next}`);
  assert.deepEqual([ids(third), third.body.next], [['1'], null]);
  const top = await request(app).get('/api/events?limit=3');
  assert.deepEqual(ids(top), ['8', '7', '6'], 'the new ones are on top');
});

test('#267: filter by entity (repeat it for several) and by severity (a comma list or repeated)', async () => {
  const { app, snapshot } = appWith();
  snapshot.advance(service('n1:a', 'down'), [event('service_down', 'n1:a', 'critical')], { push: false });
  snapshot.advance(service('n1:b', 'down'), [event('service_down', 'n1:b', 'critical')], { push: false });
  snapshot.advance(service('n1:a', 'up'), [event('service_recovered', 'n1:a', 'info')], { push: false });
  snapshot.advance(service('pve:disk', 'warn'), [event('host_threshold', 'pve:disk', 'warning')], { push: false });

  const a = await request(app).get('/api/events').query({ entity: 'services/n1:a' });
  assert.deepEqual(ids(a), ['3', '1']);
  const node = await request(app).get('/api/events?entity=nodes%2Fpve');
  assert.deepEqual(ids(node), ['4'], 'a reading is its node');
  const two = await request(app).get('/api/events?entity=services/n1:a&entity=services/n1:b');
  assert.deepEqual(ids(two), ['3', '2', '1']);
  const info = await request(app).get('/api/events?severity=info');
  assert.deepEqual(ids(info), ['3']);
  const loud = await request(app).get('/api/events?severity=critical,warning');
  assert.deepEqual(ids(loud), ['4', '2', '1']);
  const repeated = await request(app).get('/api/events?severity=critical&severity=warning');
  assert.deepEqual(ids(repeated), ['4', '2', '1']);
  const both = await request(app).get('/api/events?severity=critical&entity=services/n1:a&limit=1');
  assert.deepEqual([ids(both), both.body.next], [['1'], null]);
  const pagedFilter = await request(app).get('/api/events?entity=services/n1:a&limit=1');
  assert.deepEqual([ids(pagedFilter), pagedFilter.body.next], [['3'], '3']);
  const more = await request(app).get('/api/events?entity=services/n1:a&limit=1&before=3');
  assert.deepEqual([ids(more), more.body.next], [['1'], null], 'the cursor pages within the filter');
});

test(`#267: the page size defaults to ${EVENTS_PAGE_DEFAULT} and never passes ${EVENTS_PAGE_MAX}`, async () => {
  const { app, snapshot } = appWith();
  recordDowns(snapshot, EVENTS_PAGE_MAX + 10);
  const plain = await request(app).get('/api/events');
  assert.equal(plain.body.events.length, EVENTS_PAGE_DEFAULT);
  const huge = await request(app).get('/api/events?limit=100000');
  assert.equal(huge.body.events.length, EVENTS_PAGE_MAX);
  assert.equal(huge.body.next, '11');
});

test('#267: a query it cannot read is a 400 that says which', async () => {
  const { app } = appWith();
  const cases = [
    ['limit=0', 'limit must be a whole number from 1'],
    ['limit=abc', 'limit must be a whole number from 1'],
    ['limit=1&limit=2', 'limit must be a whole number from 1'],
    ['before=x', 'before must be an event id'],
    ['before=0', 'before must be an event id'],
    ['severity=loud', 'severity must be critical, warning or info'],
    ['severity=', 'severity must be critical, warning or info'],
    ['entity=', 'entity must be an entity id'],
    ['entity[a]=b', 'entity must be an entity id'],
  ];
  for (const [query, error] of cases) {
    const res = await request(app).get(`/api/events?${query}`);
    assert.equal(res.status, 400, query);
    assert.match(res.body.error, new RegExp(`^${error}`), query);
  }
});
