/**
 * /save + /test allow-list the user-supplied `params` to a preset's declared
 * urlParams keys, so a client can't inject handler-honored keys (tlsSkip to disable
 * cert validation, endpoint/url override, extraHeaders, extraEndpoints) into the
 * saved/tested integration config.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

process.env.JAGHELM_DATA_DIR = mkdtempSync(join(tmpdir(), 'jh-int-'));
// No DASH_SECRET → the secrets manager is uninitialized and setSecret() returns
// false; the /save handler must surface that instead of persisting a config that
// references a credential it never stored.
delete process.env.DASH_SECRET;
const { initRegistry } = await import('../integrations/registry.js');
await initRegistry(); // load presets (app does this at startup) so getPreset works
const { allowedParams, integrationRoutes } = await import('./integrations.js');

// Mount the router standalone (auth-free) to exercise the /save + /delete
// persistence-return checks against the real config/secrets modules.
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/integrations', integrationRoutes);
  return app;
}

test('keeps a preset-declared urlParam, drops injected keys', () => {
  const out = allowedParams('cloudflare', {
    account_id: 'abc',        // declared in the cloudflare preset's urlParams
    tlsSkip: true,            // injected — must be dropped
    endpoint: '/evil',        // injected — must be dropped
    extraHeaders: { x: 'y' }, // injected — must be dropped
  });
  assert.deepEqual(out, { account_id: 'abc' });
});

test('a non-preset (custom) integration accepts no params', () => {
  assert.deepEqual(allowedParams('_custom', { account_id: 'x', anything: 1 }), {});
});

test('tolerates missing / non-object params', () => {
  assert.deepEqual(allowedParams('cloudflare', undefined), {});
  assert.deepEqual(allowedParams('cloudflare', 'nope'), {});
});

// ── /save credential-store check (task 1) ─────────────────────────────────
// setSecret() returns false when the secrets manager is uninitialized (no
// DASH_SECRET). The handler must NOT then persist entry.password="$secret:…"
// (a config pointing at a credential that was never stored); it must 500.
test('POST /save → 500 when a password is supplied but the secrets manager is disabled', async () => {
  const r = await request(makeApp())
    .post('/api/integrations/save')
    .send({ type: 'custom', url: 'http://example.test', password: 'hunter2' });
  assert.equal(r.status, 500, 'unstored credential must fail at save time, not later');
});

test('POST /save → 500 when a token is supplied but the secrets manager is disabled', async () => {
  const r = await request(makeApp())
    .post('/api/integrations/save')
    .send({ type: 'custom', url: 'http://example.test', token: 'abc123' });
  assert.equal(r.status, 500);
});

// ── /save + /delete persistence-return checks (task 2) ────────────────────
// With no secret to store, saveConfig succeeds, so a credential-free save (and
// a subsequent delete) report ok:true — the success path stays intact while the
// saveConfig() return is now honored.
test('POST /save → 200 when no credential is needed (saveConfig succeeds)', async () => {
  const r = await request(makeApp())
    .post('/api/integrations/save')
    .send({ type: 'custom', instance: 'tasktwo', url: 'http://example.test' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.type, 'custom_tasktwo');
});

test('DELETE /:type → 200 on a configured integration (saveConfig return honored)', async () => {
  const r = await request(makeApp()).delete('/api/integrations/custom_tasktwo');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('DELETE /:type → 404 on an unknown integration (no false success)', async () => {
  const r = await request(makeApp()).delete('/api/integrations/never_existed');
  assert.equal(r.status, 404);
});

// ── GET /:type is gone (#254) ─────────────────────────────────────────────
// It returned one integration's live data, with the whole upstream response as
// `raw`, and had no web or Android caller. The dashboard reads GET / instead.
test('GET /:type → 404 without an upstream request, configured or not', async (t) => {
  const app = makeApp();
  // A custom integration with no endpoint, and a preset that is fully set up:
  // the old route answered vaultwarden with a 200 after one upstream request.
  for (const body of [
    { type: 'custom', instance: 'rawcheck', url: 'http://example.test' },
    { type: 'vaultwarden', url: 'http://vault.example.test' },
  ]) {
    const saved = await request(app).post('/api/integrations/save').send(body);
    assert.equal(saved.status, 200);
    t.after(() => request(app).delete(`/api/integrations/${saved.body.type}`));
  }

  const realFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls++;
    return new Response('{}');
  };
  t.after(() => { globalThis.fetch = realFetch; });

  // The configured ones, and a preset nobody configured (the old route fetched
  // those too, from their .env credentials).
  for (const type of ['custom_rawcheck', 'vaultwarden', 'proxmox']) {
    const r = await request(app).get(`/api/integrations/${type}`);
    assert.equal(r.status, 404, `GET /api/integrations/${type}`);
  }
  assert.equal(upstreamCalls, 0, 'no integration was fetched');
});

test('GET /presets still lists the gallery', async () => {
  const r = await request(makeApp()).get('/api/integrations/presets');
  assert.equal(r.status, 200);
  assert.ok(r.body.some((p) => p.type === 'proxmox'));
});

// ── unsupported-preset gate enforced server-side (security review) ─────────
// The `unsupported` flag (e.g. qbittorrent's cookie-session requirement) must be
// blocked at the routes + resolution chokepoint, not only hidden from the
// gallery — otherwise a direct save/test, or a saved/imported config, still
// reaches the side-effecting endpoint.
test('POST /save → 400 for an unsupported preset (qbittorrent)', async () => {
  const r = await request(makeApp())
    .post('/api/integrations/save')
    .send({ type: 'qbittorrent', url: 'http://qb.test' });
  assert.equal(r.status, 400, 'an unsupported preset must not be persistable');
  assert.match(r.body.error || '', /unavailable/i);
});

test('POST /test → blocked for an unsupported preset (qbittorrent)', async () => {
  const r = await request(makeApp())
    .post('/api/integrations/test')
    .send({ type: 'qbittorrent', url: 'http://qb.test' });
  assert.equal(r.body.ok, false);
  assert.match(r.body.error || '', /unavailable/i);
});

test('resolveIntegrationConfig → null for an unsupported preset (refresh-loop chokepoint)', async () => {
  const { resolveIntegrationConfig } = await import('../integrations/lib/config.js');
  assert.equal(resolveIntegrationConfig('qbittorrent', { url: 'http://qb.test' }), null);
});
