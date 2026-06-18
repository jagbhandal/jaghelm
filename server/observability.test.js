/**
 * Observability unit tests — the structured logger's output contract and the
 * Prometheus metrics layer (names must match docs/slos/* so the SLO queries
 * resolve).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

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
  const res = { statusCode: 200, on: (ev, cb) => (handlers[ev] = cb) };
  metrics.metricsMiddleware(req, res, () => {});
  handlers.finish();

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
