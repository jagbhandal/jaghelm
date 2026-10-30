/**
 * A container in a restart loop, or OOM-killed, pushes (#764, spec §8): the
 * status model lists `restart_loop` and `oom_kill` issues from the last hour of
 * cAdvisor events (containerEvents.js, #761), the push snapshot records them
 * (`containerConditions`), and the differ pages each once and sends the
 * recovery. Run end to end through the real model and the real push cycle
 * (testing/pushPipeline.js), as missingContainer.test.js does for #775. The
 * ways to silence it (Ack, Snooze, quiet hours, the service switch) each have
 * a test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cachesOf, pushPipeline } from '../testing/pushPipeline.js';
import { card, inputs, node, once, UPS_ONLINE } from '../testing/statusFixtures.js';
import { CONTAINER_CONDITIONS, RESTART_LOOP_LIMIT, containerConditionIssues } from '../status/containerConditions.js';
import { chartOfIssue } from '../monitoringFocus.js';
import { RESTART_LOOP_WINDOW_MS } from '../containerEvents.js';
import { alertKey, alertKind, categoryOf, createPushSnapshot, runPushCycle, shouldDeliver } from './dispatch.js';
import { buildContainerConditions } from './snapshot.js';
import { createPushSender } from './outbox.js';
import { createAlertPolicy } from './alertPolicy.js';
import { createAlertState } from './alertState.js';
import { resolveAlerts } from './alertRules.js';
import { entityOf } from './entity.js';

const MIN = 60_000;
const START = 1_782_345_600_000;
const OK = { prometheus: { ok: true }, kuma: { ok: true } };
const CYCLE_STEP = 30_000; // pushPipeline's CYCLE_MS

/** `n` restarts of `name` on `nodeKey`, the last one `agoMs` before `at`, ten minutes apart. */
const restarts = (n, { name = 'web', nodeKey = 'apps', at = START, agoMs = MIN } = {}) =>
  Array.from({ length: n }, (_, i) => ({
    time: at - agoMs - i * 10 * MIN,
    kind: 'restart',
    node: nodeKey,
    name,
    how: 'container recreated',
  }));
const oom = ({ name = 'web', nodeKey = 'apps', at = START, agoMs = MIN, count = 1 } = {}) => ({
  time: at - agoMs,
  kind: 'oom',
  node: nodeKey,
  name,
  count,
});
/** The `containerEvents` cache value: a read that answered. */
const read = (events, extra = {}) => ({ state: 'ok', events, blindNodes: [], oomCounter: true, ...extra });

/** One cycle's caches: node `apps` running `web`, with `containerEvents` as read. */
const board = (containerEvents) =>
  cachesOf({
    services: { sources: OK, nodes: { apps: node({}, { services: [card('apps:web')] }) } },
    ups: UPS_ONLINE,
    containerEvents,
  });

const sentOf = (p) => p.sent.filter((s) => s.startsWith('container_'));

test('the limit is Grafana\'s: more than 3 restarts in an hour is a restart loop, 3 is not', () => {
  assert.equal(RESTART_LOOP_LIMIT, 3);
  assert.equal(RESTART_LOOP_WINDOW_MS, 3_600_000);
  assert.deepEqual(CONTAINER_CONDITIONS, ['restart_loop', 'oom_kill']);
  assert.deepEqual(containerConditionIssues(read(restarts(3)), { now: START }), []);
  const [issue, ...rest] = containerConditionIssues(read(restarts(4)), { now: START });
  assert.equal(rest.length, 0);
  assert.equal(issue.kind, 'container');
  assert.equal(issue.condition, 'restart_loop');
  assert.equal(issue.id, 'containers/apps:web:restart_loop');
  assert.equal(issue.state, 'warn');
  assert.equal(issue.word, 'Restart loop');
  assert.equal(issue.reason, 'Restart loop: 4 restarts in the last hour (limit 3)');
  assert.equal(issue.since, START - MIN - 30 * MIN, 'since is the first restart of the hour');
  // The banner maps the pair to the restarts chart (monitoringFocus.js, #761).
  assert.equal(chartOfIssue(issue), 'restarts');
});

test('an OOM kill is a condition on its own, and restarts that are older than the hour do not count', () => {
  const [issue] = containerConditionIssues(read([oom({ count: 2 })]), { now: START });
  assert.equal(issue.condition, 'oom_kill');
  assert.equal(issue.id, 'containers/apps:web:oom_kill');
  assert.equal(issue.word, 'OOM killed');
  assert.equal(issue.reason, 'Out of memory: killed 2 times in the last hour');
  assert.equal(chartOfIssue(issue), 'restarts');
  // Four restarts, but only three in the last hour.
  const old = restarts(4, { agoMs: 31 * MIN });
  assert.equal(containerConditionIssues(read(old), { now: START }).length, 0);
  // A read that did not answer, or a board with no containers reporting, judges nothing.
  for (const bad of [null, { state: 'no-containers', events: [] }, { state: 'ok' }]) {
    assert.deepEqual(containerConditionIssues(bad, { now: START }), []);
  }
});

test('the model lists the issues, ranked and worded in the sentence, and leaves the container card alone', () => {
  const status = once(
    inputs({
      nodes: { apps: node({}, { services: [card('apps:web')] }) },
      containerEvents: read([...restarts(5), oom({ name: 'db' })]),
    })
  );
  // Oldest first within a level (rankIssues): the loop's first restart is 41 minutes back, the kill a minute.
  assert.deepEqual(
    status.issues.map((i) => i.id),
    ['containers/apps:web:restart_loop', 'containers/apps:db:oom_kill']
  );
  assert.equal(status.overall.state, 'warn');
  assert.equal(status.overall.sentence, '1 container in a restart loop · 1 container OOM killed');
  // No entity: the Services tile still counts one running container.
  assert.equal(status.entities.find((e) => e.id === 'services/apps:web').state, 'ok');
  assert.equal(status.subsystems.find((s) => s.id === 'services').counts.total, 1);
  // Without a read the model is what it was.
  assert.equal(once(inputs({ nodes: { apps: node({}, { services: [card('apps:web')] }) } })).issues.length, 0);
});

test('a per-container limit (#798) reaches the model, the banner and the push', async () => {
  const limits = { 'apps:web': 4 };
  const withLimits = (n) =>
    once(
      inputs({
        nodes: { apps: node({}, { services: [card('apps:web')] }) },
        containerEvents: read(restarts(n)),
        restartLimits: limits,
      })
    );
  assert.equal(withLimits(4).issues.length, 0, 'at its limit: quiet');
  assert.equal(withLimits(5).issues[0].reason, 'Restart loop: 5 restarts in the last hour (limit 4)');
  const p = pushPipeline({ start: START });
  try {
    await p.cycle(board(read(restarts(4, { at: p.now }))), { restartLimits: limits });
    assert.deepEqual(sentOf(p), []);
    await p.cycle(board(read(restarts(5, { at: p.now }))), { restartLimits: limits });
    assert.deepEqual(sentOf(p), ['container_restart_loop apps:web']);
    assert.match(p.events.find((e) => e.type === 'container_restart_loop').body, /\(limit 4\)/);
  } finally {
    p.close?.();
  }
});

test('a restart loop pages once, with the container and the count, and the recovery follows when the hour is quiet', async () => {
  const p = pushPipeline({ start: START });
  try {
    await p.cycle(board(read([])));
    assert.deepEqual(sentOf(p), []);
    await p.cycle(board(read(restarts(4, { at: p.now }))));
    assert.deepEqual(sentOf(p), ['container_restart_loop apps:web']);
    const page = p.events.find((e) => e.type === 'container_restart_loop');
    assert.equal(page.severity, 'warning');
    assert.equal(page.node, 'apps');
    assert.match(page.body, /^web on apps · Restart loop: 4 restarts in the last hour/);
    assert.equal(entityOf(page), 'services/apps:web');
    assert.equal(alertKind(page), 'page');
    assert.equal(p.snapshot.prev().containerConditions['apps:web:restart_loop'], 'warn');
    // Still looping, 20 cycles: no second page.
    for (let i = 0; i < 20; i += 1) await p.cycle(board(read(restarts(5, { at: p.now }))));
    assert.equal(sentOf(p).length, 1);
    // The hour passes with no restarts: the recovery, once, then nothing.
    await p.cycle(board(read([])));
    assert.deepEqual(sentOf(p), ['container_restart_loop apps:web', 'container_restart_loop_cleared apps:web']);
    const back = p.events.at(-1);
    assert.equal(back.severity, 'info');
    assert.equal(alertKey(back), alertKey(page), 'a page and its recovery share Snooze and Ack');
    assert.equal(alertKind(back), 'recovery');
    assert.equal(p.snapshot.prev().containerConditions['apps:web:restart_loop'], 'ok');
    await p.cycle(board(read([])));
    await p.cycle(board(read([])));
    assert.equal(sentOf(p).length, 2);
    assert.equal(p.snapshot.prev().containerConditions, undefined, 'the entry is forgotten');
    const history = p.snapshot.events({}).events.map((e) => e.type).sort();
    assert.deepEqual(history, ['container_restart_loop', 'container_restart_loop_cleared']);
  } finally {
    p.close();
  }
});

test('an OOM kill pages once and clears an hour later; it is its own episode beside a restart loop', async () => {
  const p = pushPipeline({ start: START });
  try {
    await p.cycle(board(read([])));
    await p.cycle(board(read([oom({ at: p.now }), ...restarts(4, { at: p.now })])));
    assert.deepEqual(sentOf(p).sort(), ['container_oom_kill apps:web', 'container_restart_loop apps:web']);
    const [kill, loop] = ['container_oom_kill', 'container_restart_loop'].map((t) => p.events.find((e) => e.type === t));
    assert.notEqual(alertKey(kill), alertKey(loop), 'Ack on one does not hide the other');
    assert.match(kill.body, /^web on apps · Out of memory: killed 1 time in the last hour/);
    // The restarts stop, the kill is still inside the hour: only the loop recovers.
    await p.cycle(board(read([oom({ at: p.now, agoMs: 5 * MIN })])));
    assert.deepEqual(sentOf(p).slice(2), ['container_restart_loop_cleared apps:web']);
    // An hour later the kill has aged out.
    p.advance(RESTART_LOOP_WINDOW_MS);
    await p.cycle(board(read([])));
    assert.deepEqual(sentOf(p).slice(3), ['container_oom_cleared apps:web']);
    assert.equal(p.events.at(-1).severity, 'info');
  } finally {
    p.close();
  }
});

test('nothing is a recovery while the events cannot say it cleared: no read, no containers reporting, or the node blind', async () => {
  const p = pushPipeline({ start: START });
  try {
    await p.cycle(board(read(restarts(4, { at: p.now }))));
    assert.equal(sentOf(p).length, 1);
    for (const gap of [null, { state: 'no-containers', events: [] }, read([], { blindNodes: ['apps'] })]) {
      await p.cycle(board(gap));
      assert.equal(sentOf(p).length, 1, JSON.stringify(gap));
      assert.equal(p.snapshot.prev().containerConditions['apps:web:restart_loop'], 'warn');
    }
    // No second page when the loop is seen again after the gap.
    await p.cycle(board(read(restarts(6, { at: p.now }))));
    assert.equal(sentOf(p).length, 1);
    await p.cycle(board(read([])));
    assert.equal(sentOf(p).length, 2, 'then the real recovery');
  } finally {
    p.close();
  }
});

test('a restart keeps the page: JagHelm restarting mid-loop does not page again', async () => {
  const p = pushPipeline({ start: START });
  try {
    await p.cycle(board(read(restarts(4, { at: p.now }))));
    assert.equal(sentOf(p).length, 1);
    p.restart();
    await p.cycle(board(read(restarts(4, { at: p.now }))));
    assert.equal(sentOf(p).length, 1);
  } finally {
    p.close();
  }
});

test('buildContainerConditions: new and held keys, the one cycle of ok, then gone', () => {
  const status = { issues: [{ id: 'containers/a:x:oom_kill', kind: 'container', condition: 'oom_kill' }, { id: 'services/a:y', kind: 'container' }] };
  assert.deepEqual(buildContainerConditions(status, undefined, read([])), { 'a:x:oom_kill': 'warn' });
  assert.deepEqual(buildContainerConditions({ issues: [] }, { 'a:x:oom_kill': 'warn' }, read([])), { 'a:x:oom_kill': 'ok' });
  assert.deepEqual(buildContainerConditions({ issues: [] }, { 'a:x:oom_kill': 'ok' }, read([])), {});
  assert.deepEqual(buildContainerConditions({ issues: [] }, { 'a:x:oom_kill': 'warn' }, null), { 'a:x:oom_kill': 'warn' });
});

test('they are service alerts: the service switch and the recovery switch apply', () => {
  const prefs = (extra) => ({
    enabled: true,
    notifyRecoveries: true,
    categories: { service: true, host: true, ups: true, cron: true, watchtower: true },
    ...extra,
  });
  for (const [page, recovery] of [
    ['container_restart_loop', 'container_restart_loop_cleared'],
    ['container_oom_kill', 'container_oom_cleared'],
  ]) {
    assert.equal(categoryOf(page, 'n1:pg'), 'service');
    assert.equal(categoryOf(recovery, 'n1:pg'), 'service');
    assert.equal(shouldDeliver({ type: page, id: 'n1:pg' }, prefs({})), true);
    assert.equal(shouldDeliver({ type: page, id: 'n1:pg' }, prefs({ categories: { service: false } })), false);
    assert.equal(shouldDeliver({ type: recovery, id: 'n1:pg' }, prefs({ notifyRecoveries: false })), false);
  }
});

// ── Ack, Snooze and quiet hours, through the real outbox and policy ──────────

const NOON = Date.parse('2026-10-24T16:00:00Z');
const NIGHT = Date.parse('2026-10-24T03:00:00Z'); // 23:00 on Oct 23 in Toronto
const PREFS_OK = { ok: true, prune: false };
const settle = () => new Promise((resolve) => setImmediate(resolve));
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const snap = (state) => ({
  services: {},
  hosts: {},
  ups: { state: 'online' },
  cron: {},
  ...(state ? { containerConditions: { 'n1:pg:restart_loop': state } } : {}),
});
const KEY = alertKey({ type: 'container_restart_loop', id: 'n1:pg' });

function outbox(start, alerts = { groupWindowSeconds: 0 }) {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-764-ob-'));
  const time = { now: start, end: null };
  const sleep = (ms) =>
    new Promise((resolve) => {
      time.end = () => {
        time.now += ms;
        time.end = null;
        resolve();
      };
    });
  const sent = [];
  const channels = {
    isPushEnabled: () => true,
    async sendToToken(token, event) {
      sent.push(event.type);
      return PREFS_OK;
    },
  };
  const store = {
    getAllTokens: () => [{ token: 'wp:aaaaaaaaaaaa' }],
    getPrefs: () => ({
      enabled: true,
      notifyRecoveries: true,
      categories: { service: true, host: true, ups: true, cron: true, watchtower: true },
    }),
    removeToken() {},
    pruneStale: () => 0,
    markDelivered() {},
  };
  const snapshot = createPushSnapshot({
    path: join(dir, 'push-snapshot.json'),
    logger: silent,
    now: () => time.now,
    collapses: () => {
      const r = resolveAlerts(alerts);
      return r.groupWindowMs === 0 && !r.quiet.enabled;
    },
  });
  const state = createAlertState({
    initial: () => snapshot.producerState('alert-policy')?.state,
    save: (s) => snapshot.notify('alert-policy', s, [], { push: false }),
    now: () => time.now,
  });
  const policy = createAlertPolicy({ rules: () => resolveAlerts(alerts), state, now: () => time.now });
  const sender = createPushSender({ outbox: snapshot, store, channels, logger: silent, sleep, now: () => time.now, policy });
  return {
    sent,
    time,
    policy,
    snapshot,
    async cycle(s) {
      await runPushCycle({ buildSnapshotFn: () => s, store, channels, snapshot, sender, logger: silent });
      await settle();
    },
    async pass() {
      time.end?.();
      await settle();
      await settle();
    },
    close: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('Ack: the page rings, the ack holds a repeat of it, and the recovery still ends it', async () => {
  const o = outbox(NOON);
  try {
    await o.cycle(snap());
    await o.cycle(snap('warn'));
    assert.deepEqual(o.sent, ['container_restart_loop']);
    assert.deepEqual(o.policy.state.ack([KEY]).applied, [KEY], 'the page opened an incident that can be acked');
    assert.equal(o.policy.state.suppression(KEY, false, 1), 'ack');
    await o.cycle(snap('ok'));
    assert.deepEqual(o.sent, ['container_restart_loop', 'container_restart_loop_cleared']);
    assert.equal(o.policy.state.suppression(KEY, false, 1), null);
    await o.cycle(snap());
    await o.cycle(snap('warn')); // looping again: a new incident rings
    assert.equal(o.sent.at(-1), 'container_restart_loop');
    assert.equal(o.sent.length, 3);
  } finally {
    o.close();
  }
});

test('Snooze: the page is held to the end of the snooze, then sent once; a recovery first ends it unannounced', async () => {
  const o = outbox(NOON);
  try {
    await o.cycle(snap());
    o.policy.state.observe(KEY, false, 1);
    o.policy.state.snooze([KEY], 60 * MIN);
    await o.cycle(snap('warn'));
    assert.deepEqual(o.sent, [], 'held, not sent');
    assert.equal(o.snapshot.outbox().length, 1, 'and not dropped');
    o.time.now += 61 * MIN;
    await o.cycle(snap('warn'));
    for (let i = 0; i < 10 && o.time.end; i += 1) await o.pass();
    assert.deepEqual(o.sent, ['container_restart_loop'], 'sent once, after the snooze');
  } finally {
    o.close();
  }
  const r = outbox(NOON);
  try {
    await r.cycle(snap());
    r.policy.state.observe(KEY, false, 1);
    r.policy.state.snooze([KEY], 60 * MIN);
    await r.cycle(snap('warn'));
    await r.cycle(snap('ok'));
    for (let i = 0; i < 10 && r.time.end; i += 1) await r.pass();
    assert.deepEqual(r.sent, [], 'a loop that ended while snoozed is never announced');
  } finally {
    r.close();
  }
});

test('quiet hours: a restart loop is a warning, so it waits for the morning', async () => {
  const o = outbox(NIGHT, {
    groupWindowSeconds: 0,
    quietHours: { enabled: true, start: '22:00', end: '07:00', mode: 'critical' },
  });
  try {
    await o.cycle(snap());
    await o.cycle(snap('warn'));
    assert.deepEqual(o.sent, [], 'nothing rings at 23:00');
    assert.equal(o.snapshot.outbox().length, 1, 'held, not dropped');
    await o.pass(); // 07:00
    assert.deepEqual(o.sent, ['container_restart_loop'], 'sent in the morning');
  } finally {
    o.close();
  }
});

test('a container restarting every 15 minutes for 3 hours pages once and is not cleared until it stops (hysteresis, and the window ends at the read)', async () => {
  const p = pushPipeline({ start: START });
  const all = Array.from({ length: 12 }, (_, k) => ({
    time: START + (k + 1) * 15 * MIN,
    kind: 'restart',
    node: 'apps',
    name: 'web',
  }));
  const lastRestart = all.at(-1).time;
  const log = [];
  try {
    // 30 s cycles; the read is a minute old at worst (it is taken once a minute).
    while (p.now < lastRestart + 55 * MIN) {
      const end = START + Math.floor((p.now - START) / MIN) * MIN;
      const heard = all.filter((e) => e.time <= end);
      const before = sentOf(p).length;
      await p.cycle(board(read(heard, { endMs: end })));
      for (const s of sentOf(p).slice(before)) log.push([p.now - CYCLE_STEP, s]);
    }
    const pages = log.filter(([, s]) => s.startsWith('container_restart_loop apps'));
    const cleared = log.filter(([, s]) => s.startsWith('container_restart_loop_cleared'));
    assert.equal(pages.length, 1, 'one page for the whole loop');
    assert.equal(cleared.length, 1, 'and one recovery');
    assert.ok(cleared[0][0] > lastRestart + 30 * MIN, 'not while it was still restarting');
    assert.ok(cleared[0][0] <= lastRestart + 50 * MIN, 'but once the hour holds one restart or none');
  } finally {
    p.close();
  }
});

test('an OOM kill is not cleared while the read cannot say: no OOM counter, or events cut at the cap', () => {
  const held = { 'a:x:oom_kill': 'warn' };
  const gone = { issues: [] };
  assert.deepEqual(buildContainerConditions(gone, held, read([], { oomCounter: false })), held);
  assert.deepEqual(buildContainerConditions(gone, held, read([], { truncated: true })), held);
  assert.deepEqual(buildContainerConditions(gone, held, read([])), { 'a:x:oom_kill': 'ok' });
  // A restart loop is not held by either.
  assert.deepEqual(
    buildContainerConditions(gone, { 'a:x:restart_loop': 'warn' }, read([], { truncated: true })),
    { 'a:x:restart_loop': 'ok' }
  );
});
