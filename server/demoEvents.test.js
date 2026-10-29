/**
 * #314: the demo answers GET /api/events with a history of its own board, as
 * the live store keeps it and the live route reads its query: so the Alerts
 * pages' History has something to show in the demo, its filters and pages
 * work there as on a live install, and what it says agrees with the board.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { demoEvents } from './demoEvents.js';
import { demoResponse } from './demo.js';
import { demoStatus } from './demoFixtures.js';
import { createAlertHistory } from './push/alertHistory.js';
import { failureSentence } from './failureWords.js';
import { RAW_DETAIL } from './testing/rawDetail.js';

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);
const ask = (query, scenario = 'incident') =>
  demoResponse({ path: '/api/events', query, scenario, now: NOW });
const ids = (out) => out.body.events.map((e) => e.id);

test('#314: every demo event is a record the live store keeps, none dropped, ids in order', () => {
  for (const scenario of ['incident', 'healthy']) {
    const file = demoEvents({ scenario, now: NOW });
    const warned = [];
    const h = createAlertHistory({
      now: () => NOW,
      logger: { debug() {}, info() {}, warn: (...a) => warned.push(a), error() {} },
    });
    h.load(file);
    assert.deepEqual(warned, [], scenario);
    const kept = h.page({ limit: 200 }).events;
    assert.equal(kept.length, file.events.length, `${scenario}: all within 30 days, none dropped`);
    assert.deepEqual(
      file.events.map((e) => e.id),
      file.events.map((_, i) => String(i + 1))
    );
    const times = file.events.map((e) => Date.parse(e.at));
    assert.deepEqual(
      times,
      [...times].sort((a, b) => a - b),
      `${scenario}: oldest first`
    );
    assert.ok(times.every((t) => t <= NOW));
  }
});

test("#314: the incident's open issues each have the event that opened them, at their since; healthy has none open", () => {
  const status = demoStatus({ scenario: 'incident', now: NOW });
  const { events } = demoEvents({ scenario: 'incident', now: NOW });
  assert.ok(status.issues.length > 0);
  for (const issue of status.issues) {
    // A node has past events too (the storage node's disk): the one at its since opened it.
    const opened = events.filter((e) => e.entity === issue.id && Date.parse(e.at) === issue.since);
    assert.equal(opened.length, 1, issue.id);
    // A drive's warning is a warning; everything else the incident opens is critical.
    assert.equal(opened[0].severity, issue.state === 'crit' ? 'critical' : 'warning', issue.id);
    if (issue.drives) assert.ok(issue.reason.includes(opened[0].reason), issue.id); // the drive's, in the node's
    else assert.equal(opened[0].reason, issue.reason, issue.id);
  }
  const healthy = demoEvents({ scenario: 'healthy', now: NOW }).events;
  assert.deepEqual(
    healthy.map((e) => e.entity),
    events
      .filter((e) => !status.issues.some((i) => i.id === e.entity && Date.parse(e.at) === i.since))
      .map((e) => e.entity),
    'the same past, without the open issues'
  );
});

test("#314: each event is about the demo board's entities, but for one service since removed", () => {
  const known = new Set(demoStatus({ scenario: 'incident', now: NOW }).entities.map((e) => e.id));
  const { events } = demoEvents({ scenario: 'incident', now: NOW });
  const gone = [...new Set(events.map((e) => e.entity).filter((id) => !known.has(id)))];
  // Prometheus is a source the model lists only while it fails.
  assert.deepEqual(gone.sort(), ['services/apps:plex', 'sources/prometheus']);
});

test('#314: the demo pages and filters /api/events as the live route does, newest first', async () => {
  const all = ask({});
  assert.equal(all.status, 200);
  const count = demoEvents({ now: NOW }).events.length;
  assert.equal(all.body.events.length, count);
  assert.equal(all.body.next, null);
  // The newest are the incident's open issues, which began together on the board's warm-up clock.
  assert.ok(
    ['services/apps:jellyfin', 'nodes/storage'].includes(all.body.events[0].entity),
    'the newest first'
  );

  const page = ask({ limit: '3' });
  assert.deepEqual(ids(page), [String(count), String(count - 1), String(count - 2)]);
  assert.equal(page.body.next, String(count - 2));
  assert.deepEqual(ids(ask({ limit: '3', before: page.body.next })).length, 3);

  const services = ask({ kind: 'services' }).body.events;
  assert.ok(services.length > 0);
  assert.ok(services.every((e) => e.entity.startsWith('services/')));
  const critical = ask({ severity: 'critical' }).body.events;
  assert.ok(critical.length > 0 && critical.every((e) => e.severity === 'critical'));
  assert.deepEqual(
    ask({ q: 'gitea' }).body.events.map((e) => e.type),
    ['service_recovered', 'service_down']
  );
  assert.deepEqual(ask({}, 'healthy').body.events[0].entity, 'services/apps:gitea');
});

test('#314: a demo query it cannot read is the live 400', () => {
  for (const [query, error] of [
    [{ severity: 'loud' }, /^severity must be/],
    [{ kind: 'service' }, /^kind must be/],
    [{ q: ' ' }, /^q must be/],
    [{ limit: '0' }, /^limit must be/],
  ]) {
    const out = ask(query);
    assert.equal(out.status, 400, JSON.stringify(query));
    assert.match(out.body.error, error);
  }
});

test('#314: the same clock, the same history', () => {
  assert.deepEqual(demoEvents({ now: NOW }), demoEvents({ now: NOW }));
  assert.deepEqual(ask({}), ask({}));
});

test("#605: the demo's Prometheus outage says why in the model's words, never a raw error", () => {
  for (const scenario of ['incident', 'healthy']) {
    const { events } = demoEvents({ scenario, now: NOW });
    const down = events.find((e) => e.type === 'source_down');
    const words = failureSentence('prometheus', { cause: 'refused' });
    assert.equal(words, 'Prometheus refused the connection');
    assert.deepEqual([down.body, down.reason], [`Prometheus · ${words}`, words], scenario);
    assert.doesNotMatch(JSON.stringify(events), RAW_DETAIL, `${scenario}: no event carries a raw error`);
  }
});
