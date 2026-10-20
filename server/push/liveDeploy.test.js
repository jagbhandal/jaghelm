/**
 * Deploying #395 over the live install sends nothing (#395).
 *
 * The push snapshot now records which monitor fed each service key. The file a
 * running JagHelm holds was written before that: push-snapshot-v1.json is one,
 * written by createPushSnapshot at main 9d68385 (before #395) from liveShape.js,
 * which is modelled on the live install's names, with "NAS UI" down. Read back,
 * it must diff as it did, so the first cycle after the deploy sends nothing,
 * and NAS UI's recovery is still sent later.
 *
 * Like the live install, the shape has three mappings to monitors Kuma lacks
 * (#342), and the 19 container names of the live boot line get no monitor.
 * They feed plain keys, so they send nothing, and log only today's three
 * mapping warnings.
 *
 * The first test captures the logs of the whole run: monitors.js warns once per
 * mapping per process, so it has to see the first cycle.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildSnapshot } from './snapshot.js';
import { createPushSnapshot, runPushCycle } from './dispatch.js';
import {
  liveCaches,
  liveCycle,
  MONITOR_NAMES,
  SERVICES_YAML,
  UNMATCHED,
} from './fixtures/liveShape.js';

const FIXTURE = new URL('./fixtures/push-snapshot-v1.json', import.meta.url);
const THRESHOLDS = { cpu: 0.9, mem: 0.9, disk: 0.9, hysteresis: 0.05 };

// The structured logger's JSON lines written while `fn` runs.
async function captureLogs(fn) {
  const lines = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  const tap = (orig) =>
    function (chunk, ...rest) {
      try {
        const obj = JSON.parse(String(chunk));
        if (obj && obj.module && obj.level) {
          lines.push(obj);
          return true;
        }
      } catch {
        // not one of ours
      }
      return orig.call(this, chunk, ...rest);
    };
  process.stdout.write = tap(origOut);
  process.stderr.write = tap(origErr);
  try {
    await fn();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return lines;
}

function deployed() {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-push-deploy-'));
  const path = join(dir, 'push-snapshot.json');
  copyFileSync(FIXTURE, path);
  const sent = [];
  const fcm = {
    isPushEnabled: () => true,
    sendToToken: async (_token, event) => {
      sent.push(`${event.type} ${event.id}`);
      return { ok: true, prune: false };
    },
  };
  const store = {
    getAllTokens: () => [{ token: 'phone' }],
    getPrefs: () => ({ enabled: true, categories: {}, notifyRecoveries: true }),
    removeToken() {},
    pruneStale() {},
    markDelivered() {},
  };
  const snapshot = createPushSnapshot({
    path,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  return {
    sent,
    path,
    push: (r) =>
      runPushCycle({
        buildSnapshotFn: (prev) => buildSnapshot(liveCaches(r), prev),
        store,
        fcm,
        snapshot,
        thresholds: THRESHOLDS,
      }),
    close: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('deploy (#395): the old snapshot loads, the first cycle sends nothing, and NAS UI still recovers', async () => {
  const old = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  assert.deepEqual(
    Object.keys(old),
    ['services', 'hosts', 'ups', 'cron'],
    'written before #395: no monitor identity'
  );
  assert.equal(old.services['vm103:NAS UI'], 'down');

  const live = deployed();
  let logs;
  try {
    logs = await captureLogs(async () => {
      const r = liveCycle({ status: { 'NAS UI': 'down' } });
      assert.deepEqual(
        r.unmatched,
        UNMATCHED,
        'the 19 names of the live boot line have no monitor'
      );
      await live.push(r);
      assert.deepEqual(live.sent, [], 'the format change sends nothing');
      const written = JSON.parse(readFileSync(live.path, 'utf8'));
      assert.deepEqual(written.services, old.services, 'the same state as the old file');
      assert.deepEqual(written.hosts, old.hosts);
      assert.equal(
        written.monitorOf['vm103:NAS UI'],
        '11',
        'rewritten with the monitor each key was fed by'
      );

      for (let i = 0; i < 3; i += 1) await live.push(liveCycle({ status: { 'NAS UI': 'down' } }));
      assert.deepEqual(live.sent, [], 'nor do the cycles after it');

      await live.push(liveCycle());
      assert.deepEqual(
        live.sent,
        ['service_recovered vm103:NAS UI'],
        'the outage the old file held still recovers'
      );
      await live.push(liveCycle());
      assert.deepEqual(live.sent, ['service_recovered vm103:NAS UI']);
    });
  } finally {
    live.close();
  }

  const warnings = logs.filter((l) => l.level === 'warn' || l.level === 'error');
  assert.deepEqual(
    warnings.map((l) => `${l.containerName} -> ${l.explicitMonitor}`).sort(),
    Object.entries(SERVICES_YAML)
      .map(([name, m]) => `${name} -> ${m.monitor}`)
      .sort(),
    'only the three broken mappings warn (#342), once each'
  );
  assert.ok(warnings.every((l) => /names no Kuma monitor/.test(l.msg)));
});

test('deploy (#395): the 19 unmonitored containers and the three broken mappings feed no monitor and send nothing', async () => {
  const r = liveCycle();
  const plain = ['gateway-npm', 'gateway-tunnel', 'tailscale', ...r.unmatched];
  const keys = Object.keys(r.monitorOf ?? {});
  for (const name of new Set(plain)) {
    assert.equal(
      keys.some((uid) => uid.endsWith(`:${name}`)),
      false,
      `${name} feeds no monitor`
    );
  }
  const live = deployed();
  try {
    // Every monitor goes down and back up: only monitors are sent, each once each way.
    const allDown = Object.fromEntries(MONITOR_NAMES.map((n) => [n, 'down']));
    const fedKeys = Object.keys(liveCycle({ status: allDown }).monitorOf).sort();
    assert.equal(fedKeys.length, 26, 'each of the 26 monitors feeds one key');
    await live.push(liveCycle({ status: { 'NAS UI': 'down' } }));
    await live.push(liveCycle({ status: allDown }));
    await live.push(liveCycle());
    const sentFor = (name) => live.sent.filter((s) => s.endsWith(`:${name}`));
    for (const name of new Set(plain)) assert.deepEqual(sentFor(name), [], name);
    const idsOf = (type) =>
      live.sent
        .filter((s) => s.startsWith(`${type} `))
        .map((s) => s.slice(type.length + 1))
        .sort();
    assert.deepEqual(
      idsOf('service_down'),
      fedKeys.filter((k) => k !== 'vm103:NAS UI'),
      'NAS UI was down already'
    );
    assert.deepEqual(idsOf('service_recovered'), fedKeys);
  } finally {
    live.close();
  }
});
