/**
 * Deploying over the live install sends nothing (#395, #292).
 *
 * push-snapshot-v1.json was written by createPushSnapshot at main 9d68385
 * (before #395, no monitor identities) and push-snapshot-v2.json at main
 * c395e95 (before #292: host readings, not levels; services for every
 * card), both from liveShape.js, which is modelled on the live install's
 * names, with "NAS UI" down; in v2 vm103's disk is at 92 %, over push's line.
 * Read back, each must diff as it did, so the first cycle after the deploy
 * sends nothing, an outage the old file holds still recovers, and (v2) the
 * disk episode survives the deploy: inside the band after it, nothing; below
 * the clear level, one "back to normal" (#361).
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

import { pushPipeline } from '../testing/pushPipeline.js';
import {
  liveCaches,
  liveCycle,
  MONITOR_NAMES,
  SERVICES_YAML,
  UNMATCHED,
} from './fixtures/liveShape.js';

const FIXTURE = new URL('./fixtures/push-snapshot-v1.json', import.meta.url);
const FIXTURE_V2 = new URL('./fixtures/push-snapshot-v2.json', import.meta.url);

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

// JagHelm started on a copy of `fixture`: its first cycle diffs against it.
function deployed(fixture = FIXTURE) {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-push-deploy-'));
  const path = join(dir, 'push-snapshot.json');
  copyFileSync(fixture, path);
  const p = pushPipeline({ path });
  return {
    sent: p.sent,
    path,
    push: (r, caches = liveCaches(r)) => p.cycle(caches),
    close: () => {
      p.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// liveCaches(r) with vm103's disk at `pct` %.
function withDisk(r, pct) {
  const c = liveCaches(r);
  return {
    ...c,
    getCached: (key) => {
      const v = c.getCached(key);
      if (key !== 'services') return v;
      const vm103 = {
        ...v.nodes.vm103,
        metrics: { ...v.nodes.vm103.metrics, diskPercent: String(pct) },
      };
      return { ...v, nodes: { ...v.nodes, vm103 } };
    },
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
      for (const [key, state] of Object.entries(written.services)) {
        assert.equal(state, old.services[key], `${key}: the same state as the old file`);
      }
      assert.deepEqual(Object.keys(written.hosts), Object.keys(old.hosts));
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

test('deploy (#292): the snapshot written before it loads, sends nothing, and its episodes carry on', async () => {
  const old = JSON.parse(readFileSync(FIXTURE_V2, 'utf8'));
  assert.deepEqual(
    Object.keys(old),
    ['services', 'monitorOf', 'hosts', 'ups', 'cron'],
    'written before #292'
  );
  assert.deepEqual(
    old.hosts.vm103,
    { reachable: true, cpu: 0.125, mem: 0.41, disk: 0.92 },
    'readings, disk over the line'
  );
  assert.equal(old.services['vm103:NAS UI'], 'down');
  assert.equal(old.services['vm103:alloy'], 'up', 'every card, monitored or not');

  const live = deployed(FIXTURE_V2);
  try {
    // The deploy cycle: the disk has come down to 87 %, inside the band.
    await live.push(
      liveCycle({ status: { 'NAS UI': 'down' } }),
      withDisk(liveCycle({ status: { 'NAS UI': 'down' } }), 87)
    );
    assert.deepEqual(live.sent, [], 'the format change sends nothing');
    const written = JSON.parse(readFileSync(live.path, 'utf8'));
    assert.deepEqual(Object.keys(written), [
      'services',
      'monitorOf',
      'hosts',
      'ups',
      'cron',
      'sources',
    ]);
    assert.equal(
      written.hosts.vm103.levels.disk,
      'warn',
      'still over its line: the level was seeded from the old reading'
    );
    assert.equal(written.services['vm103:alloy'], undefined, 'only what a Kuma monitor feeds');
    assert.equal(written.services['vm103:NAS UI'], 'down');

    const down = liveCycle({ status: { 'NAS UI': 'down' } });
    await live.push(down, withDisk(down, 88));
    assert.deepEqual(live.sent, [], 'nor does the cycle after it');
    await live.push(down, withDisk(down, 80));
    assert.deepEqual(
      live.sent,
      ['host_threshold_cleared vm103:disk'],
      'the episode ends below the clear level'
    );
    await live.push(liveCycle(), withDisk(liveCycle(), 80));
    assert.deepEqual(live.sent, [
      'host_threshold_cleared vm103:disk',
      'service_recovered vm103:NAS UI',
    ]);
  } finally {
    live.close();
  }
});

// `c` with pi1's memory at `pct` %.
function withPi1Memory(c, pct) {
  return {
    ...c,
    getCached: (key) => {
      const v = c.getCached(key);
      if (key !== 'services') return v;
      const pi1 = { ...v.nodes.pi1, metrics: { ...v.nodes.pi1.metrics, memPercent: String(pct) } };
      return { ...v, nodes: { ...v.nodes, pi1 } };
    },
  };
}

test('deploy (#292): a reading that crossed its line since the old snapshot was written alerts on the first cycle', async () => {
  const old = JSON.parse(readFileSync(FIXTURE_V2, 'utf8'));
  assert.equal(old.hosts.pi1.mem, 0.41, 'under its line in the old file');
  const live = deployed(FIXTURE_V2);
  try {
    // vm103's disk stays at the old file's 92 %; pi1's memory went from 41 % to 95 %.
    const r = liveCycle({ status: { 'NAS UI': 'down' } });
    await live.push(r, withPi1Memory(withDisk(r, 92), 95));
    assert.deepEqual(live.sent, ['host_threshold pi1:mem'], 'one alert, on the deploy cycle');
    await live.push(r, withPi1Memory(withDisk(r, 92), 95));
    assert.deepEqual(live.sent, ['host_threshold pi1:mem'], 'and not again');
    // The disk the old file held over its line comes back under it: one "back to normal".
    await live.push(r, withPi1Memory(withDisk(r, 63), 95));
    assert.deepEqual(live.sent, ['host_threshold pi1:mem', 'host_threshold_cleared vm103:disk']);
  } finally {
    live.close();
  }
});
