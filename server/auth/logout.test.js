/**
 * Signing out revokes the session on the server (#507). POST /api/auth/logout
 * deletes the presented token's session from the store, and the deletion is the
 * revocation (sessions.restart.test.js: it holds across a restart). It answers
 * 204 whatever the token, so a second sign-out or a second tab never meets a
 * 401, and the route says nothing about whether a token was valid.
 *
 * The authenticated routes are read from the app's own router table, so a route
 * added later is covered without editing this file. Auth is frozen at module
 * load (DASH_PASS is read once), so DASH_PASS is set before the app is imported.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.DASH_PASS = 'test-pass-1234'; // auth ENABLED (set before import)
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { app } = await import('../index.js');
const { stopBackgroundRefresh } = await import('../refresh.js');
const { authMiddleware } = await import('./middleware.js');
const { createSession, getSession, _resetAllSessions, SESSION_MAX_AGE_MS } =
  await import('./sessions.js');

after(() => {
  stopBackgroundRefresh();
  delete process.env.DASH_PASS;
});

beforeEach(() => _resetAllSessions());

// ── The router table ─────────────────────────────────────────────────────

// Express 4 keeps a mount path only as the regexp it compiled from it.
function mountPath(layer) {
  if (layer.regexp.fast_slash) return '';
  const m = /^\^(.*)\\\/\?\(\?=\\\/\|\$\)$/.exec(layer.regexp.source);
  assert.ok(m, `a mount whose path can't be read back: ${layer.regexp}`);
  return m[1].replace(/\\\//g, '/');
}

// A concrete path for a route path: each :param becomes "x".
function concrete(path) {
  assert.equal(typeof path, 'string', `a route with a non-string path: ${path}`);
  return path.replace(/:\w+\??/g, 'x');
}

// Middleware that passes every request on, or only refuses more than
// authMiddleware would (requireAuthEnabled: 403 while no password is set). A
// layer not listed here, and not authMiddleware or an error handler, fails the
// walk: say whether it gates requests before adding it.
const PASS_THROUGH = new Set([
  'query',
  'expressInit',
  'metricsMiddleware',
  'refreshHint', // only sets a header, after authMiddleware
  'accessLog',
  'helmetMiddleware',
  'corsMiddleware',
  'compression',
  'jsonParser',
  'serveStatic',
  'requireAuthEnabled',
]);

// The app's two fallbacks: the JSON 404 for an unknown /api path and the SPA's
// index.html. Not endpoints; any other wildcard route fails the walk.
const FALLBACKS = new Set(['/api/*', '*']);

/**
 * Every route under `stack`, with its path relative to it and whether
 * authMiddleware guards it: ahead of the route's handler, or as a middleware
 * layer ahead of it whose path matches, at any level. Anything the walk can't
 * place (another kind of layer, a route guarded by something else, a path it
 * can't make concrete) fails it, so the list stays complete by construction.
 */
function routesOf(stack, top = false) {
  const out = [];
  stack.forEach((layer, i) => {
    let found;
    if (layer.route) {
      const { path, methods } = layer.route;
      if (top && FALLBACKS.has(path)) return;
      assert.ok(!String(path).includes('*'), `a wildcard route the walk can't list: ${path}`);
      found = Object.keys(methods).map((method) => {
        const handlers = layer.route.stack.filter((l) => !l.method || l.method === method);
        const guards = handlers.slice(0, -1);
        assert.ok(
          guards.every((l) => l.handle === authMiddleware),
          `${named(method, path)} runs ${guards.map((l) => l.name).join(', ')} before its handler: ` +
            'a guard other than authMiddleware needs its own case here'
        );
        return { method, path: concrete(path), guarded: guards.length > 0 };
      });
    } else if (layer.name === 'router') {
      const base = mountPath(layer);
      found = routesOf(layer.handle.stack).map((r) => ({ ...r, path: base + r.path }));
    } else {
      const known =
        layer.handle === authMiddleware ||
        layer.handle.length === 4 || // an error handler: never sees a request without an error
        PASS_THROUGH.has(layer.name);
      assert.ok(known, `an unknown middleware layer "${layer.name}" (${layer.regexp}): list it`);
      return;
    }
    const gates = stack.slice(0, i).filter((l) => !l.route && l.handle === authMiddleware);
    for (const r of found) {
      out.push({ ...r, guarded: r.guarded || gates.some((g) => g.match(r.path)) });
    }
  });
  return out;
}

const named = (method, path) => `${method.toUpperCase()} ${path}`;
const AUTHENTICATED = routesOf(app._router.stack, true)
  .filter((r) => r.guarded)
  .map(({ method, path }) => [method, path]);

const signOut = (token) => {
  const r = request(app).post('/api/auth/logout');
  return token === undefined ? r : r.set('x-auth-token', token);
};

// ── Log capture ──────────────────────────────────────────────────────────

const settle = () => new Promise((resolve) => setImmediate(resolve));

// The structured logger's lines (raw text and parsed) while `fn` runs; anything
// else written to stdout/stderr passes through.
async function captureLogs(fn) {
  const lines = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  const tap = (orig) =>
    function (chunk, ...rest) {
      const text = String(chunk);
      try {
        const obj = JSON.parse(text);
        if (obj && obj.module && obj.level) {
          lines.push({ raw: text, ...obj });
          return true;
        }
      } catch {
        // not one of ours
      }
      return orig.call(this, chunk, ...rest);
    };
  process.stdout.write = tap(origOut);
  process.stderr.write = tap(origErr);
  try {
    await fn();
    await settle();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return lines;
}

// ── Tests ────────────────────────────────────────────────────────────────

test('the router table yields the authenticated routes, and each refuses a request with no token', async () => {
  const listed = AUTHENTICATED.map(([m, p]) => named(m, p));
  // A walk that finds nothing would pass every test below: pin a few by name,
  // one per kind of gate (a mount, a route's own handler, the /api catch-all).
  for (const expected of [
    'GET /api/services/config',
    'POST /api/services/config',
    'PUT /api/secrets/x',
    'DELETE /api/push/devices/x',
    'POST /api/auth/change-password',
    'GET /api/cron/status',
    'GET /api/weather',
    'GET /api/gitea/activity',
  ]) {
    assert.ok(listed.includes(expected), `${expected} is in the list`);
  }
  assert.ok(AUTHENTICATED.length >= 30, `${AUTHENTICATED.length} routes found`);
  for (const open of ['POST /api/auth/login', 'GET /api/auth/check', 'POST /api/auth/logout']) {
    assert.ok(!listed.includes(open), `${open} is public`);
  }
  for (const [method, path] of AUTHENTICATED) {
    const r = await request(app)[method](path);
    assert.equal(r.status, 401, `${named(method, path)} without a token`);
  }
});

test('after sign-out the old token gets 401 on every authenticated route', async () => {
  const token = createSession('admin');
  const check = await request(app).get('/api/auth/check').set('x-auth-token', token);
  assert.equal(check.body.authenticated, true, 'the session works before sign-out');

  const r = await signOut(token);
  assert.equal(r.status, 204);
  assert.equal(r.text, '');
  assert.equal(getSession(token), null, 'the session is gone from the store');

  for (const [method, path] of AUTHENTICATED) {
    const res = await request(app)[method](path).set('x-auth-token', token);
    assert.equal(res.status, 401, `${named(method, path)} with the signed-out token`);
  }
  const after = await request(app).get('/api/auth/check').set('x-auth-token', token);
  assert.equal(after.body.authenticated, false);
});

test("signing out one session leaves the same user's other session working", async () => {
  const phone = createSession('admin');
  const browser = createSession('admin');
  assert.equal((await signOut(browser)).status, 204);

  assert.ok(getSession(phone), 'the other session is still in the store');
  const check = await request(app).get('/api/auth/check').set('x-auth-token', phone);
  assert.equal(check.body.authenticated, true);
  for (const path of ['/api/display-config', '/api/todos', '/api/cron/status', '/api/secrets/keys']) {
    const res = await request(app).get(path).set('x-auth-token', phone);
    assert.equal(res.status, 200, `GET ${path} with the other session`);
  }
  // Past the gate: the handler's own 400 for a missing location, not a 401.
  const weather = await request(app).get('/api/weather').set('x-auth-token', phone);
  assert.equal(weather.status, 400);
});

test('a sign-out logs one info line with the user, and no line carries the token', async () => {
  const token = createSession('admin');
  let res;
  const lines = await captureLogs(async () => {
    res = await signOut(token);
  });
  assert.equal(res.status, 204);

  const auth = lines.filter((l) => l.module === 'auth');
  assert.deepEqual(
    auth.map(({ level, msg, user }) => ({ level, msg, user })),
    [{ level: 'info', msg: 'signed out', user: 'admin' }]
  );
  const access = lines.filter((l) => l.msg === 'request');
  assert.deepEqual(
    access.map(({ method, path, status }) => ({ method, path, status })),
    [{ method: 'POST', path: '/api/auth/logout', status: 204 }]
  );
  assert.equal(lines.length, 2, 'nothing else is logged');
  // Neither the token nor any 8 characters of it in a row.
  for (let i = 0; i + 8 <= token.length; i++) {
    const piece = token.slice(i, i + 8);
    for (const l of lines) assert.ok(!l.raw.includes(piece), `"${piece}" of the token in ${l.raw}`);
  }
});

test('an unknown, revoked, expired or missing token gets the same 204 and logs only its request line', async (t) => {
  const revoked = createSession('admin');
  assert.equal((await signOut(revoked)).status, 204);
  const expired = createSession('admin');
  const unknown = 'f'.repeat(64);

  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + SESSION_MAX_AGE_MS });
  const cases = [
    ['an unknown token', unknown],
    ['a signed-out token', revoked],
    ['an expired token', expired],
    ['no token', undefined],
    ['an empty token', ''],
  ];
  for (const [what, token] of cases) {
    let res;
    const lines = await captureLogs(async () => {
      res = await signOut(token);
    });
    assert.equal(res.status, 204, what);
    assert.equal(res.text, '', what);
    assert.deepEqual(
      lines.map(({ level, msg, path, status }) => ({ level, msg, path, status })),
      [{ level: 'info', msg: 'request', path: '/api/auth/logout', status: 204 }],
      `${what}: the access line and nothing else`
    );
  }
  t.mock.timers.reset();
  assert.equal(getSession(expired), null, 'the expired session is gone too');
});
