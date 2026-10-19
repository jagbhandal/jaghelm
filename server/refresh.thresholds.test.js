/**
 * The push thresholds come from display-config.json, which the background loop
 * used to re-read every cycle. It is now read once and cached, and the
 * displayConfig POST route (its only writer) invalidates the cache (#241).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-thresholds-'));
process.env.JAGHELM_DATA_DIR = dataDir;
const configPath = join(dataDir, 'display-config.json');

const { getPushThresholds, invalidateDisplayConfigCache, stopBackgroundRefresh } = await import('./refresh.js');
const { displayConfigRoutes } = await import('./routes/displayConfig.js');

after(() => {
  // A save that changes the interval restarts the loop; stop it so the file can exit.
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

function writeConfig(config) {
  writeFileSync(configPath, JSON.stringify(config));
}

test('push thresholds: the defaults when there is no display config', () => {
  invalidateDisplayConfigCache();
  assert.deepEqual(getPushThresholds(), { cpu: 0.9, mem: 0.9, disk: 0.9, hysteresis: 0.05 });
});

test('push thresholds: read once, then served from the cache until it is invalidated', () => {
  writeConfig({ pushThresholds: { cpu: 0.7 } });
  invalidateDisplayConfigCache();
  assert.equal(getPushThresholds().cpu, 0.7);
  writeConfig({ pushThresholds: { cpu: 0.6 } });
  assert.equal(getPushThresholds().cpu, 0.7, 'not re-read on every call');
  invalidateDisplayConfigCache();
  assert.equal(getPushThresholds().cpu, 0.6);
});

test('push thresholds: a display-config save invalidates the cache, interval unchanged or not', async () => {
  const app = express().use(express.json()).use('/api/display-config', displayConfigRoutes);
  writeConfig({ refreshInterval: 30, pushThresholds: { cpu: 0.7 } });
  invalidateDisplayConfigCache();
  assert.equal(getPushThresholds().cpu, 0.7);

  const same = await request(app).post('/api/display-config').send({ refreshInterval: 30, pushThresholds: { cpu: 0.5 } });
  assert.equal(same.status, 200);
  assert.equal(getPushThresholds().cpu, 0.5, 'saved with the same interval');

  const changed = await request(app).post('/api/display-config').send({ refreshInterval: 60, pushThresholds: { cpu: 0.4 } });
  assert.equal(changed.status, 200);
  assert.equal(getPushThresholds().cpu, 0.4, 'saved with a new interval (loop restart)');
});
