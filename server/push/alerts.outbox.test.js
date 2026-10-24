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
/** Hosts h1.. over their CPU line: warnings, so never rung through a window or quiet hours. */
const warns = (...hosts) => ({
  services: {},
  hosts: Object.fromEntries(
    hosts.map((h) => [h, { reachable: true, levels: { cpu: 'warn', disk: 'ok', mem: 'ok' } }])
  ),
  ups: { state: 'online' },
  cron: {},
});
const calm = (...hosts) => ({
  ...warns(...hosts),
  hosts: Object.fromEntries(
    hosts.map((h) => [h, { reachable: true, levels: { cpu: 'ok', disk: 'ok', mem: 'ok' } }])
  ),
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
  const snapshot = createPushSnapshot({
    path,
    logger: silent,
    now: time.clock,
    // As refresh.js wires it: nothing cancels out while alerts are held back on purpose.
    collapses: () => {
      const r = resolveAlerts(rules.alerts);
      return r.groupWindowMs === 0 && !r.quiet.enabled;
    },
  });
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

/** Let every wait the sender is in end, one after another. */
async function drainWaits(p) {
  for (let i = 0; i < 10 && p.time.end; i += 1) await p.time.pass();
}

test('a burst of warnings is ONE push, sent when the window since the first is over', async () => {
  const { dir, path } = tmp();
  const p = half(path);
  try {
    await p.cycle(calm('h1', 'h2', 'h3'));
    await p.cycle(warns('h1', 'h2', 'h3'));
    assert.deepEqual(p.channels.sent, [], 'nothing goes out inside the window');
    assert.equal(p.time.waits.at(-1), 60_000);
    await p.time.pass();
    assert.equal(p.channels.sent.length, 1);
    const [group] = p.channels.sent;
    assert.equal(group.type, 'alert_group');
    assert.match(group.title, /^3 host alerts/);
    const payload = buildWebPayload(group);
    assert.equal(payload.keys.length, 3, 'Snooze and Ack apply to each member');
    assert.equal(payload.actions, true);
    assert.deepEqual(p.snapshot.outbox(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a critical alert goes out at once; the warnings after it still group', async () => {
  const { dir, path } = tmp();
  const p = half(path);
  try {
    await p.cycle({ ...calm('h1', 'h2'), services: board().services });
    await p.cycle({ ...warns('h1', 'h2'), services: board('a').services });
    assert.deepEqual(
      p.types(),
      ['service_down n1:a'],
      'the critical one is not held for the window'
    );
    await p.time.pass();
    assert.equal(p.types().at(-1), 'alert_group');
    assert.equal(p.channels.sent.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a flap inside the window is reported, never lost: the page, then its recovery', async () => {
  const { dir, path } = tmp();
  const p = half(path);
  try {
    await p.cycle(calm('h1'));
    await p.cycle(warns('h1'));
    p.time.now += 20_000;
    await p.cycle(calm('h1'));
    await drainWaits(p);
    assert.deepEqual(p.types(), [
      'host_threshold n1:cpu'.replace('n1', 'h1'),
      'host_threshold_cleared h1:cpu',
    ]);
    assert.deepEqual(p.snapshot.outbox(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recoveries group apart from pages', async () => {
  const { dir, path } = tmp();
  const p = half(path, { alerts: { groupWindowSeconds: 30 } });
  try {
    await p.cycle(calm('h1', 'h2'));
    await p.cycle(warns('h1', 'h2'));
    await p.time.pass();
    assert.deepEqual(p.types(), ['alert_group']);
    p.time.now += 120_000;
    await p.cycle(calm('h1', 'h2'));
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

test('two bursts are two notifications: the group’s tag is unique', async () => {
  const { dir, path } = tmp();
  const p = half(path);
  try {
    await p.cycle(calm('h1', 'h2', 'h3', 'h4'));
    await p.cycle(warns('h1', 'h2'));
    await p.time.pass();
    p.time.now += 300_000;
    await p.cycle(warns('h1', 'h2', 'h3', 'h4'));
    await p.time.pass();
    const tags = p.channels.sent.map((e) => buildWebPayload(e).tag);
    assert.equal(tags.length, 2);
    assert.notEqual(tags[0], tags[1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const hostDown = {
  services: {},
  hosts: { n1: { reachable: false, levels: {} } },
  ups: { state: 'online' },
  cron: {},
};

test('Ack silences its own problem only: a worse page of it, and another problem on the same node, still ring; the ack survives a restart', async () => {
  const { dir, path } = tmp();
  let p = half(path, { alerts: { groupWindowSeconds: 0 } });
  try {
    await p.cycle(cpuAt('ok'));
    await p.cycle(cpuAt('warn'));
    const key = buildWebPayload(p.channels.sent[0]).keys[0];
    assert.deepEqual(p.policy.state.ack([key]).applied, [key]);
    p.policy.flush();
    p = half(path, { start: p.time.now + 5000, alerts: { groupWindowSeconds: 0 } });
    assert.equal(p.policy.state.suppression(key, false, 1), 'ack', 'still acked after a restart');
    await p.cycle(hostDown); // the node itself is down: another problem, critical
    assert.deepEqual(p.types(), ['host_unreachable n1']);
    await p.cycle(cpuAt('crit')); // the acked problem gets worse
    assert.equal(p.types().at(-1), 'host_threshold n1:cpu');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Ack holds repeats of the same severity until recovery, then the next incident rings', async () => {
  const { dir, path } = tmp();
  const p = half(path, { alerts: { groupWindowSeconds: 0 } });
  try {
    await p.cycle(cpuAt('ok'));
    await p.cycle(cpuAt('crit'));
    const key = buildWebPayload(p.channels.sent[0]).keys[0];
    p.policy.state.ack([key]);
    await p.cycle(cpuAt('warn')); // a lower reading of the same problem: not announced
    await p.cycle(cpuAt('crit'));
    assert.equal(p.channels.sent.length, 1, 'no repeat while acked');
    await p.cycle(cpuAt('ok'));
    await p.cycle(cpuAt('crit'));
    assert.equal(p.channels.sent.length, 3, 'the recovery, then the new incident');
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
    const key = buildWebPayload(p.channels.sent[0]).keys[0];
    assert.deepEqual(p.policy.state.ack([key]), { applied: [], ignored: [key] });
    await p.cycle(cpuAt('crit'));
    assert.equal(p.channels.sent.length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Snooze holds a page to its end and re-alerts once if the incident is still open; another problem and a worse page ring', async () => {
  const { dir, path } = tmp();
  const p = half(path, { alerts: { groupWindowSeconds: 0 } });
  try {
    await p.cycle(cpuAt('ok'));
    const key = 'host_threshold_cleared n1:cpu';
    p.policy.state.observe(key, false, 1);
    p.policy.state.snooze([key], 60 * 60_000);
    await p.cycle(cpuAt('warn'));
    assert.deepEqual(p.channels.sent, [], 'held, not sent');
    assert.equal(p.snapshot.outbox().length, 1, 'and not dropped');
    await p.cycle(hostDown);
    assert.deepEqual(p.types(), ['host_unreachable n1'], 'a different problem on the node rings');
    p.time.now += 61 * 60_000;
    await p.cycle(hostDown);
    await drainWaits(p);
    assert.equal(
      p.types().filter((t) => t.startsWith('host_threshold ')).length,
      1,
      'the snoozed page is sent once, after the snooze'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a snoozed page that recovers before the snooze ends is never announced', async () => {
  const { dir, path } = tmp();
  const p = half(path, { alerts: { groupWindowSeconds: 0 } });
  try {
    await p.cycle(cpuAt('ok'));
    p.policy.state.snooze(['host_threshold_cleared n1:cpu'], 60 * 60_000);
    await p.cycle(cpuAt('warn'));
    await p.cycle(cpuAt('ok'));
    p.time.now += 61 * 60_000;
    await p.cycle(cpuAt('ok'));
    assert.deepEqual(p.channels.sent, []);
    assert.deepEqual(p.snapshot.outbox(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('quiet hours (silent): a critical page and its recovery overnight both reach the morning summary', async () => {
  const { dir, path } = tmp();
  const p = half(path, {
    start: NIGHT,
    alerts: { quietHours: { enabled: true, start: '22:00', end: '07:00', mode: 'silent' } },
  });
  try {
    await p.cycle(board());
    await p.cycle(board('a'));
    p.time.now += 3600_000;
    await p.cycle(board());
    assert.deepEqual(p.channels.sent, [], 'nothing rings at night');
    assert.equal(p.snapshot.outbox().length, 2, 'the page and its recovery are both kept');
    await drainWaits(p);
    assert.equal(p.channels.sent.length, 1);
    assert.equal(p.channels.sent[0].type, 'alert_digest');
    assert.equal(p.channels.sent[0].count, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a push held on purpose is not counted as overdue', async () => {
  const { dir, path } = tmp();
  const p = half(path);
  try {
    await p.cycle(calm('h1', 'h2'));
    await p.cycle(warns('h1', 'h2'));
    assert.equal(p.policy.plan(p.snapshot.entries()).filter((u) => u.ready).length, 0);
    p.time.now += 61_000;
    assert.equal(p.policy.plan(p.snapshot.entries()).filter((u) => u.ready).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
