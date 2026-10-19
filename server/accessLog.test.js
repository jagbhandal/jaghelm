/**
 * Access log contract (#245): one line per request with the full path (router
 * mount prefix included; query string, fragment and absolute-form authority
 * dropped). 5xx log at error, 4xx and slow requests at info, everything else at
 * debug. Probe endpoints are logged only when they fail.
 *
 * The unit tests drive createAccessLog() on a small app with mounted routers
 * (the mount is what stripped req.path before) and a capturing logger; the last
 * two check the wiring in the real app through its stdout/stderr.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import express from 'express';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-accesslog-'));
process.env.JAGHELM_DATA_DIR = dataDir;
delete process.env.DASH_PASS; // auth disabled
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';
// Debug lines must be visible so a probe that is logged at debug would show up.
process.env.LOG_LEVEL = 'debug';

const { createAccessLog, accessLogLevel, SLOW_REQUEST_MS } = await import('./accessLog.js');
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
 * into info; the slow test sets its own, and accessLogLevel covers the default.
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

test('accessLogLevel: 5xx error; 4xx and slow info; the rest debug', () => {
  assert.equal(
    SLOW_REQUEST_MS,
    300,
    'same line as the feed-latency SLO (docs/slos/feed-latency.md)'
  );
  assert.equal(accessLogLevel(200, 0), 'debug');
  assert.equal(accessLogLevel(304, 5), 'debug');
  assert.equal(accessLogLevel(200, SLOW_REQUEST_MS - 1), 'debug');
  assert.equal(accessLogLevel(200, SLOW_REQUEST_MS), 'info');
  assert.equal(accessLogLevel(401, 0), 'info');
  assert.equal(accessLogLevel(499, 0), 'info');
  assert.equal(accessLogLevel(500, 0), 'error');
  assert.equal(accessLogLevel(503, 5000), 'error');
  assert.equal(accessLogLevel(200, 50, 50), 'info', 'custom threshold');
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
