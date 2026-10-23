/**
 * #416: saves from Settings keep services.yaml's comments and layout.
 *
 * The Nodes and Services tabs post the whole config back, and the
 * Integrations list's toggle sets one `enabled`. Each used to rewrite the
 * whole file in JagHelm's layout, so a hand-written file lost its comments.
 * Now each changes only the lines of what it changed.
 *
 * These drive the real routes against the real config module and file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

const { loadConfig } = await import('../config.js');
const { servicesRoutes } = await import('./services.js');
const { integrationRoutes } = await import('./integrations.js');
const { initRegistry } = await import('../integrations/registry.js');

// The config read masks what a preset's endpoint fills in, so it needs the presets.
await initRegistry();

const CONFIG_PATH = join(process.env.JAGHELM_DATA_DIR, 'services.yaml');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api/services', servicesRoutes);
app.use('/api/integrations', integrationRoutes);

const fileText = () => readFileSync(CONFIG_PATH, 'utf8');
/** Put `text` on disk and load it, as the config watcher does after a hand edit. */
function handEdit(text) {
  writeFileSync(CONFIG_PATH, text);
  loadConfig();
}

/** What a Settings tab does: read the config, change it, post all of it back. */
async function tabSave(edit) {
  const read = await request(app).get('/api/services/config');
  assert.equal(read.status, 200);
  const config = read.body;
  edit(config);
  const r = await request(app)
    .post('/api/services/config')
    .set('If-Match', read.headers.etag)
    .send(config);
  assert.equal(r.status, 200, JSON.stringify(r.body));
}

// Written by hand: comments, blank lines, quoting and flow style that
// JagHelm's own writer would not produce, and stored credentials the tabs see
// only as markers.
const HAND_WRITTEN = [
  '# My homelab, written by hand.',
  '',
  'nodes:',
  '  # The hypervisor',
  '  pve:',
  '    display_name: Proxmox # shown on the board',
  '    subtitle: "Main box"',
  '    hide: [ prometheus, cadvisor ] # noisy ones',
  '',
  '  nas:',
  "    display_name: 'NAS'",
  '',
  'services:',
  '  grafana:',
  "    monitor: Grafana # the Kuma monitor's name",
  '  adguard: { monitor: "AdGuard (DNS)" }',
  '  # sonarr is retired',
  '',
  'integrations:',
  '  # AdGuard, the primary',
  '  adguard_primary:',
  '    preset: adguard',
  '    instance: primary',
  '    url: http://adguard.example.test:3000',
  '    username: admin',
  '    password: $secret:integration_adguard_primary_password', // pragma: allowlist secret
  '    enabled: true # toggled from Settings',
  '  statuspage:',
  '    url: "http://status.example.test"',
  '    endpoint: /api/summary',
  '    auth: header',
  '    authHeader: X-Api-Key',
  "    token: 'plain-token-7f3a' # typed here by hand", // pragma: allowlist secret
  '',
].join('\n');

/** `text` with each `[from, to]` line replaced, checking each is there. */
function withLines(text, ...changes) {
  let out = text;
  for (const [from, to] of changes) {
    assert.ok(out.includes(`${from}\n`), `the file has the line ${JSON.stringify(from)}`);
    out = out.replace(`${from}\n`, `${to}\n`);
  }
  return out;
}

test('Nodes and Services tab saves change only the lines they changed; every comment stays', async () => {
  handEdit(HAND_WRITTEN);

  // The Nodes tab renames a node.
  await tabSave((cfg) => {
    cfg.nodes.pve.display_name = 'Proxmox VE';
  });
  const afterNodes = withLines(HAND_WRITTEN, [
    '    display_name: Proxmox # shown on the board',
    '    display_name: Proxmox VE # shown on the board',
  ]);
  assert.equal(fileText(), afterNodes);

  // The Services tab maps a container to another monitor.
  await tabSave((cfg) => {
    cfg.services.grafana.monitor = 'Grafana (Kuma)';
  });
  assert.equal(
    fileText(),
    withLines(afterNodes, [
      "    monitor: Grafana # the Kuma monitor's name",
      "    monitor: Grafana (Kuma) # the Kuma monitor's name",
    ])
  );
});

test('one save with a changed node and a changed service keeps the credentials and the rest', async () => {
  handEdit(HAND_WRITTEN);
  await tabSave((cfg) => {
    cfg.nodes.nas.display_name = 'Storage';
    cfg.services.adguard.monitor = 'AdGuard';
  });
  assert.equal(
    fileText(),
    withLines(
      HAND_WRITTEN,
      ["    display_name: 'NAS'", "    display_name: 'Storage'"],
      ['  adguard: { monitor: "AdGuard (DNS)" }', '  adguard: { monitor: "AdGuard" }']
    )
  );
});

test('the toggle on a hand-written, commented file changes only the enabled line', async () => {
  handEdit(HAND_WRITTEN);
  const r = await request(app).patch('/api/integrations/adguard_primary').send({ enabled: false });
  assert.equal(r.status, 200);
  assert.equal(
    fileText(),
    withLines(HAND_WRITTEN, [
      '    enabled: true # toggled from Settings',
      '    enabled: false # toggled from Settings',
    ])
  );
});
