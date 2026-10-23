/**
 * A source that fails says why in words, end to end (#605): the real
 * Prometheus and Kuma readers against a stubbed fetch that fails the way
 * Node's fetch does (the reason, with its errno code, address and port, as
 * the error's cause), the real services refresh into the real cache, then
 * the status model, push and the alert history as the background loop runs
 * them. `/api/status` (a source's `error`, its issue's `reason`), the push
 * a phone is sent, and the `/api/events` record each say the sentence, never
 * the raw error; the raw detail goes to the server log, once per failure
 * state; and a raw error that changes every cycle (a port) leaves the status,
 * and its ETag, as they were.
 *
 * Tests share module state (the cache, the readers' health logs) and run in
 * order; each starts its own push pipeline.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

const { initDiscovery } = await import('./discovery.js');
const { initMonitors } = await import('./monitors.js');
const { saveConfig } = await import('./config.js');
const { getCached, getCachedInternal, setCache } = await import('./cache.js');
const { refreshServices, refreshUPS } = await import('./refresh.js');
const { pushPipeline } = await import('./testing/pushPipeline.js');
const { statusRoutes } = await import('./routes/status.js');
const { buildMessage } = await import('./push/fcm.js');
const { RAW_DETAIL } = await import('./testing/rawDetail.js');

const PROM = 'http://localhost:9996';
const KUMA = 'http://localhost:9997';
initDiscovery(PROM);
initMonitors(KUMA);
saveConfig({ nodes: { vm103: { display_name: 'VM 103' } }, services: {} });

const EVAL = 1_700_000_000;

/** What Node's fetch rejects with when the connection fails: "fetch failed", the reason as its cause. */
const fetchFailed = (code, message) =>
  new TypeError('fetch failed', { cause: Object.assign(new Error(message), { code }) });

// How each upstream answers this cycle: 'ok', or a function that throws or answers as it fails.
const world = { prometheus: 'ok', kuma: 'ok' };

const json = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  body: null,
  json: async () => body,
  text: async () => JSON.stringify(body),
});
const vector = (result) => json(200, { status: 'success', data: { resultType: 'vector', result } });

function promAnswer(url) {
  if (world.prometheus !== 'ok') return world.prometheus(url);
  if (url.includes('/api/v1/targets'))
    return json(200, { status: 'success', data: { activeTargets: [] } });
  if (decodeURIComponent(url).includes('up{'))
    return vector([{ metric: { node: 'vm103' }, value: [EVAL, '1'] }]);
  return vector([]);
}

function kumaAnswer() {
  if (world.kuma !== 'ok') return world.kuma();
  return json(200, {
    publicGroupList: [{ monitorList: [{ id: 1, name: 'gitea' }] }],
    heartbeatList: { 1: [{ status: 1, ping: 5 }] },
    uptimeList: {},
  });
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith(PROM)) return promAnswer(u);
  if (u.startsWith(KUMA)) return kumaAnswer();
  throw new Error(`unexpected fetch ${u}`);
};
process.on('exit', () => {
  globalThis.fetch = realFetch;
});

const caches = { getCached, getCachedInternal, getAllCronStatuses: () => [] };

/** A push pipeline whose cycles run the real refreshes first, as the loop does. */
function pipeline() {
  const p = pushPipeline({ env: { KUMA_URL: KUMA } });
  return Object.assign(p, {
    async run() {
      await Promise.all([refreshServices(), refreshUPS()]);
      return p.cycle(caches);
    },
  });
}

// /api/status as a client polls it: the status the loop cached, through the route.
const app = express().use('/api/status', statusRoutes);
async function poll(status, etag) {
  setCache('status', status);
  const r = request(app).get('/api/status');
  return etag ? r.set('If-None-Match', etag) : r;
}

// Collect the structured logger's JSON lines while `fn` runs (logNoise.test.js).
async function captureLogs(fn) {
  const lines = [];
  const orig = { out: process.stdout.write, err: process.stderr.write };
  const tap = (write) =>
    function (chunk, ...rest) {
      try {
        const obj = JSON.parse(String(chunk));
        if (obj && obj.module && obj.level) {
          lines.push(obj);
          return true;
        }
      } catch {
        // not one of ours
      }
      return write.call(this, chunk, ...rest);
    };
  process.stdout.write = tap(orig.out);
  process.stderr.write = tap(orig.err);
  try {
    await fn();
  } finally {
    process.stdout.write = orig.out;
    process.stderr.write = orig.err;
  }
  return lines;
}

/** Each client field a source's failure reaches: the status, the pushes as sent, the history's records. */
function clientFields(p) {
  return {
    status: JSON.stringify(p.status),
    pushes: JSON.stringify(p.events.map((event) => buildMessage('phone', event))),
    history: JSON.stringify(p.snapshot.events({}).events),
  };
}

const refusing = (port) => () => {
  throw fetchFailed('ECONNREFUSED', `connect ECONNREFUSED 10.0.0.9:${port}`);
};

test('Prometheus refusing the connection: the status, the push and the history say so in words', async () => {
  world.prometheus = 'ok';
  world.kuma = 'ok';
  const p = pipeline();
  try {
    await p.run(); // every source answering
    world.prometheus = refusing(9090);
    await p.run();
    await p.run();

    const words = 'Prometheus refused the connection';
    assert.equal(p.status.sources.prometheus.error, words);
    const issue = p.status.issues.find((i) => i.id === 'sources/prometheus');
    assert.equal(issue.reason, words);
    const down = p.events.find((e) => e.type === 'source_down');
    assert.deepEqual([down.body, down.reason], [`Prometheus · ${words}`, words]);
    const record = p.snapshot.events({}).events.find((e) => e.type === 'source_down');
    assert.deepEqual([record.body, record.reason], [`Prometheus · ${words}`, words]);

    const served = await poll(p.status);
    assert.equal(served.status, 200);
    assert.equal(served.body.sources.prometheus.error, words);
    for (const [field, text] of Object.entries({
      ...clientFields(p),
      served: JSON.stringify(served.body),
    })) {
      assert.doesNotMatch(text, RAW_DETAIL, `${field} carries no raw error`);
    }
  } finally {
    p.close();
  }
});

test('a raw error that changes every cycle (a port) leaves the status, and its ETag, as they were', async () => {
  world.prometheus = 'ok';
  const p = pipeline();
  try {
    await p.run();
    world.prometheus = refusing(9090);
    await p.run();
    const first = await poll(p.status);
    world.prometheus = refusing(9091);
    await p.run();
    const again = await poll(p.status, first.headers.etag);
    assert.equal(again.status, 304, 'the same status, so the same ETag');
  } finally {
    p.close();
  }
});

test('Kuma failing its TLS handshake, then answering 401: each cause its own sentence', async () => {
  world.prometheus = 'ok';
  world.kuma = 'ok';
  const p = pipeline();
  try {
    await p.run();
    world.kuma = () => {
      throw fetchFailed('CERT_HAS_EXPIRED', 'certificate has expired for kuma.lan.example');
    };
    await p.run();
    await p.run();
    assert.equal(p.status.sources.kuma.error, "Kuma's TLS connection failed");
    assert.equal(
      p.events.find((e) => e.type === 'source_down').body,
      "Kuma · Kuma's TLS connection failed"
    );

    world.kuma = () => json(401, { msg: 'Unauthorized' });
    await p.run();
    assert.equal(p.status.sources.kuma.error, 'Kuma refused the credentials');
    for (const [field, text] of Object.entries(clientFields(p))) {
      assert.doesNotMatch(text, RAW_DETAIL, `${field} carries no raw error`);
    }
  } finally {
    world.kuma = 'ok';
    p.close();
  }
});

test('the raw detail is logged once per failure state: when it starts, when its cause changes, and once back', async () => {
  world.prometheus = 'ok';
  world.kuma = 'ok';
  const p = pipeline();
  try {
    await p.run();
    const lines = await captureLogs(async () => {
      world.prometheus = refusing(9090);
      await p.run();
      await p.run();
      world.prometheus = refusing(9091); // the same cause: nothing more
      await p.run();
      world.prometheus = () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      };
      await p.run();
      await p.run();
      world.prometheus = 'ok';
      await p.run();
    });
    const prom = lines.filter(
      (l) => l.source === 'prometheus' && ['warn', 'info'].includes(l.level)
    );
    assert.deepEqual(
      prom.map((l) => [l.level, l.msg, l.words ?? null]),
      [
        [
          'warn',
          'data source failed; push alerts keep its last known state until it recovers',
          'Prometheus refused the connection',
        ],
        ['warn', 'data source failing for another reason', "Prometheus didn't answer in time"],
        ['info', 'data source recovered', null],
      ]
    );
    assert.match(prom[0].error, /ECONNREFUSED 10\.0\.0\.9:9090/, 'the raw detail, in the log');
    assert.match(prom[1].error, /timeout/);
  } finally {
    world.prometheus = 'ok';
    p.close();
  }
});
