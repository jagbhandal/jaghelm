/**
 * #322: the guided first run's marker. A first boot (no services.yaml) leaves
 * `setup-pending`; Finish/Skip clears it for every device; an install that
 * already had a services.yaml never gets one.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-setup-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret

const { finishSetup, markSetupPending, setupPending } = await import('./setup.js');
const { setupRoutes } = await import('./routes/setup.js');
const { demoResponse } = await import('./demo.js');

const MARKER = join(dataDir, 'setup-pending');
const app = express();
app.use('/api/setup', setupRoutes);

after(() => rmSync(dataDir, { recursive: true, force: true }));
beforeEach(() => rmSync(MARKER, { force: true }));

test('nothing is pending until a first boot marks it', () => {
  assert.equal(setupPending(), false);
  markSetupPending();
  assert.equal(setupPending(), true);
  assert.ok(existsSync(MARKER));
});

test('marking twice is harmless, and finishing clears it for good', () => {
  markSetupPending();
  markSetupPending();
  assert.equal(finishSetup(), true);
  assert.equal(setupPending(), false);
  assert.equal(finishSetup(), true, 'finishing again is fine');
});

test('GET /api/setup says whether it is pending; POST /api/setup/done clears it', async () => {
  assert.deepEqual((await request(app).get('/api/setup')).body, { pending: false });
  markSetupPending();
  const got = await request(app).get('/api/setup');
  assert.deepEqual(got.body, { pending: true });
  assert.match(got.headers['cache-control'], /no-store/);
  const done = await request(app).post('/api/setup/done');
  assert.equal(done.status, 200);
  assert.deepEqual(done.body, { pending: false });
  assert.deepEqual((await request(app).get('/api/setup')).body, { pending: false });
});

test('the demo has no setup to guide', () => {
  assert.deepEqual(demoResponse({ path: '/api/setup' }).body, { pending: false });
  assert.equal(demoResponse({ method: 'POST', path: '/api/setup/done' }).status, 403);
});

test('a first boot marks it; a boot that finds services.yaml does not', async () => {
  const { loadConfig } = await import('./config.js');
  const { firstBoot } = await import('./firstBoot.js');
  const { initDiscovery } = await import('./discovery.js');
  initDiscovery('http://127.0.0.1:1');
  // An install that already has its file: index.js never calls firstBoot.
  writeFileSync(join(dataDir, 'services.yaml'), 'nodes: {}\nservices: {}\nintegrations: {}\n');
  assert.ok(loadConfig());
  assert.equal(setupPending(), false);
  rmSync(join(dataDir, 'services.yaml'));
  // A fresh one: no file, firstBoot runs and leaves the marker even with Prometheus down.
  assert.equal(loadConfig(), null);
  await firstBoot();
  assert.equal(setupPending(), true);
});
