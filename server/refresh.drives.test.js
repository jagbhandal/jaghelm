/**
 * Drives in the loop's status step (refresh.js refreshDrives, #727): the read
 * is put where the model reads it, a read that throws or fails leaves null,
 * and a throw in reading or judging drives never stops the status step: the
 * rest of the model builds without drives.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-drives-step-'));
process.env.JAGHELM_DATA_DIR = dataDir;
const { saveConfig } = await import('./config.js');
const { getCached, setCache } = await import('./cache.js');
const { initDiscovery } = await import('./discovery.js');
const { drivesCache } = await import('./drives.js');
const { getStatusModelHealth, runStatusAndPush, settleDrives, stopBackgroundRefresh } = await import('./refresh.js');
const { node } = await import('./testing/statusFixtures.js');

saveConfig({ nodes: { n1: { display_name: 'n1' } }, services: {} });
initDiscovery('http://prometheus.invalid:9090');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

const realRead = drivesCache.read;
const zero = { count: 0, grew: false };
const drive = (device, over = {}) => ({
  device,
  model: 'M',
  type: 'hdd',
  smartPassed: true,
  criticalWarning: null,
  availableSpare: null,
  spareThreshold: null,
  percentageUsed: null,
  temperature: 40,
  powerOnSeconds: 1,
  exitStatus: 0,
  mediaErrors: null,
  sectors: { reallocated: zero, pending: zero, uncorrectable: zero },
  ...over,
});

function board() {
  setCache('services', {
    nodes: { n1: node({}, { display_name: 'n1' }) },
    overallHealth: 'up',
    sources: { prometheus: { ok: true }, kuma: { ok: true } },
  });
}

test('the cycle puts the drive read where the status model reads it, and the node carries its drives', async () => {
  board();
  drivesCache.read = async () => ({
    enabled: true,
    nodes: { n1: { devices: 1, scrapeUp: true, drives: [drive('sda', { smartPassed: false })] } },
  });
  try {
    await runStatusAndPush([]);
    await settleDrives();
    await runStatusAndPush([]); // the read lands for the next cycle's status
  } finally {
    drivesCache.read = realRead;
  }
  assert.equal(getCached('drives').enabled, true);
  const n1 = getCached('status').entities.find((e) => e.id === 'nodes/n1');
  assert.equal(n1.state, 'crit');
  assert.match(n1.reason, /drive sda failed its health check/);
});

test('a read that throws leaves the last result as it was, and the status step still builds', async () => {
  board();
  const last = getCached('drives');
  drivesCache.read = async () => {
    throw new Error('boom');
  };
  try {
    await runStatusAndPush([]);
    await settleDrives();
    await runStatusAndPush([]);
  } finally {
    drivesCache.read = realRead;
  }
  assert.deepEqual(getCached('drives'), last);
  assert.deepEqual(getStatusModelHealth(), { state: 'ok' });
  const n1 = getCached('status').entities.find((e) => e.id === 'nodes/n1');
  // The last read still stands until it ages out: the drive is neither invented away nor ended.
  assert.equal(n1.conditions['drive:n1:sda'], 'crit');
  assert.equal(n1.state, 'crit');
});

test('a throw in judging drives never stops the status step: the node is judged without them', async () => {
  board();
  const poisoned = drive('sda');
  Object.defineProperty(poisoned, 'temperature', {
    enumerable: true,
    get() {
      throw new Error('cannot judge');
    },
  });
  drivesCache.read = async () => ({
    enabled: true,
    nodes: { n1: { devices: 1, scrapeUp: true, drives: [poisoned] } },
  });
  const lines = [];
  const write = process.stderr.write;
  process.stderr.write = (chunk, ...rest) => {
    lines.push(String(chunk));
    return typeof rest.at(-1) === 'function' ? rest.at(-1)() : true;
  };
  try {
    await runStatusAndPush([]);
    await settleDrives();
    await runStatusAndPush([]);
    await runStatusAndPush([]); // the same fault again: logged once, not every cycle
  } finally {
    process.stderr.write = write;
    drivesCache.read = realRead;
  }
  const logged = lines.filter((l) => l.includes('judging drive health failed'));
  assert.equal(logged.length, 1);
  assert.ok(logged[0].includes('cannot judge'));
  assert.deepEqual(getStatusModelHealth(), { state: 'ok' });
  const n1 = getCached('status').entities.find((e) => e.id === 'nodes/n1');
  assert.equal(n1.conditions.cpu, 'ok');
  assert.equal(n1.conditions['drive:n1:sda'], 'unknown');
});

test('with no Prometheus to ask, no read is made', async () => {
  initDiscovery('');
  board();
  let asked = 0;
  drivesCache.read = async () => {
    asked += 1;
    return { enabled: true, nodes: {} };
  };
  try {
    await runStatusAndPush([]);
  } finally {
    drivesCache.read = realRead;
  }
  assert.equal(asked, 0);
});

test('the status step never waits for the drive read: a read that hangs adds nothing to the cycle', async () => {
  initDiscovery('http://prometheus.invalid:9090');
  board();
  let release;
  const hung = new Promise((resolve) => {
    release = resolve;
  });
  let asked = 0;
  drivesCache.read = () => {
    asked += 1;
    return hung;
  };
  try {
    const t0 = performance.now();
    await runStatusAndPush([]);
    await runStatusAndPush([]);
    assert.ok(performance.now() - t0 < 1000, 'both cycles finished while the read hangs');
    assert.equal(asked, 1, 'and no second read stacks behind it');
    assert.deepEqual(getStatusModelHealth(), { state: 'ok' });
  } finally {
    release({ enabled: true, nodes: {} });
    await settleDrives();
    drivesCache.read = realRead;
  }
});

test('JAGHELM_DRIVES=off reaches the cache before the cycle’s status is built', async () => {
  board();
  const was = process.env.JAGHELM_DRIVES;
  process.env.JAGHELM_DRIVES = 'off';
  let asked = 0;
  drivesCache.read = async () => {
    asked += 1;
    return { enabled: true, nodes: {} };
  };
  try {
    await runStatusAndPush([]);
    assert.equal(getCached('drives').enabled, false);
    assert.equal(asked, 0);
  } finally {
    if (was === undefined) delete process.env.JAGHELM_DRIVES;
    else process.env.JAGHELM_DRIVES = was;
    drivesCache.read = realRead;
  }
});
