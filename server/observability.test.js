/**
 * Observability unit tests — the structured logger's output contract and the
 * Prometheus metrics layer (names must match docs/slos/* so the SLO queries
 * resolve).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

process.env.LOG_LEVEL = 'debug';
const { createLogger } = await import('./util/logger.js');
const metrics = await import('./metrics.js');
const { setCache } = await import('./cache.js');

function capture(fn) {
  const lines = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (s) => (lines.push(['out', s]), true);
  process.stderr.write = (s) => (lines.push(['err', s]), true);
  try {
    fn();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return lines;
}

test('logger emits one structured JSON line with module/level/msg + fields', () => {
  const lines = capture(() => createLogger('test').info({ a: 1 }, 'hello'));
  assert.equal(lines.length, 1);
  const [stream, line] = lines[0];
  const obj = JSON.parse(line);
  assert.equal(stream, 'out');
  assert.equal(obj.level, 'info');
  assert.equal(obj.module, 'test');
  assert.equal(obj.msg, 'hello');
  assert.equal(obj.a, 1);
  assert.ok(obj.time);
});

test('logger routes warn/error to stderr and flattens an Error field', () => {
  const lines = capture(() => createLogger('test').error({ err: new Error('boom') }, 'failed'));
  assert.equal(lines[0][0], 'err');
  const obj = JSON.parse(lines[0][1]);
  assert.equal(obj.err, 'boom');
  assert.equal(obj.msg, 'failed');
});

test('logger child namespaces the module', () => {
  const lines = capture(() => createLogger('auth').child('routes').info('x'));
  assert.equal(JSON.parse(lines[0][1]).module, 'auth:routes');
});

test('metrics register exposes the SLO-named metrics with the route pattern label', async () => {
  metrics.recordRefreshCycle(120, true);
  metrics.recordAuthFailure();
  setCache('services', { nodes: {} }); // give the freshness gauge a value to report

  // Drive the request middleware once with a minimal fake req/res.
  const handlers = {};
  const req = { method: 'GET', baseUrl: '/api/services', route: { path: '/' } };
  const res = { statusCode: 200, writableFinished: true, on: (ev, cb) => (handlers[ev] = cb) };
  metrics.metricsMiddleware(req, res, () => {});
  handlers.close();

  const text = await metrics.register.metrics();
  for (const name of [
    'http_requests_total',
    'http_request_duration_seconds_bucket',
    'jaghelm_cache_age_seconds',
    'jaghelm_refresh_cycle_duration_seconds',
    'jaghelm_auth_failures_total',
    'jaghelm_refresh_last_success_timestamp_seconds',
  ]) {
    assert.ok(text.includes(name), `metric ${name} present in /metrics output`);
  }
  // Latency SLO needs an le="0.3" bucket edge.
  assert.match(text, /http_request_duration_seconds_bucket\{[^}]*le="0\.3"/);
  // Cardinality: label is the matched route PATTERN, not a raw URL.
  assert.match(text, /http_requests_total\{[^}]*route="\/api\/services"/);
});

/** One request through the middleware, as GET /api/services answers it. */
function driveServicesRequest() {
  const handlers = {};
  const req = { method: 'GET', baseUrl: '/api/services', route: { path: '/' } };
  const res = { statusCode: 200, writableFinished: true, on: (ev, cb) => (handlers[ev] = cb) };
  metrics.metricsMiddleware(req, res, () => {});
  handlers.close();
}

test('every series a docs/slos query names is exported, with the labels it matches on (#259)', async () => {
  setCache('services', { nodes: {} });
  driveServicesRequest();
  const text = await metrics.register.metrics();
  const lines = text.split('\n').filter((l) => l && !l.startsWith('#'));

  const dir = new URL('../docs/slos/', import.meta.url);
  const docs = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => readFileSync(new URL(f, dir), 'utf8'))
    .join('\n');
  // A series reference: a metric name, then its {matchers} if it has any.
  const refs = [...docs.matchAll(/\b((?:http_request|jaghelm_)[a-z_]*)(\{[^}]*\})?/g)];
  const names = new Set(refs.map((m) => m[1]));
  // The three SLIs' series must be among them, or the docs stopped naming them.
  for (const name of [
    'http_requests_total',
    'http_request_duration_seconds_bucket',
    'http_request_duration_seconds_count',
    'jaghelm_cache_age_seconds',
  ]) {
    assert.ok(names.has(name), `docs/slos names ${name}`);
  }
  for (const [ref, name, matchers = ''] of refs) {
    // A histogram's family name (http_request_duration_seconds) stands for its series.
    const own = new RegExp(`^${name}(_bucket|_count|_sum)?[{ ]`);
    const series = lines.filter((l) => own.test(l));
    assert.ok(series.length > 0, `${ref}: /metrics exports ${name}`);
    // Only equality matchers pin a value (code!~"5.." excludes, {route,method} names).
    for (const [pair] of matchers.matchAll(/[a-z_]+="[^"]*"/g)) {
      assert.ok(
        series.some((l) => l.includes(pair)),
        `${ref}: some ${name} series carries ${pair}`
      );
    }
  }
});

test('/metrics carries no Node.js process metrics, only the JagHelm families (#259)', async () => {
  metrics.recordRefreshCycle(50, false); // the refresh error counter stays
  const text = await metrics.register.metrics();
  const families = [...text.matchAll(/^# TYPE (\S+) /gm)].map((m) => m[1]).sort();
  assert.deepEqual(families, [
    'http_request_duration_seconds',
    'http_requests_total',
    'jaghelm_auth_failures_total',
    'jaghelm_cache_age_seconds',
    'jaghelm_refresh_cycle_duration_seconds',
    'jaghelm_refresh_errors_total',
    'jaghelm_refresh_last_success_timestamp_seconds',
  ]);
  assert.doesNotMatch(text, /^(process|nodejs)_/m);
});
