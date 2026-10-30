/**
 * An established container that stays Missing past the hold pages once (#775):
 * the status model words the grey card and times the hold (rules.js
 * judgeContainer, `pageDue`), the push snapshot records it (`missing`), the
 * differ pages it as container_missing and sends container_returned when it
 * runs again. Run end to end through the real registry, the real services
 * assembly, the real model and the real push cycle. The ways to silence it
 * (Remove, Ack, Snooze, the 24 h fade, quiet hours) each have a test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createContainerRegistry, PRESENCE_TTL_MS } from '../containerRegistry.js';
import { assembleServices } from '../refresh.js';
import { cachesOfAssembled, pushPipeline } from '../testing/pushPipeline.js';
import { judgeContainer, MISSING_PUSH_AFTER_MS } from '../status/rules.js';
import { alertKey, alertKind, categoryOf, createPushSnapshot, runPushCycle, shouldDeliver } from './dispatch.js';
import { createPushSender } from './outbox.js';
import { createAlertPolicy } from './alertPolicy.js';
import { createAlertState } from './alertState.js';
import { resolveAlerts } from './alertRules.js';
import { entityOf } from './entity.js';
import { buildMissing } from './snapshot.js';
import { envValue } from '../env.js';

const MIN = 60_000;
const START = 1_782_345_600_000;
const nodeCfg = { display_name: 'Production' };
const running = (...names) => ({
  reachable: true,
  metrics: {},
  containers: names.map((container) => ({ container, status: 'running', docker: {} })),
});

/** A board and its registry on the pipeline's clock; `seen` records sightings before the pipeline starts. */
function world() {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-775-'));
  const registry = createContainerRegistry({ path: join(dir, 'registry.json') });
  const p = pushPipeline({ start: START });
  const out = {
    p,
    registry,
    /** A container that ran for ten minutes before `START`, last seen at `START`. */
    ranUntilStart(name, node = 'vm103') {
      registry.recordSeen(name, node, START - 10 * MIN);
      registry.recordSeen(name, node, START);
    },
    /** One push cycle on a board where `names` run on vm103 (`other` on vm104). */
    async cycle(names = ['gitea'], { other = [], monitors = {}, lastSeenContainer = {}, config = { services: {} } } = {}) {
      const now = p.now;
      const nodeResults = [['vm103', nodeCfg, running(...names)]];
      if (other.length > 0) nodeResults.push(['vm104', nodeCfg, running(...other)]);
      for (const [node, , data] of nodeResults)
        for (const c of data.containers) registry.recordSeen(c.container, node, now);
      const board = assembleServices({
        nodeResults,
        monitors,
        config,
        lastSeenNodeOf: () => null,
        lastSeenContainerOf: (id) => lastSeenContainer[String(id)] ?? null,
        containerRegistry: registry,
        now: () => now,
      });
      await p.cycle(cachesOfAssembled(board));
      return board;
    },
    sent: () => p.sent.filter((s) => s.startsWith('container_')),
    close() {
      p.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return out;
}

/** Cycles until `ms` have passed on the pipeline's clock. */
async function until(w, ms, names, opts) {
  const end = w.p.now + ms;
  while (w.p.now < end) await w.cycle(names, opts);
}

test('the hold is a setting: 10 minutes by default, and judgeContainer times it from when the container was last seen', () => {
  assert.equal(MISSING_PUSH_AFTER_MS, 10 * MIN);
  assert.equal(envValue('JAGHELM_MISSING_PUSH_AFTER_MS', {}), 10 * MIN);
  const input = (extra) => ({ card: { source: 'presence', lastSeenAt: 1000 }, containersRead: true, ...extra });
  assert.equal(judgeContainer(input({ now: 1000 + 10 * MIN - 1 })).pageDue, undefined);
  assert.equal(judgeContainer(input({ now: 1000 + 10 * MIN })).pageDue, true);
  assert.equal(judgeContainer(input({ now: 1000 + 61_000, pushAfterMs: 60_000 })).pageDue, true);
  // No clock, no page: the card still reads Missing.
  const bare = judgeContainer(input({}));
  assert.equal(bare.word, 'Missing');
  assert.equal(bare.pageDue, undefined);
  // A container a Kuma monitor judges is never due: the monitor pages it.
  for (const status of ['up', 'down']) {
    const v = judgeContainer(input({ now: 1000 + 60 * MIN, backedBy: { monitor: 'Gitea', status } }));
    assert.equal(v.word, 'Missing');
    assert.equal(v.pageDue, undefined, status);
  }
});

test('a Missing container pages once after the hold, naming it and its node, and nothing before', async () => {
  const w = world();
  try {
    w.ranUntilStart('postgres');
    await w.cycle(['gitea']); // the first cycle: absent for 0 s
    await until(w, 9 * MIN, ['gitea']);
    // Well past the card's 90 s grace: the card shows, no push yet.
    assert.equal(w.p.status.entities.find((e) => e.id === 'services/vm103:postgres').word, 'Missing');
    assert.deepEqual(w.sent(), []);
    await until(w, 90_000, ['gitea']);
    assert.deepEqual(w.sent(), ['container_missing vm103:postgres']);
    const page = w.p.events.find((e) => e.type === 'container_missing');
    assert.equal(page.severity, 'warning');
    assert.equal(page.node, 'vm103');
    assert.match(page.body, /^postgres on vm103/);
    assert.equal(entityOf(page), 'services/vm103:postgres');
    assert.equal(w.p.snapshot.prev().missing['vm103:postgres'], 'warn');
    // Still gone: no second page.
    await until(w, 30 * MIN, ['gitea']);
    assert.equal(w.sent().length, 1);
    // The status model already had it as a warning, with no second table: the same entity.
    assert.equal(w.p.status.entities.find((e) => e.id === 'services/vm103:postgres').state, 'warn');
  } finally {
    w.close();
  }
});

test('it returns: the recovery is sent, then the entry is forgotten; the alert history, Ack and Snooze share one key', async () => {
  const w = world();
  try {
    w.ranUntilStart('postgres');
    await until(w, 11 * MIN, ['gitea']);
    assert.equal(w.sent().length, 1);
    await w.cycle(['gitea', 'postgres']);
    assert.deepEqual(w.sent(), ['container_missing vm103:postgres', 'container_returned vm103:postgres']);
    const back = w.p.events.at(-1);
    assert.equal(back.severity, 'info');
    assert.equal(entityOf(back), 'services/vm103:postgres');
    assert.equal(w.p.snapshot.prev().missing['vm103:postgres'], 'ok');
    await w.cycle(['gitea', 'postgres']);
    assert.equal(w.p.snapshot.prev().missing, undefined);
    assert.equal(w.sent().length, 2);
    const history = w.p.snapshot.events({}).events.map((e) => e.type).sort();
    assert.deepEqual(history, ['container_missing', 'container_returned']);
    const [page, recovery] = w.p.events.filter((e) => e.type.startsWith('container_'));
    assert.equal(alertKey(page), alertKey(recovery));
    assert.equal(alertKind(page), 'page');
    assert.equal(alertKind(recovery), 'recovery');
  } finally {
    w.close();
  }
});

test('it returns on another node: the recovery is sent too', async () => {
  const w = world();
  try {
    w.ranUntilStart('postgres');
    await until(w, 11 * MIN, ['gitea']);
    await w.cycle(['gitea'], { other: ['postgres'] });
    assert.deepEqual(w.sent(), ['container_missing vm103:postgres', 'container_returned vm103:postgres']);
  } finally {
    w.close();
  }
});

test('Remove ends it: forgetting the container before the hold sends nothing, and after the page sends no recovery', async () => {
  const w = world();
  try {
    w.ranUntilStart('early');
    w.ranUntilStart('late');
    await until(w, 5 * MIN, ['gitea']);
    assert.equal(w.registry.forget('early'), true); // the DELETE route's call (routes/containers.js)
    await until(w, 6 * MIN, ['gitea']);
    // `late` paged, `early` never did.
    assert.deepEqual(w.sent(), ['container_missing vm103:late']);
    assert.equal(w.registry.forget('late'), true);
    await w.cycle(['gitea']);
    await w.cycle(['gitea']);
    assert.deepEqual(w.sent(), ['container_missing vm103:late'], 'no recovery for a removal');
    assert.equal(w.p.snapshot.prev().missing, undefined, 'the entry is gone');
    // Discovery records it as a new container if it ever runs again: it does not recur as a page.
    await until(w, 20 * MIN, ['gitea']);
    assert.equal(w.sent().length, 1);
  } finally {
    w.close();
  }
});

test('the 24 h fade ends it without a recovery', async () => {
  const w = world();
  try {
    w.ranUntilStart('postgres');
    await until(w, 11 * MIN, ['gitea']);
    assert.equal(w.sent().length, 1);
    w.p.advance(PRESENCE_TTL_MS); // a day on: the registry no longer reports it missing
    await w.cycle(['gitea']);
    await w.cycle(['gitea']);
    assert.deepEqual(w.sent(), ['container_missing vm103:postgres']);
    assert.equal(w.p.snapshot.prev().missing, undefined);
  } finally {
    w.close();
  }
});

test('no push for a one-shot job, an ignored name, or a name running on another node', async () => {
  const w = world();
  try {
    // A one-shot: ran 30 s, under the 60 s that establishes a container.
    w.registry.recordSeen('migrate-once', 'vm103', START - 30_000);
    w.registry.recordSeen('migrate-once', 'vm103', START);
    // Ignored names: a CI job and the handbook build.
    w.ranUntilStart('GITEA-ACTIONS-TASK-7-WORKFLOW-ci-JOB-test-abc');
    w.ranUntilStart('handbook-build-4242');
    // Last seen on vm103, running now on vm104.
    w.ranUntilStart('moved');
    await until(w, 30 * MIN, ['gitea'], { other: ['moved'] });
    assert.deepEqual(w.sent(), []);
    assert.equal(w.p.snapshot.prev().missing, undefined);
    const ids = w.p.status.entities.map((e) => e.id);
    assert.ok(!ids.some((id) => /migrate-once|GITEA-ACTIONS|handbook-build/.test(id)), 'no card for them either');
  } finally {
    w.close();
  }
});

test('a container its own Kuma monitor judges is not paged here: a down monitor is the monitor\'s red card, an up one is no push', async () => {
  const w = world();
  try {
    w.ranUntilStart('postgres');
    const kuma = (status) => ({ 1: { id: 1, name: 'postgres', status, active: true } });
    // Monitor 1 last ran as postgres (the registry of Kuma's container): the model judges the card by it (#438).
    const opts = { monitors: kuma('up'), lastSeenContainer: { 1: 'postgres' } };
    await until(w, 20 * MIN, ['gitea'], opts);
    assert.equal(w.p.status.entities.find((e) => e.id === 'services/vm103:postgres').word, 'Missing');
    assert.equal(w.p.status.entities.find((e) => e.id === 'services/vm103:postgres').pageDue, undefined);
    assert.deepEqual(w.sent(), []);
    assert.equal(w.p.snapshot.prev().missing, undefined);
  } finally {
    w.close();
  }
  const d = world();
  try {
    d.ranUntilStart('postgres');
    await until(d, 20 * MIN, ['gitea'], {
      monitors: { 1: { id: 1, name: 'postgres', status: 'down', active: true } },
    });
    assert.deepEqual(d.sent(), [], 'the monitor pages it as service_down, not as a missing container');
  } finally {
    d.close();
  }
});

test('a restart keeps the page: the same Missing container is not paged again', async () => {
  const w = world();
  try {
    w.ranUntilStart('postgres');
    await until(w, 11 * MIN, ['gitea']);
    assert.equal(w.sent().length, 1);
    w.p.restart();
    await until(w, 5 * MIN, ['gitea']);
    assert.equal(w.sent().length, 1);
  } finally {
    w.close();
  }
});

test('buildMissing: holds through No signal and a Prometheus failure, ends on removal, reports a return', () => {
  const entity = (id, kind, state, word, extra = {}) => ({ id, kind, state, word, ...extra });
  const key = 'n1:pg';
  const prev = { [key]: 'warn' };
  const status = (...entities) => ({ entities });
  assert.deepEqual(
    buildMissing(status(entity('services/n1:pg', 'container', 'warn', 'Missing', { pageDue: true })), {}),
    { [key]: 'warn' }
  );
  // Missing but not due yet: nothing.
  assert.deepEqual(buildMissing(status(entity('services/n1:pg', 'container', 'warn', 'Missing')), {}), {});
  // A Kuma-judged Missing card has no pageDue and so is not here; one held before is ended.
  assert.deepEqual(buildMissing(status(entity('services/n1:pg', 'container', 'warn', 'Missing')), prev), {});
  // No signal, or Prometheus down: held.
  assert.deepEqual(buildMissing(status(entity('services/n1:pg', 'container', 'unknown', 'No signal')), prev), prev);
  assert.deepEqual(buildMissing(status(), prev, false), prev);
  // The card gone (Remove, the fade): ended, silently.
  assert.deepEqual(buildMissing(status(), prev), {});
  // Running again, here or on another node.
  assert.deepEqual(buildMissing(status(entity('services/n1:pg', 'container', 'ok', 'Running')), prev), { [key]: 'ok' });
  assert.deepEqual(buildMissing(status(entity('services/n2:pg', 'container', 'ok', 'Running')), prev), { [key]: 'ok' });
  // An ok entry is dropped the cycle after.
  assert.deepEqual(buildMissing(status(), { [key]: 'ok' }), {});
});

test('a missing container is a service alert: its category and the recovery switch apply', () => {
  assert.equal(categoryOf('container_missing', 'n1:pg'), 'service');
  assert.equal(categoryOf('container_returned', 'n1:pg'), 'service');
  const prefs = (extra) => ({
    enabled: true,
    notifyRecoveries: true,
    categories: { service: true, host: true, ups: true, cron: true, watchtower: true },
    ...extra,
  });
  const page = { type: 'container_missing', id: 'n1:pg' };
  const recovery = { type: 'container_returned', id: 'n1:pg' };
  assert.equal(shouldDeliver(page, prefs({})), true);
  assert.equal(shouldDeliver(page, prefs({ categories: { service: false } })), false);
  assert.equal(shouldDeliver(recovery, prefs({ notifyRecoveries: false })), false);
});

// ── Ack, Snooze and quiet hours, through the real outbox and policy ──────────

const NOON = Date.parse('2026-10-24T16:00:00Z');
// 23:00 on Oct 23 in Toronto (EDT, UTC-4).
const NIGHT = Date.parse('2026-10-24T03:00:00Z');
const OK = { ok: true, prune: false };
const settle = () => new Promise((resolve) => setImmediate(resolve));
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const snap = (state) => ({
  services: {},
  hosts: {},
  ups: { state: 'online' },
  cron: {},
  ...(state ? { missing: { 'n1:pg': state } } : {}),
});
const PAGE = { type: 'container_missing', id: 'n1:pg' };
const KEY = alertKey(PAGE);

function outbox(start, alerts = { groupWindowSeconds: 0 }) {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-775-ob-'));
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
      return OK;
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
    assert.deepEqual(o.sent, ['container_missing']);
    assert.deepEqual(o.policy.state.ack([KEY]).applied, [KEY], 'the page opened an incident that can be acked');
    assert.equal(o.policy.state.suppression(KEY, false, 1), 'ack');
    await o.cycle(snap('ok')); // it returns: the recovery sends and ends the ack
    assert.deepEqual(o.sent, ['container_missing', 'container_returned']);
    assert.equal(o.policy.state.suppression(KEY, false, 1), null);
    await o.cycle(snap());
    await o.cycle(snap('warn')); // gone again: a new incident rings
    assert.deepEqual(o.sent, ['container_missing', 'container_returned', 'container_missing']);
  } finally {
    o.close();
  }
});

test('Snooze: the page is held to the end of the snooze, then sent once while it is still open; a recovery first ends it unannounced', async () => {
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
    assert.deepEqual(o.sent, ['container_missing'], 'sent once, after the snooze');
  } finally {
    o.close();
  }
  const r = outbox(NOON);
  try {
    await r.cycle(snap());
    r.policy.state.observe(KEY, false, 1);
    r.policy.state.snooze([KEY], 60 * MIN);
    await r.cycle(snap('warn'));
    await r.cycle(snap('ok')); // back before the snooze ends
    for (let i = 0; i < 10 && r.time.end; i += 1) await r.pass();
    assert.deepEqual(r.sent, [], 'a problem that ended while snoozed is never announced');
  } finally {
    r.close();
  }
});

test('quiet hours: a missing container is a warning, so it waits for the morning rather than ringing overnight', async () => {
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
    assert.deepEqual(o.sent, ['container_missing'], 'sent in the morning');
  } finally {
    o.close();
  }
});
