/**
 * The thresholds (the status model's, so push's too, #292) come from
 * display-config.json, which the background loop used to re-read every cycle. It is now parsed again only when the file
 * changes (one stat per read compares its mtime, size and inode), so a hand
 * edit still takes effect on the next cycle, and the displayConfig POST route
 * invalidates the cache too (#241).
 */
import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-thresholds-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.LOG_LEVEL = 'info'; // the parse-warning test reads the warn line
const configPath = join(dataDir, 'display-config.json');

const { getThresholds, stopBackgroundRefresh } = await import('./refresh.js');
const { DEFAULT_THRESHOLDS } = await import('./status/thresholds.js');
const { displayConfigRoutes } = await import('./routes/displayConfig.js');
const { atomicWriteFileSync } = await import('./util/atomicWrite.js');

after(() => {
  // A save that changes the interval restarts the loop; stop it so the file can exit.
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

// A save through a new inode, as an editor's write-and-rename or JagHelm's own
// atomic write does.
function replaceConfig(config) {
  atomicWriteFileSync(configPath, JSON.stringify(config));
}

// Rewrites the file in place (same inode) and pins its mtime, so its identity
// changes only when the test means it to.
function rewriteInPlace(text, mtimeSec) {
  writeFileSync(configPath, text);
  utimesSync(configPath, mtimeSec, mtimeSec);
}

const T0 = 1_760_000_000;

// The CPU warn line in force: what the hand-edit tests below read.
const cpuLine = () => getThresholds().cpu.warn;

test('thresholds: the defaults when there is no display config', () => {
  assert.deepEqual(getThresholds(), DEFAULT_THRESHOLDS);
});

test('the status model reads display-config\'s pushThresholds over the defaults (#290)', () => {
  replaceConfig({ pushThresholds: { cpu: 0.7, disk: 0.8, hysteresis: 0.02 } });
  const t = getThresholds();
  assert.deepEqual([t.cpu.warn, t.mem.warn, t.disk.warn, t.disk.crit, t.hysteresis.fraction], [0.7, 0.9, 0.8, 0.95, 0.02]);
  replaceConfig({});
  assert.deepEqual(getThresholds(), DEFAULT_THRESHOLDS);
});

test('thresholds: a hand edit is picked up on the next read', () => {
  replaceConfig({ pushThresholds: { cpu: 0.7 } });
  assert.equal(cpuLine(), 0.7);
  replaceConfig({ pushThresholds: { cpu: 0.6 } });
  assert.equal(cpuLine(), 0.6);
});

test('thresholds: re-read when the file changes, not otherwise', () => {
  rewriteInPlace(JSON.stringify({ pushThresholds: { cpu: 0.7 } }), T0);
  assert.equal(cpuLine(), 0.7);
  // Same inode, size and mtime: the cached copy is served, the file is not read.
  rewriteInPlace(JSON.stringify({ pushThresholds: { cpu: 0.6 } }), T0);
  assert.equal(cpuLine(), 0.7);
  utimesSync(configPath, T0 + 1, T0 + 1);
  assert.equal(cpuLine(), 0.6, 'a new mtime: re-read');
});

test('thresholds: a file restored with an older mtime is re-read', () => {
  rewriteInPlace(JSON.stringify({ pushThresholds: { cpu: 0.7 } }), T0 + 100);
  assert.equal(cpuLine(), 0.7);
  rewriteInPlace(JSON.stringify({ pushThresholds: { cpu: 0.6 } }), T0);
  assert.equal(cpuLine(), 0.6);
});

test('thresholds: a file that fails to parse falls back to the defaults with one warning', (t) => {
  const warnings = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  t.mock.method(process.stderr, 'write', (chunk, ...rest) => {
    if (String(chunk).includes('display-config.json')) warnings.push(String(chunk));
    else return realWrite(chunk, ...rest);
    return true;
  });
  rewriteInPlace('{"pushThresholds": {"cpu": 0.7', T0 + 200);
  assert.equal(cpuLine(), 0.9);
  assert.equal(cpuLine(), 0.9);
  assert.equal(warnings.length, 1, 'once per bad file, not every read');
  rewriteInPlace('{"pushThresholds": {"cpu": 0.6', T0 + 201);
  cpuLine();
  assert.equal(warnings.length, 2, 'a different bad file warns again');
  replaceConfig({ pushThresholds: { cpu: 0.6 } });
  assert.equal(cpuLine(), 0.6);
  assert.equal(warnings.length, 2);
  mock.restoreAll();
});

test('thresholds: a display-config save takes effect, interval unchanged or not', async () => {
  const app = express().use(express.json()).use('/api/display-config', displayConfigRoutes);
  replaceConfig({ refreshInterval: 30, pushThresholds: { cpu: 0.7 } });
  assert.equal(cpuLine(), 0.7);

  // Over the version a read answered (If-Match, #547).
  const save = async (body) => {
    const read = await request(app).get('/api/display-config');
    return request(app).post('/api/display-config').set('If-Match', read.headers.etag).send(body);
  };
  const same = await save({ refreshInterval: 30, pushThresholds: { cpu: 0.5 } });
  assert.equal(same.status, 200);
  assert.equal(cpuLine(), 0.5, 'saved with the same interval');

  const changed = await save({ refreshInterval: 60, pushThresholds: { cpu: 0.4 } });
  assert.equal(changed.status, 200);
  assert.equal(cpuLine(), 0.4, 'saved with a new interval (loop restart)');
});
