/**
 * #669: smarter alerts through the outbox's sender. A burst becomes one push
 * and a lone alert waits no longer than the window; Snooze and Ack hold a
 * repeat back (and survive a restart); quiet hours hold the night's alerts
 * for one morning summary; a known cause rides on the body.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPushSnapshot, runPushCycle } from './dispatch.js';
import { createPushSender } from './outbox.js';
import { createAlertPolicy } from './alertPolicy.js';
import { createAlertState } from './alertState.js';
import { resolveAlerts } from './alertRules.js';
import { buildWebPayload } from './webPush.js';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
// 23:00 on Oct 23 in Toronto (EDT, UTC-4).
const NIGHT = Date.parse('2026-10-24T03:00:00Z');
const NOON = Date.parse('2026-10-24T16:00:00Z');
const OK = { ok: true, prune: false };
const settle = () => new Promise((resolve) => setImmediate(resolve));

const board = (...down) => ({
  services: Object.fromEntries(
    ['a', 'b', 'c', 'd'].map((s) => [`n1:${s}`, down.includes(s) ? 'down' : 'up'])
  ),
  hosts: {},
  ups: { state: 'online' },
  cron: {},
});
const cpuAt = (cpu) => ({
  services: {},
  hosts: { n1: { reachable: true, levels: { cpu, disk: 'ok', mem: 'ok' } } },
  ups: { state: 'online' },
  cron: {},
});

function phones(prefsOf = {}) {
  const tokens = ['wp:aaaaaaaaaaaa'];
  const all = {
    enabled: true,
    notifyRecoveries: true,
    categories: { service: true, host: true, ups: true, cron: true, watchtower: true },
  };
  return {
    getAllTokens: () => tokens.map((token) => ({ token })),
    getPrefs: () => ({ ...all, ...prefsOf }),
    removeToken() {},
    pruneStale: () => 0,
    markDelivered() {},
  };
}

function fakeTime(start) {
  const time = {
    now: start,
    waits: [],
    end: null,
    clock: () => time.now,
    sleep(ms) {
      time.waits.push(ms);
      return new Promise((resolve) => {
        time.end = () => {
          time.now += ms;
          time.end = null;
          resolve();
        };
      });
    },
    /** Let the wait the sender is in end. */
    async pass() {
      time.end?.();
      await settle();
      await settle();
    },
  };
  return time;
}

function half(path, { start = NOON, alerts = {}, store = phones() } = {}) {
  const time = fakeTime(start);
  const rules = { alerts };
  const channels = {
    sent: [],
    isPushEnabled: () => true,
    async sendToToken(token, event) {
      channels.sent.push(event);
      return OK;
    },
  };
  const snapshot = createPushSnapshot({ path, logger: silent, now: time.clock });
  const state = createAlertState({
    initial: () => snapshot.producerState('alert-policy')?.state,
    save: (s) => snapshot.notify('alert-policy', s, [], { push: false }),
    now: time.clock,
  });
  const policy = createAlertPolicy({
    rules: () => resolveAlerts(rules.alerts),
    state,
    now: time.clock,
  });
  const sender = createPushSender({
    outbox: snapshot,
    store,
    channels,
    logger: silent,
    sleep: time.sleep,
    now: time.clock,
    policy,
  });
  return {
    snapshot,
    sender,
    time,
    channels,
    policy,
    rules,
    async cycle(snap) {
      await runPushCycle({
        buildSnapshotFn: () => snap,
        store,
        channels,
        snapshot,
        sender,
        logger: silent,
      });
      await settle();
    },
    types: () =>
      channels.sent.map((e) => `${e.type}${e.id && e.type.startsWith('alert_') ? '' : ` ${e.id}`}`),
  };
}

const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-669-'));
  return { dir, path: join(dir, 'push-snapshot.json') };
};

test('a burst of alerts is ONE push, sent when the window since the first is over', async () => {
  const { dir, path } = tmp();
  const p = half(path);
  try {
    await p.cycle(board());
    await p.cycle(board('a', 'b', 'c'));
    assert.deepEqual(p.channels.sent, [], 'nothing goes out inside the window');
    assert.equal(p.time.waits.at(-1), 60_000);
    await p.time.pass();
    assert.equal(p.channels.sent.length, 1);
    const [group] = p.channels.sent;
    assert.equal(group.type, 'alert_group');
    assert.match(group.title, /^3 services down/);
    const payload = buildWebPayload(group);
    assert.equal(payload.keys.length, 3, 'Snooze and Ack apply to each member');
    assert.equal(payload.actions, true);
    assert.deepEqual(p.snapshot.outbox(), [], 'every member left the outbox');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a lone critical alert is sent as itself, never later than the window, never dropped', async () => {
  const { dir, path } = tmp();
  const p = half(path);
  try {
    await p.cycle(board());
    await p.cycle(board('a'));
    p.time.now += 59_000; // still inside the window
    await p.cycle(board('a'));
    assert.deepEqual(p.channels.sent, []);
    await p.time.pass();
    assert.deepEqual(p.types(), ['service_down n1:a']);
    assert.ok(p.time.now - NOON <= 60_000 + 59_000 + 1000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a window of 0 sends each alert at once, as before', async () => {
  const { dir, path } = tmp();
  const p = half(path, { alerts: { groupWindowSeconds: 0 } });
  try {
    await p.cycle(board());
    await p.cycle(board('a', 'b'));
    assert.deepEqual(p.types(), ['service_down n1:a', 'service_down n1:b']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a page and its recovery inside the window cancel out: nothing is sent', async () => {
  const { dir, path } = tmp();
  const p = half(path);
  try {
    await p.cycle(board());
    await p.cycle(board('a'));
    p.time.now += 20_000;
    await p.cycle(board());
    await p.time.pass();
    assert.deepEqual(p.channels.sent, []);
    assert.deepEqual(p.snapshot.outbox(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recoveries group apart from pages', async () => {
  const { dir, path } = tmp();
  const p = half(path, { alerts: { groupWindowSeconds: 30 } });
  try {
    await p.cycle(board());
    await p.cycle(board('a', 'b'));
    await p.time.pass();
    assert.deepEqual(p.types(), ['alert_group']);
    p.time.now += 120_000;
    await p.cycle(board());
    await p.time.pass();
    assert.deepEqual(p.types(), ['alert_group', 'alert_group']);
    assert.match(p.channels.sent[1].title, /^2 recovered/);
    assert.equal(
      'actions' in buildWebPayload(p.channels.sent[1]),
      false,
      'a recovery has nothing to snooze'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a known cause is appended to the push body', async () => {
  const { dir, path } = tmp();
  const p = half(path, {
    alerts: { groupWindowSeconds: 0, knownCauses: [{ match: 'N1:A', label: 'nightly job' }] },
  });
  try {
    await p.cycle(board());
    await p.cycle(board('a', 'b'));
    const bodies = p.channels.sent.map((e) => buildWebPayload(e).body);
    assert.match(bodies[0], / · nightly job$/);
    assert.doesNotMatch(bodies[1], /nightly job/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Ack: no repeat page for an incident until it recovers, then the next one is sent; it survives a restart', async () => {
  const { dir, path } = tmp();
  let p = half(path, { alerts: { groupWindowSeconds: 0 } });
  try {
    await p.cycle(cpuAt('ok'));
    await p.cycle(cpuAt('warn'));
    assert.deepEqual(p.types(), ['host_threshold n1:cpu']);
    const tag = buildWebPayload(p.channels.sent[0]).tag;
    assert.deepEqual(p.policy.state.ack([tag]).applied, [tag]);
    p.policy.flush();

    // A restart: the same file, a fresh process.
    p = half(path, { start: p.time.now + 5000, alerts: { groupWindowSeconds: 0 } });
    await p.cycle(cpuAt('crit')); // escalation: a repeat page for the acked incident
    assert.deepEqual(p.channels.sent, [], 'the acked incident is not announced again');
    assert.deepEqual(p.snapshot.outbox(), [], 'and it is finished, not stuck in the outbox');
    await p.cycle(cpuAt('ok'));
    assert.deepEqual(p.types(), ['host_threshold_cleared n1:cpu'], 'the recovery is sent');
    await p.cycle(cpuAt('crit'));
    assert.deepEqual(
      p.types(),
      ['host_threshold_cleared n1:cpu', 'host_threshold n1:cpu'],
      'a new incident is announced'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Ack on an incident that already recovered is ignored, so it cannot silence the next one', async () => {
  const { dir, path } = tmp();
  const p = half(path, { alerts: { groupWindowSeconds: 0 } });
  try {
    await p.cycle(cpuAt('ok'));
    await p.cycle(cpuAt('warn'));
    await p.cycle(cpuAt('ok'));
    const tag = buildWebPayload(p.channels.sent[0]).tag;
    const out = p.policy.state.ack([tag]);
    assert.deepEqual(out, { applied: [], ignored: [tag] });
    await p.cycle(cpuAt('crit'));
    assert.equal(p.channels.sent.length, 3, 'the new incident is announced');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Snooze: pages and recoveries are held back until the time is up', async () => {
  const { dir, path } = tmp();
  const p = half(path, { alerts: { groupWindowSeconds: 0 } });
  try {
    await p.cycle(board());
    p.policy.state.snooze(['services/n1:a'], 60 * 60_000);
    await p.cycle(board('a'));
    await p.cycle(board());
    assert.deepEqual(p.channels.sent, []);
    p.time.now += 61 * 60_000;
    await p.cycle(board('a'));
    assert.deepEqual(p.types(), ['service_down n1:a']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('quiet hours (critical still rings): a warning waits for one morning summary, a critical goes out', async () => {
  const { dir, path } = tmp();
  const p = half(path, {
    start: NIGHT,
    alerts: {
      groupWindowSeconds: 0,
      quietHours: { enabled: true, start: '22:00', end: '07:00', mode: 'critical' },
    },
  });
  try {
    await p.cycle({
      ...board(),
      hosts: { n1: { reachable: true, levels: { cpu: 'ok', disk: 'ok', mem: 'ok' } } },
    });
    await p.cycle({
      ...board('a'),
      hosts: { n1: { reachable: true, levels: { cpu: 'warn', disk: 'ok', mem: 'ok' } } },
    });
    await p.cycle({
      ...board('a', 'b'),
      hosts: { n1: { reachable: true, levels: { cpu: 'warn', disk: 'ok', mem: 'ok' } } },
    });
    // The services are critical and ring; the CPU warning is held.
    assert.deepEqual(p.types(), ['service_down n1:a', 'service_down n1:b']);
    assert.equal(p.snapshot.outbox().length, 1);
    assert.equal(p.time.waits.at(-1), 8 * 3600_000, 'it sleeps until 07:00 Toronto');
    await p.time.pass();
    assert.equal(p.channels.sent.length, 3);
    assert.deepEqual(
      p.channels.sent[2].type,
      'host_threshold',
      'a lone held alert is sent as itself'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('quiet hours (silent): nothing rings; the morning summary says what happened', async () => {
  const { dir, path } = tmp();
  const p = half(path, {
    start: NIGHT,
    alerts: {
      groupWindowSeconds: 0,
      quietHours: { enabled: true, start: '22:00', end: '07:00', mode: 'silent' },
    },
  });
  try {
    await p.cycle(board());
    await p.cycle(board('a', 'b', 'c'));
    assert.deepEqual(p.channels.sent, []);
    assert.equal(p.snapshot.outbox().length, 3, 'queued, not dropped');
    await p.time.pass();
    assert.equal(p.channels.sent.length, 1);
    assert.equal(p.channels.sent[0].type, 'alert_digest');
    assert.match(p.channels.sent[0].title, /^While you were away: 3 services down/);
    assert.deepEqual(p.snapshot.outbox(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('quiet hours held through a restart: the entry keeps when it was queued', async () => {
  const { dir, path } = tmp();
  let p = half(path, {
    start: NIGHT,
    alerts: {
      groupWindowSeconds: 0,
      quietHours: { enabled: true, start: '22:00', end: '07:00', mode: 'silent' },
    },
  });
  try {
    await p.cycle(board());
    await p.cycle(board('a', 'b'));
    p = half(path, {
      start: NIGHT + 9 * 3600_000, // 08:00, after a restart
      alerts: {
        groupWindowSeconds: 0,
        quietHours: { enabled: true, start: '22:00', end: '07:00', mode: 'silent' },
      },
    });
    await p.cycle(board('a', 'b'));
    assert.equal(p.channels.sent.length, 1);
    assert.equal(p.channels.sent[0].type, 'alert_digest');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('/api/health style: a push held on purpose is not counted as a stall', async () => {
  const { dir, path } = tmp();
  const p = half(path);
  try {
    await p.cycle(board());
    await p.cycle(board('a', 'b'));
    const waiting = p.policy.plan(p.snapshot.entries()).filter((u) => u.ready);
    assert.equal(waiting.length, 0, 'inside the window, nothing is overdue');
    p.time.now += 61_000;
    assert.equal(p.policy.plan(p.snapshot.entries()).filter((u) => u.ready).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
