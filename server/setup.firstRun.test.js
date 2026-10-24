/**
 * #322: a fresh install against the mock Prometheus. Nothing on disk; the
 * first boot discovers the nodes and saves them, and the guided setup is
 * pending until Finish or Skip clears it for good. The browser half of the
 * same journey is e2e/setup.spec.mjs and src/App.setup.test.jsx.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret

const { createMockPrometheus, homelabSeries } = await import('./testing/mockPrometheus.js');
const { initDiscovery } = await import('./discovery.js');
const { getConfig, loadConfig, stopConfigWatcher } = await import('./config.js');
const { firstBoot } = await import('./firstBoot.js');
const { setupRoutes } = await import('./routes/setup.js');
const { servicesRoutes } = await import('./routes/services.js');

const PROM = 'http://localhost:9994';
const { labels, series } = homelabSeries({ nodes: 2 });
const mock = createMockPrometheus(series, { url: PROM });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith(PROM)) throw new Error(`unexpected fetch ${url}`);
  return mock.fetch(url, init);
};
after(() => {
  stopConfigWatcher();
  globalThis.fetch = realFetch;
});

const app = express();
app.use(express.json());
app.use('/api/setup', setupRoutes);
app.use('/api/services', servicesRoutes);

test('a fresh install finds its nodes, offers the setup, and keeps it done once finished', async () => {
  initDiscovery(PROM);
  assert.equal(loadConfig(), null, 'no services.yaml: a first boot');
  assert.equal((await request(app).get('/api/setup')).body.pending, false, 'nothing yet');

  await firstBoot();
  assert.ok(existsSync(join(process.env.JAGHELM_DATA_DIR, 'services.yaml')));
  assert.deepEqual(Object.keys(getConfig().nodes).sort(), [...labels, 'elsewhere'].sort());
  const configured = await request(app).get('/api/services/config');
  assert.deepEqual(Object.keys(configured.body.nodes).sort(), [...labels, 'elsewhere'].sort());

  assert.equal((await request(app).get('/api/setup')).body.pending, true);
  assert.equal((await request(app).post('/api/setup/done')).body.pending, false);

  // A restart finds its services.yaml: no first boot, and no setup comes back.
  assert.ok(loadConfig());
  assert.equal((await request(app).get('/api/setup')).body.pending, false);
});
