/**
 * #204: no integration credential may follow a redirect to another origin.
 *
 * The headers under test are derived from the preset definitions, the same way
 * the handler builds them (lib/auth.js for basic/bearer/header presets plus any
 * extraHeaders, a session preset's tokenHeader for its data calls), so a preset
 * added later is covered without editing this file.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Point the secrets store at a scratch dir before anything imports it.
const dataDir = mkdtempSync(join(tmpdir(), 'jh-redirect-'));
process.env.JAGHELM_DATA_DIR = dataDir;
after(() => rmSync(dataDir, { recursive: true, force: true }));
const { buildAuthHeaders } = await import('./lib/auth.js');
const { safeFetch } = await import('./lib/http.js');
const { testIntegration } = await import('./handler.js');
const { CROSS_ORIGIN_SAFE_HEADERS } = await import('../util/safeFetchCore.js');

const SAFE = new Set(CROSS_ORIGIN_SAFE_HEADERS);
const PRESETS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'presets');

// Every preset in presets/, unsupported ones included: any module whose default
// export is a preset object (helpers like createArrPreset.js have none). Imported
// directly rather than through initRegistry(), which also imports the *.test.js
// files there and would re-run their tests inside this one.
const presets = [];
for (const f of readdirSync(PRESETS_DIR)) {
  if (!f.endsWith('.js') || f.endsWith('.test.js')) continue;
  const preset = (await import(pathToFileURL(join(PRESETS_DIR, f)).href)).default;
  if (preset && typeof preset === 'object' && preset.auth) {
    presets.push({ ...preset, type: basename(f, '.js') });
  }
}

/**
 * The headers a preset puts on its data requests, split into the credential
 * ones (must never cross an origin) and the preset's extraHeaders.
 */
function headersOf(preset) {
  const cfg = { ...preset, _username: 'user', _password: 'pass', _token: 'tok' };
  const extra = new Set(Object.keys(preset.extraHeaders || {}).map((h) => h.toLowerCase()));
  const sent = new Headers(buildAuthHeaders(cfg));
  for (const s of [preset.session, preset.authFallback && preset[preset.authFallback]]) {
    if (s && s.tokenHeader) sent.set(s.tokenHeader, `${s.tokenPrefix || ''}session-tok`);
  }
  const auth = [...sent.keys()].filter((h) => !extra.has(h));
  return { sent, auth };
}

function listen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// Two origins: `from` redirects every request to the same path on `to`, which
// records what arrived. Different ports on one host are different origins.
async function twoOrigins() {
  const state = { got: null };
  const to = await listen((req, res) => {
    state.got = req.headers;
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}');
  });
  const from = await listen((req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${to.address().port}${req.url}` }); res.end();
  });
  return {
    state,
    fromUrl: `http://127.0.0.1:${from.address().port}`,
    close: () => { to.close(); from.close(); },
  };
}

test('presets are found and their credential headers are derived', () => {
  assert.ok(presets.length >= 30, `only ${presets.length} presets loaded`);
  const all = new Set(presets.flatMap((p) => headersOf(p).auth));
  // The headers #204 named, as a check that the derivation sees them; the loop
  // below covers whatever the presets actually define.
  for (const h of ['authorization', 'x-api-key', 'x-gotify-key', 'x-plex-token', 'x-emby-token',
    'private-token', 'x-ftl-sid', 'x-auth-token']) {
    assert.ok(all.has(h), `no preset sends ${h}`);
  }
  for (const p of presets) {
    if (['basic', 'bearer', 'header'].includes(p.auth)) {
      assert.ok(headersOf(p).auth.length > 0, `${p.type}: no credential header derived`);
    }
  }
});

test('no preset credential header is on the cross-origin allowlist', () => {
  for (const p of presets) {
    for (const h of headersOf(p).auth) {
      assert.ok(!SAFE.has(h), `${p.type}: credential header ${h} is allowlisted`);
    }
  }
});

test('no preset credential header follows a redirect to another origin', async () => {
  const o = await twoOrigins();
  const leaks = [];
  try {
    for (const p of presets) {
      const { sent, auth } = headersOf(p);
      o.state.got = null;
      const res = await safeFetch(`${o.fromUrl}/api`, { headers: sent });
      assert.equal(res.status, 200, `${p.type}: redirect not followed`);
      for (const h of auth) {
        if (o.state.got[h] !== undefined) leaks.push(`${p.type}: ${h}`);
      }
      // extraHeaders: allowlisted ones (Plex's Accept) still arrive, the rest don't.
      for (const [h, v] of sent) {
        if (auth.includes(h)) continue;
        if (o.state.got[h] !== (SAFE.has(h) ? v : undefined)) leaks.push(`${p.type}: extra ${h}`);
      }
    }
  } finally { o.close(); }
  assert.deepEqual(leaks, [], 'headers crossed origins against the allowlist');
});

test('a custom integration\'s own authHeader does not follow a cross-origin redirect', async () => {
  const o = await twoOrigins();
  const header = `X-Custom-${randomBytes(4).toString('hex')}`;
  try {
    const result = await testIntegration(`custom-${randomBytes(4).toString('hex')}`, {
      url: o.fromUrl,
      endpoint: '/status',
      auth: 'header',
      authHeader: header,
      token: 'custom-secret', // pragma: allowlist secret
    });
    assert.equal(result.ok, true, result.error);
    assert.ok(o.state.got, 'the redirect target was not reached');
    assert.equal(o.state.got[header.toLowerCase()], undefined, `${header} crossed origins`);
  } finally { o.close(); }
});
