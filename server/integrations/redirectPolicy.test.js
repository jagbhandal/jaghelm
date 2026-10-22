/**
 * #224: an integration whose credential is in the URL never follows a redirect
 * to another origin, since the redirect's Location can repeat the query there.
 * #225: a session preset's login (username and password in the body) follows a
 * same-origin 307/308 with its body, and never re-sends it to another origin.
 *
 * Which presets put a credential in the URL is not listed by hand: every preset's
 * connection test and poll run once against a stubbed fetch, and a path counts
 * if a credential value shows up in a URL it requested. Each path is checked on
 * its own, since a preset can put the credential in one and not the other (a
 * {token} in the endpoint, but not in testEndpoint). The session presets are the
 * ones with auth: 'session'. A preset added later is covered without editing
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

/**
 * A preset's two request paths, each returning { ok, error }: the connection
 * test, and a poll (fetchIntegration reports only an error). Since #427 the
 * test makes the poll's requests, without a cached session.
 */
const PATHS = {
  test: (type, url) => testIntegration(type, { url, ...CREDS }),
  poll: async (type, url) => {
    const { error } = await fetchIntegration(type, { url, ...CREDS, _storageKey: uniqueKey(type) });
    return { ok: !error, error };
  },
};
const hasSecret = (u) => SECRETS.some((s) => u.includes(s));

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

// Per preset, which of its paths put a credential in a URL they request:
// type -> { test: boolean, poll: boolean }, for the presets where either does.
const keyed = new Map();
for (const p of presets) {
  const leaks = {};
  for (const [name, run] of Object.entries(PATHS)) {
    const urls = [];
    await withFetch(async (url) => { urls.push(String(url)); return json200(); },
      () => run(p.type, 'http://svc.example.test'));
    leaks[name] = urls.some(hasSecret);
  }
  if (leaks.test || leaks.poll) keyed.set(p.type, leaks);
}

function listen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// Two origins: `from` redirects every request (path and query kept) to `to`,
// which counts what reached it and keeps the URLs. Different ports on one host
// are different origins.
async function twoOrigins(status = 302) {
  const state = { from: 0, to: 0, toUrls: [] };
  const to = await listen((req, res) => {
    state.to++;
    state.toUrls.push(req.url);
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

for (const [type, leaks] of keyed) {
  for (const [name, run] of Object.entries(PATHS)) {
    if (leaks[name]) {
      test(`${type} ${name}: a redirect to another origin is refused and the key never reaches it`, async () => {
        const o = await twoOrigins();
        try {
          const result = await run(type, o.fromUrl);
          assert.equal(result.ok, false);
          assert.match(result.error, REFUSED);
          assert.ok(o.state.from >= 1, 'the configured origin was not asked');
          assert.equal(o.state.to, 0, 'the other origin received a request');
        } finally { o.close(); }
      });

      test(`${type} ${name}: the same-host http -> https upgrade is followed`, async () => {
        const hops = [];
        const result = await withFetch(async (url) => {
          hops.push(String(url));
          if (new URL(url).protocol === 'http:') {
            return new Response(null, { status: 302, headers: { location: String(url).replace(/^http:/, 'https:') } });
          }
          return json200();
        }, () => run(type, 'http://svc.example.test'));
        assert.equal(result.ok, true, result.error);
        assert.ok(hops.some((h) => h.startsWith('https://svc.example.test/')), 'the upgrade was not followed');
      });
    } else {
      // The path without a credential in its URL still follows, without one.
      test(`${type} ${name}: no credential in the URL, so a cross-origin redirect is followed`, async () => {
        const o = await twoOrigins();
        try {
          await run(type, o.fromUrl);
          assert.ok(o.state.to >= 1, 'the redirect was not followed');
          assert.ok(!o.state.toUrls.some(hasSecret), 'a credential reached the other origin');
        } finally { o.close(); }
      });
    }
  }
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
        { url: o.fromUrl, endpoint, auth: 'none', ...CREDS, fields: [] });
      assert.match(polled.error, REFUSED);
      assert.equal(o.state.to, 0, 'the other origin received a request');
    } finally { o.close(); }
  });
}

test('a custom integration with no credential in its endpoint follows a cross-origin redirect', async () => {
  const o = await twoOrigins();
  try {
    const polled = await fetchIntegration(`custom-${hex()}`,
      { url: o.fromUrl, endpoint: '/status?key=value', auth: 'header', ...CREDS, fields: [] });
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
        // The test reports a failed login as the refresh does (#427): "All
        // session auth methods failed", or a preset's oauth2Instructions.
        assert.equal(tested.ok, false);
        assert.ok(o.state.from >= 1, 'the login was not sent');
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
        // Then the data read, as a refresh makes it (#427).
        const posts = logins.filter(([method]) => method === 'POST');
        assert.equal(posts.length, 1);
        assert.ok(posts[0][2].includes(CREDS.password), 'the login body was not re-sent');
      } finally { srv.close(); }
    });
  }
}
