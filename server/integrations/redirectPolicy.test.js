/**
 * #224: an integration whose credential is in the URL never follows a redirect
 * to another origin, since the redirect's Location can repeat the query there.
 * #225: a session preset's login (username and password in the body) follows a
 * same-origin 307/308 with its body, and never re-sends it to another origin.
 *
 * Which presets put a credential in the URL is not listed by hand: every preset's
 * connection test and poll run once against a stubbed fetch, and a preset counts
 * if a credential value shows up in a URL it requested. The session presets are
 * the ones with auth: 'session'. A preset added later is covered without editing
 * this file. (#204's header policy is tested in redirectAuthHeaders.test.js.)
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the secrets store at a scratch dir before anything imports it.
const dataDir = mkdtempSync(join(tmpdir(), 'jh-redirect-policy-'));
process.env.JAGHELM_DATA_DIR = dataDir;
after(() => rmSync(dataDir, { recursive: true, force: true }));
const { initRegistry, listPresets, getPresetFull } = await import('./registry.js');
const { testIntegration, fetchIntegration } = await import('./handler.js');

// The handler resolves presets through the registry, as the server does. The
// gallery's list leaves out unsupported presets, which are never fetched.
await initRegistry();
const presets = listPresets().map((p) => getPresetFull(p.type));
// A preset's .env credentials win over the ones passed here; make sure none are set.
for (const p of presets) for (const v of Object.values(p.envKeys || {})) delete process.env[v];

// Random so a match in a URL can only be the credential itself.
const hex = () => randomBytes(8).toString('hex');
const CREDS = { username: `u${hex()}`, password: `p${hex()}`, token: `t${hex()}` };
const SECRETS = Object.values(CREDS);
const uniqueKey = (type) => `${type}_${hex()}`;

/** Run both of a preset's request paths: the connection test, then a poll. */
async function runBoth(type, url) {
  const tested = await testIntegration(type, { url, ...CREDS });
  const polled = await fetchIntegration(type, { url, ...CREDS, _storageKey: uniqueKey(type) }, true);
  return { tested, polled };
}

/** Swap in a fake global fetch for the duration of fn. */
async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const json200 = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });

// The presets whose requests carry a credential in the URL.
const keyed = new Set();
for (const p of presets) {
  const urls = [];
  await withFetch(async (url) => { urls.push(String(url)); return json200(); },
    () => runBoth(p.type, 'http://svc.example.test'));
  if (urls.some((u) => SECRETS.some((s) => u.includes(s)))) keyed.add(p.type);
}

function listen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// Two origins: `from` redirects every request (path and query kept) to `to`,
// which counts what reached it. Different ports on one host are different origins.
async function twoOrigins(status = 302) {
  const state = { from: 0, to: 0 };
  const to = await listen((req, res) => {
    state.to++;
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}');
  });
  const from = await listen((req, res) => {
    state.from++;
    res.writeHead(status, { location: `http://127.0.0.1:${to.address().port}${req.url}` }); res.end();
  });
  return {
    state,
    fromUrl: `http://127.0.0.1:${from.address().port}`,
    close: () => { to.close(); from.close(); },
  };
}

const REFUSED = /redirected .* not following .*credential is in the URL/;

test('the presets that put a credential in the URL are found', () => {
  assert.ok(presets.length >= 30, `only ${presets.length} presets loaded`);
  // The ones #224 named, as a check that the derivation sees them; the tests
  // below cover whatever the presets actually do.
  for (const t of ['sabnzbd', 'tautulli', 'emby']) assert.ok(keyed.has(t), `${t} not detected`);
});

for (const type of keyed) {
  test(`${type}: a redirect to another origin is refused and the key never reaches it`, async () => {
    const o = await twoOrigins();
    try {
      const { tested, polled } = await runBoth(type, o.fromUrl);
      assert.equal(tested.ok, false);
      assert.match(tested.error, REFUSED);
      assert.match(polled.error, REFUSED);
      assert.ok(o.state.from >= 2, 'the configured origin was not asked');
      assert.equal(o.state.to, 0, 'the other origin received a request');
    } finally { o.close(); }
  });

  test(`${type}: the same-host http -> https upgrade is followed`, async () => {
    const hops = [];
    const { tested, polled } = await withFetch(async (url) => {
      hops.push(String(url));
      const u = new URL(url);
      if (u.protocol === 'http:') {
        return new Response(null, { status: 302, headers: { location: String(url).replace(/^http:/, 'https:') } });
      }
      return json200();
    }, () => runBoth(type, 'http://svc.example.test'));
    assert.equal(tested.ok, true, tested.error);
    assert.equal(polled.error, null);
    assert.ok(hops.some((h) => h.startsWith('https://svc.example.test/')), 'the upgrade was not followed');
  });
}

test('a preset without a credential in the URL still follows a cross-origin redirect', async () => {
  const o = await twoOrigins();
  const missed = [];
  try {
    for (const p of presets) {
      if (keyed.has(p.type)) continue;
      const before = o.state.to;
      const tested = await testIntegration(p.type, { url: o.fromUrl, ...CREDS });
      if (o.state.to === before) missed.push(p.type);
      // A session preset's login lands on a server that hands out no token.
      if (p.auth !== 'session') assert.equal(tested.ok, true, `${p.type}: ${tested.error}`);
    }
  } finally { o.close(); }
  assert.deepEqual(missed, [], 'these presets stopped following cross-origin redirects');
});

// A custom integration (no preset) can put {token} or {password} in its
// endpoint; resolveEndpoint fills it in from the credential.
for (const endpoint of ['/status?key={token}', '/api/{token}/status', '/status?pw={password}']) {
  test(`a custom integration with ${endpoint} as its endpoint refuses a cross-origin redirect`, async () => {
    const o = await twoOrigins();
    try {
      const polled = await fetchIntegration(`custom-${hex()}`,
        { url: o.fromUrl, endpoint, auth: 'none', ...CREDS, fields: [] }, true);
      assert.match(polled.error, REFUSED);
      assert.equal(o.state.to, 0, 'the other origin received a request');
    } finally { o.close(); }
  });
}

test('a custom integration with no credential in its endpoint follows a cross-origin redirect', async () => {
  const o = await twoOrigins();
  try {
    const polled = await fetchIntegration(`custom-${hex()}`,
      { url: o.fromUrl, endpoint: '/status?key=value', auth: 'header', ...CREDS, fields: [] }, true);
    assert.equal(polled.error, null);
    assert.equal(o.state.to, 1);
  } finally { o.close(); }
});

// #225: every supported session preset's login, behind a 307 or 308.
const sessionPresets = presets.filter((p) => p.auth === 'session');

/** A login response holding `tok` at the preset's tokenPath ('a.b' -> {a:{b:tok}}). */
function loginResponse(tokenPath, tok) {
  const out = {};
  let at = out;
  const keys = String(tokenPath).split('.');
  for (const k of keys.slice(0, -1)) at = at[k] = {};
  at[keys[keys.length - 1]] = tok;
  return JSON.stringify(out);
}

test('session presets are found', () => {
  assert.ok(sessionPresets.length >= 2, `only ${sessionPresets.length} session presets`);
});

for (const p of sessionPresets) {
  for (const status of [307, 308]) {
    test(`${p.type}: a login behind a cross-origin ${status} is not re-sent there`, async () => {
      const o = await twoOrigins(status);
      try {
        const tested = await testIntegration(p.type, { url: o.fromUrl, ...CREDS });
        assert.equal(tested.ok, false);
        // A preset with oauth2Instructions reports every failed login as a
        // possible 2FA problem, so only the others show the refusal itself.
        if (!p.oauth2Instructions) {
          assert.match(tested.error, /refusing to re-send a request body to another origin/);
        }
        assert.equal(o.state.to, 0, 'the other origin received the login');
      } finally { o.close(); }
    });

    test(`${p.type}: a login behind a same-origin ${status} is re-sent with its body`, async () => {
      const logins = [];
      const srv = await listen((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          if (req.url === p.session.loginEndpoint) {
            res.writeHead(status, { location: '/moved' }); res.end(); return;
          }
          logins.push([req.method, req.url, body]);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(loginResponse(p.session.tokenPath, 'session-tok'));
        });
      });
      try {
        const tested = await testIntegration(p.type, { url: `http://127.0.0.1:${srv.address().port}`, ...CREDS });
        assert.equal(tested.ok, true, tested.error);
        assert.equal(logins.length, 1);
        assert.equal(logins[0][0], 'POST');
        assert.ok(logins[0][2].includes(CREDS.password), 'the login body was not re-sent');
      } finally { srv.close(); }
    });
  }
}
