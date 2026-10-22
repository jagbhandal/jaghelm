/**
 * Access log contract (#245, #492): one line per request with the full path
 * (router mount prefix included; query string, fragment and absolute-form
 * authority dropped). accessLevel() decides the level: 5xx at error; 4xx, slow
 * requests and any request that can change something (not GET, HEAD or OPTIONS)
 * at info; a fast successful read (a dashboard poll's 200 or 304) at debug.
 * Probe endpoints are logged only when they fail.
 *
 * The unit tests drive createAccessLog() on a small app with mounted routers
 * (the mount is what stripped req.path before) and a capturing logger; the
 * wiring tests check the real app and the real logger through stdout/stderr,
 * and the LOG_LEVEL test runs the real middleware in a child process per level.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-accesslog-'));
process.env.JAGHELM_DATA_DIR = dataDir;
delete process.env.DASH_PASS; // auth disabled
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';
// Debug lines must be visible so a probe that is logged at debug would show up.
process.env.LOG_LEVEL = 'debug';

const { createAccessLog, accessLevel, SLOW_REQUEST_MS } = await import('./accessLog.js');
const { app: realApp } = await import('./index.js');
const { stopBackgroundRefresh } = await import('./refresh.js');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
});

function captureLogger() {
  const lines = [];
  const at = (level) => (fields, msg) => lines.push({ level, msg, ...fields });
  return {
    lines,
    logger: { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') },
  };
}

// The 'finish' listener runs after supertest has the response; wait a tick for it.
const settle = () => new Promise((r) => setImmediate(r));

/**
 * A small app shaped like index.js: access log first, routers mounted under /api.
 * The slow threshold defaults high so a loaded CI runner can't turn a debug line
 * into info; the slow test sets its own, and accessLevel covers the default.
 */
function makeApp(opts) {
  const { lines, logger } = captureLogger();
  const app = express();
  app.use(createAccessLog({ logger, slowMs: 60_000, ...opts }));

  const items = express.Router();
  items.get('/list', (req, res) => res.json([]));
  items.get('/missing', (req, res) => res.status(404).json({ error: 'nope' }));
  // Live 5xx are sent from inside the router (apiError 502 on /gitea/activity,
  // /cached): that is where req.path is still mount-relative at 'finish'.
  items.get('/upstream', (req, res) => res.status(502).json({ error: 'Upstream unreachable' }));
  items.get('/boom', () => {
    throw new Error('boom');
  });
  items.get('/slow', (req, res) => setTimeout(() => res.json({}), 40));
  app.use('/api/items', items);

  const push = express.Router();
  push.get('/prefs', (req, res) => res.json({ prefs: {} }));
  app.use('/api/push', push);

  const system = express.Router();
  system.get('/health', (req, res) => res.json({ status: 'ok' }));
  system.get('/readyz', (req, res) => res.status(503).json({ ready: false }));
  app.use('/api', system);
  app.get('/metrics', (req, res) => res.send('# metrics'));

  app.use((err, req, res, _next) => res.status(500).json({ error: 'Internal server error' }));
  return { app, lines };
}

test('a routed API request logs one line with the full path, at debug when fast and 2xx', async () => {
  const { app, lines } = makeApp();
  await request(app).get('/api/items/list').expect(200);
  await settle();
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, 'debug');
  assert.equal(lines[0].msg, 'request');
  assert.equal(lines[0].method, 'GET');
  assert.equal(lines[0].path, '/api/items/list');
  assert.equal(lines[0].status, 200);
  assert.equal(typeof lines[0].ms, 'number');
});

test('a 4xx from a mounted router logs at info with the full path', async () => {
  const { app, lines } = makeApp();
  await request(app).get('/api/items/missing').expect(404);
  await settle();
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, 'info');
  assert.equal(lines[0].path, '/api/items/missing');
  assert.equal(lines[0].status, 404);
});

test('a 5xx from a mounted router logs at error with the full path', async () => {
  const { app, lines } = makeApp();
  await request(app).get('/api/items/upstream').expect(502);
  await request(app).get('/api/items/boom').expect(500); // thrown → app error handler
  await settle();
  assert.equal(lines.length, 2);
  assert.deepEqual(
    lines.map((l) => [l.level, l.path, l.status]),
    [
      ['error', '/api/items/upstream', 502],
      ['error', '/api/items/boom', 500],
    ]
  );
});

test('a slow 2xx logs at info', async () => {
  const { app, lines } = makeApp({ slowMs: 20 });
  await request(app).get('/api/items/slow').expect(200);
  await settle();
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, 'info');
  assert.equal(lines[0].path, '/api/items/slow');
  assert.ok(lines[0].ms >= 20, `ms=${lines[0].ms}`);
});

test('the query string is never logged (an FCM token rides in ?token= on /api/push/prefs)', async () => {
  const { app, lines } = makeApp();
  await request(app).get('/api/push/prefs?token=fcm-SECRET-123&x=1').expect(200);
  await settle();
  assert.equal(lines.length, 1);
  assert.equal(lines[0].path, '/api/push/prefs');
  assert.doesNotMatch(JSON.stringify(lines), /SECRET|token=|\?/);
});

/**
 * Send one raw request line. supertest never sends a fragment or an
 * absolute-form target, but Node accepts both and Express routes them.
 */
function rawGet(app, target) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const sock = net.connect(server.address().port, '127.0.0.1', () =>
        sock.write(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`)
      );
      let head = '';
      sock.on('data', (d) => (head += d));
      sock.on('error', reject);
      sock.on('close', () => server.close(() => resolve(head.split('\r\n')[0])));
    });
  });
}

test('the fragment is never logged', async () => {
  const { app, lines } = makeApp();
  await rawGet(app, '/api/push/x#token=SECRET');
  await settle();
  assert.equal(lines.length, 1);
  assert.equal(lines[0].path, '/api/push/x');
  assert.doesNotMatch(JSON.stringify(lines), /SECRET|#/);
});

test('an absolute-form request logs only its path, not the userinfo, host or query', async () => {
  const { app, lines } = makeApp();
  const status = await rawGet(app, 'http://user:pw-SECRET@example.test:99/api/items/list?token=S2');
  await settle();
  assert.match(status, / 200 /, 'Express routes an absolute-form target on its path');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].path, '/api/items/list');
  assert.doesNotMatch(JSON.stringify(lines), /SECRET|user|example|token|S2/);
});

test('health, readiness and metrics probes are logged only when they fail', async () => {
  const { app, lines } = makeApp();
  await request(app).get('/api/health').expect(200);
  await request(app).get('/metrics').expect(200);
  await request(app).get('/api/health?probe=1').expect(200);
  await request(app).get('/api/readyz').expect(503);
  await settle();
  assert.deepEqual(
    lines.map((l) => [l.level, l.path, l.status]),
    [['error', '/api/readyz', 503]]
  );
});

// [method, request target, status, ms, level (null: no line), why]
const LEVELS = [
  ['GET', '/api/services', 200, 0, 'debug', 'a dashboard poll'],
  ['GET', '/api/ups', 304, 3, 'debug', 'a poll that found nothing new'],
  ['HEAD', '/api/services', 200, 0, 'debug', 'HEAD reads like GET'],
  ['OPTIONS', '/api/services', 204, 0, 'debug', 'a CORS preflight ahead of a poll'],
  ['GET', '/api/history', 200, SLOW_REQUEST_MS - 1, 'debug', 'just under the slow line'],
  ['GET', '/api/history', 200, SLOW_REQUEST_MS, 'info', 'slow'],
  ['GET', '/api/weather', 304, 5000, 'info', 'a slow 304'],
  ['POST', '/api/todos', 200, 0, 'info', 'a write'],
  ['PUT', '/api/secrets/key', 200, 0, 'info', 'a write'],
  ['PATCH', '/api/integrations/key', 200, 0, 'info', 'a write'],
  ['DELETE', '/api/cron/jobs/node/job', 200, 0, 'info', 'a write'],
  ['POST', '/api/cron/report', 200, 0, 'info', 'a cron report'],
  ['POST', '/api/auth/login', 200, 0, 'info', 'a sign-in'],
  ['POST', '/api/auth/login', 401, 0, 'info', 'a failed sign-in'],
  ['POST', '/api/auth/login', 429, 0, 'info', 'a rate-limited sign-in'],
  ['POST', '/api/auth/change-password', 200, 0, 'info', 'a password change'],
  ['GET', '/api/services', 401, 0, 'info', 'a signed-out poll: info, as before #492'],
  ['GET', '/api/cron/status', 401, 0, 'info', 'an unauthenticated poller still shows'],
  ['GET', '/api/secrets/keys', 403, 0, 'info', 'refused: info, as before #492'],
  ['GET', '/api/nope', 404, 0, 'info', 'not found'],
  ['GET', '/api/services', 499, 0, 'info', 'the last 4xx'],
  ['GET', '/api/gitea/activity', 502, 0, 'error', 'an upstream failure'],
  ['POST', '/api/services/config', 500, 0, 'error', 'a failed write'],
  ['GET', '/api/services', 503, 5000, 'error', 'a slow 5xx'],
  ['GET', '/api/health', 200, 0, null, 'a healthy probe'],
  ['GET', '/api/health?probe=1', 200, 0, null, 'a healthy probe with a query'],
  ['GET', '/metrics', 200, 5000, null, 'a slow scrape: probes log only on 5xx'],
  ['GET', '/api/readyz', 404, 0, null, 'a probe below 500'],
  ['GET', '/api/health', 503, 0, 'error', 'a failing probe'],
  ['GET', '/api/readyz', 503, 0, 'error', 'a failing readiness probe'],
];

test('accessLevel: the level each kind of request logs at (#492)', () => {
  assert.equal(
    SLOW_REQUEST_MS,
    300,
    'same line as the feed-latency SLO (docs/slos/feed-latency.md)'
  );
  const wrong = [];
  for (const [method, originalUrl, statusCode, ms, want, why] of LEVELS) {
    const got = accessLevel({ method, originalUrl }, { statusCode }, ms);
    if (got !== want)
      wrong.push(`${method} ${originalUrl} ${statusCode} ${ms}ms (${why}): ${got}, want ${want}`);
  }
  assert.deepEqual(wrong, []);
  const poll = { method: 'GET', originalUrl: '/api/services' };
  assert.equal(accessLevel(poll, { statusCode: 200 }, 50, 50), 'info', 'custom threshold');
  assert.equal(accessLevel(poll, { statusCode: 200 }, 49, 50), 'debug', 'custom threshold');
});

/** Capture the real logger's JSON `request` lines; pass every other write through. */
async function captureRequestLines(fn) {
  const lines = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  const tap = (orig, stream) =>
    function (chunk, ...rest) {
      const s = String(chunk);
      if (s.includes('"msg":"request"')) {
        for (const l of s.split('\n').filter(Boolean)) lines.push({ stream, ...JSON.parse(l) });
        return true;
      }
      return orig.call(this, chunk, ...rest);
    };
  process.stdout.write = tap(origOut, 'out');
  process.stderr.write = tap(origErr, 'err');
  try {
    await fn();
    await settle();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return lines;
}

test('wired into the app: a 4xx from a mounted route logs its full path at info', async () => {
  // /api/secrets is mounted behind requireAuthEnabled, which refuses with 403
  // when no password is set; before #245 this logged path "/keys" at debug.
  const lines = await captureRequestLines(() =>
    request(realApp).get('/api/secrets/keys?token=abc').expect(403)
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, 'info');
  assert.equal(lines[0].module, 'jaghelm');
  assert.equal(lines[0].path, '/api/secrets/keys');
  assert.equal(lines[0].status, 403);
});

test('wired into the app: a healthy /api/health probe is not logged', async () => {
  const lines = await captureRequestLines(() => request(realApp).get('/api/health').expect(200));
  assert.deepEqual(lines, []);
});

test('wired into the app: a poll logs at debug and a sign-in at info (#492)', async () => {
  // Auth is off here: /api/auth/check answers 200, and a sign-in gets "noauth".
  const lines = await captureRequestLines(async () => {
    await request(realApp).get('/api/auth/check').expect(200);
    await request(realApp).post('/api/auth/login').send({}).expect(200);
  });
  assert.deepEqual(
    lines.map((l) => [l.method, l.path, l.status]),
    [
      ['GET', '/api/auth/check', 200],
      ['POST', '/api/auth/login', 200],
    ]
  );
  // A loaded runner can make the GET slow, which is info by design.
  assert.equal(lines[0].level, lines[0].ms >= SLOW_REQUEST_MS ? 'info' : 'debug');
  assert.equal(lines[1].level, 'info');
});

test('lines that now log at info keep only the path: a slow GET and a write with credentials (#492)', async () => {
  // The real logger (its redaction included), with a slow line a 40 ms route crosses.
  const app = express();
  app.use(createAccessLog({ slowMs: 20 }));
  app.get('/api/push/prefs', (req, res) => setTimeout(() => res.json({ prefs: {} }), 40));
  app.post('/api/push/register', (req, res) => res.json({ ok: true }));
  const lines = await captureRequestLines(async () => {
    await request(app).get('/api/push/prefs?token=fcm-SECRET-1&apikey=SECRET-2').expect(200); // pragma: allowlist secret
    await rawGet(app, 'http://user:pw-SECRET-3@example.test/api/push/prefs?password=SECRET-4'); // pragma: allowlist secret
    await request(app).post('/api/push/register?token=SECRET-5').send({}).expect(200); // pragma: allowlist secret
  });
  assert.deepEqual(
    lines.map((l) => [l.level, l.method, l.path]),
    [
      ['info', 'GET', '/api/push/prefs'],
      ['info', 'GET', '/api/push/prefs'],
      ['info', 'POST', '/api/push/register'],
    ]
  );
  assert.doesNotMatch(JSON.stringify(lines), /SECRET|token|apikey|password|user|example|\?/);
});

const execFileP = promisify(execFile);

/**
 * Run the real middleware with the real logger in a child process at one
 * LOG_LEVEL (the logger reads it once, at load) and return its request lines.
 * The requests: two dashboard polls (a 200 and a 304), a signed-out poll, a
 * write and an upstream failure.
 */
async function requestLinesAt(level) {
  const child = `
    import http from 'node:http';
    import express from ${JSON.stringify(import.meta.resolve('express'))};
    import { createAccessLog } from ${JSON.stringify(new URL('./accessLog.js', import.meta.url).href)};
    const app = express();
    // A high slow line: a loaded runner must not turn a poll into a slow request.
    app.use(createAccessLog({ slowMs: 60000 }));
    app.get('/api/services', (req, res) => res.json([]));
    app.get('/api/ups', (req, res) => res.status(304).end());
    app.get('/api/cron/status', (req, res) => res.status(401).json({ error: 'Authentication required' }));
    app.post('/api/todos', (req, res) => res.json({ ok: true }));
    app.get('/api/gitea/activity', (req, res) => res.status(502).json({ error: 'Upstream unreachable' }));
    const send = (port, method, path) => new Promise((resolve, reject) => {
      http.request({ host: '127.0.0.1', port, method, path, agent: false }, (r) => {
        r.resume();
        r.on('end', resolve);
      }).on('error', reject).end();
    });
    const server = app.listen(0, '127.0.0.1', async () => {
      const { port } = server.address();
      for (const [method, path] of [['GET', '/api/services'], ['GET', '/api/ups'],
        ['GET', '/api/cron/status'], ['POST', '/api/todos'], ['GET', '/api/gitea/activity']]) {
        await send(port, method, path);
      }
      setImmediate(() => server.close());
    });
  `;
  const env = { ...process.env, LOG_LEVEL: level };
  delete env.NODE_TEST_CONTEXT; // the child is a server, not a test file
  const { stdout, stderr } = await execFileP(
    process.execPath,
    ['--input-type=module', '-e', child],
    { env, timeout: 30_000 }
  );
  return `${stdout}\n${stderr}`
    .split('\n')
    .filter((l) => l.includes('"msg":"request"'))
    .map((l) => JSON.parse(l))
    .map((l) => [l.level, l.method, l.path, l.status])
    .sort((a, b) => a[2].localeCompare(b[2]));
}

test('LOG_LEVEL=info drops the successful polls; LOG_LEVEL=debug brings every request back (#492)', async () => {
  const [atInfo, atDebug] = await Promise.all([requestLinesAt('info'), requestLinesAt('debug')]);
  assert.deepEqual(atInfo, [
    ['info', 'GET', '/api/cron/status', 401],
    ['error', 'GET', '/api/gitea/activity', 502],
    ['info', 'POST', '/api/todos', 200],
  ]);
  assert.deepEqual(atDebug, [
    ['info', 'GET', '/api/cron/status', 401],
    ['error', 'GET', '/api/gitea/activity', 502],
    ['debug', 'GET', '/api/services', 200],
    ['info', 'POST', '/api/todos', 200],
    ['debug', 'GET', '/api/ups', 304],
  ]);
});
