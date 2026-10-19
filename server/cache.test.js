/**
 * cache.js ETag contract (#251): the body and ETag of a warm-cached endpoint are
 * computed once per setCache, not per request, and If-None-Match is evaluated per
 * RFC 9110 (weak comparison, a list of tags, `*`).
 *
 * The counters spy on JSON.stringify and crypto.createHash. cache.js calls
 * crypto.createHash through the default import, so the spy sees it.
 */
import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';

import { getCached, setCache, respondWarmCached } from './cache.js';

afterEach(() => mock.restoreAll());

const etagOf = (data) => `"${crypto.createHash('md5').update(JSON.stringify(data)).digest('hex')}"`;

// The module-level cache is shared by every test here, so each test uses its own key.
let seq = 0;
const freshKey = () => `cache-test-${++seq}`;

/** A one-route app that serves `key` the way the warm-cached routes do. */
function appFor(key, { refresh = async () => null } = {}) {
  const app = express();
  app.disable('etag'); // as in index.js: cache.js owns ETags
  app.get('/x', (req, res, next) =>
    respondWarmCached(req, res, {
      key,
      refresh,
      fallback: (r) => r.status(503).json({ error: 'not yet available' }),
    }).catch(next)
  );
  return app;
}

/** Count the serializations of `payload` and every hash taken from now on. */
function countWork(payload) {
  const stringify = mock.method(JSON, 'stringify');
  const createHash = mock.method(crypto, 'createHash');
  return {
    serialized: () => stringify.mock.calls.filter((c) => c.arguments[0] === payload).length,
    hashed: () => createHash.mock.calls.length,
  };
}

const sample = (n) => ({
  nodes: { a: { services: [{ name: `svc-${n}`, status: 'up' }] } },
  overallHealth: 'up',
});

test('a cached value is served as JSON with a strong ETag of its body', async () => {
  const key = freshKey();
  const payload = sample(1);
  setCache(key, payload);

  const r = await request(appFor(key)).get('/x');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /^application\/json; charset=utf-8$/);
  assert.equal(r.headers.etag, etagOf(payload));
  assert.deepEqual(r.body, payload);
});

test('If-None-Match with the current ETag gets a 304 with no body, still carrying the ETag', async () => {
  const key = freshKey();
  const payload = sample(2);
  setCache(key, payload);
  const app = appFor(key);
  const { headers } = await request(app).get('/x');

  const r = await request(app).get('/x').set('If-None-Match', headers.etag);
  assert.equal(r.status, 304);
  assert.equal(r.text, '');
  assert.equal(r.headers.etag, headers.etag, 'RFC 9110 §15.4.5: a 304 sends the ETag a 200 would');
});

test('the body and ETag are computed once per setCache, not per request', async () => {
  const key = freshKey();
  const app = appFor(key);
  setCache(key, sample(3));
  const first = await request(app).get('/x');

  const payload = sample(4);
  const expected = etagOf(payload); // before the counters start: etagOf hashes too
  const work = countWork(payload);
  setCache(key, payload);
  assert.equal(work.serialized(), 1, 'a served key is serialized when it is written');
  assert.equal(work.hashed(), 1, 'a served key is hashed when it is written');

  const plain1 = await request(app).get('/x');
  const plain2 = await request(app).get('/x');
  const cond1 = await request(app).get('/x').set('If-None-Match', plain1.headers.etag);
  const cond2 = await request(app).get('/x').set('If-None-Match', plain1.headers.etag);

  assert.deepEqual(
    [plain1.status, plain2.status, cond1.status, cond2.status],
    [200, 200, 304, 304]
  );
  assert.deepEqual(plain1.body, payload);
  assert.equal(plain1.headers.etag, expected);
  assert.notEqual(plain1.headers.etag, first.headers.etag, 'a new value gets a new ETag');
  assert.equal(work.serialized(), 1, 'no request serialized the payload');
  assert.equal(work.hashed(), 1, 'no request hashed the payload');

  const stale = await request(app).get('/x').set('If-None-Match', first.headers.etag);
  assert.equal(stale.status, 200, "the previous value's ETag no longer matches");
  assert.deepEqual(stale.body, payload);
});

test('a 304 does no serialization or hashing', async () => {
  const key = freshKey();
  const app = appFor(key);
  const payload = sample(5);
  setCache(key, payload);
  const { headers } = await request(app).get('/x');

  const work = countWork(payload);
  for (const inm of [headers.etag, `W/${headers.etag}`, `"other", ${headers.etag}`, '*']) {
    const r = await request(app).get('/x').set('If-None-Match', inm);
    assert.equal(r.status, 304, inm);
  }
  assert.equal(work.serialized(), 0);
  assert.equal(work.hashed(), 0);
});

test('If-None-Match uses weak comparison over a list of tags, and * matches', async () => {
  const key = freshKey();
  const payload = sample(6);
  setCache(key, payload);
  const app = appFor(key);
  const etag = etagOf(payload);

  const cases = [
    [etag, 304],
    [`W/${etag}`, 304],
    [`"other", ${etag}`, 304],
    [`"a",W/${etag} , "b"`, 304],
    ['*', 304],
    [' * ', 304],
    ['"nope"', 200],
    ['W/"nope"', 200],
    [etag.slice(1, -1), 200], // an unquoted tag is not an entity-tag
    ['', 200],
  ];
  // The browser adds `Cache-Control: no-cache` to every fetch that sets its own
  // If-None-Match (useData.js does), so a match must not depend on that header.
  for (const cacheControl of [null, 'no-cache']) {
    for (const [inm, status] of cases) {
      const req = request(app).get('/x').set('If-None-Match', inm);
      if (cacheControl) req.set('Cache-Control', cacheControl);
      const r = await req;
      assert.equal(r.status, status, `If-None-Match: ${inm} / Cache-Control: ${cacheControl}`);
      assert.equal(r.headers.etag, etag);
      if (status === 200) assert.deepEqual(r.body, payload);
    }
  }
});

test('HEAD gets the ETag and length without a body, and a 304 on a match', async () => {
  const key = freshKey();
  const payload = sample(7);
  setCache(key, payload);
  const app = appFor(key);

  const head = await request(app).head('/x');
  assert.equal(head.status, 200);
  assert.equal(head.headers.etag, etagOf(payload));
  assert.equal(Number(head.headers['content-length']), Buffer.byteLength(JSON.stringify(payload)));
  assert.ok(!head.text, 'no body on HEAD');

  const cond = await request(app).head('/x').set('If-None-Match', head.headers.etag);
  assert.equal(cond.status, 304);
});

test('a cold start serves the refresh result and later requests reuse its ETag', async () => {
  const key = freshKey();
  const payload = sample(8);
  let refreshes = 0;
  const app = appFor(key, {
    refresh: async () => {
      refreshes += 1;
      setCache(key, payload); // what the refresh.js functions do before returning
      return payload;
    },
  });

  const expected = etagOf(payload); // before the counters start: etagOf hashes too
  const work = countWork(payload);
  const cold = await request(app).get('/x');
  assert.equal(cold.status, 200);
  assert.deepEqual(cold.body, payload);
  assert.equal(cold.headers.etag, expected);

  const warm = await request(app).get('/x').set('If-None-Match', cold.headers.etag);
  assert.equal(warm.status, 304);
  assert.equal(refreshes, 1, 'the second request was served from the cache');
  assert.equal(work.hashed(), 1, 'one hash for the one value');
  assert.equal(work.serialized(), 1);
});

test('a refresh result that was not cached still gets a correct ETag', async () => {
  const key = freshKey();
  const app = appFor(key, { refresh: async () => sample(9) });

  const r = await request(app).get('/x');
  assert.equal(r.status, 200);
  assert.equal(r.headers.etag, etagOf(sample(9)));
  assert.deepEqual(r.body, sample(9));

  const cond = await request(app).get('/x').set('If-None-Match', r.headers.etag);
  assert.equal(cond.status, 304);
});

test('neither cache nor refresh has data: the fallback answers', async () => {
  const r = await request(appFor(freshKey())).get('/x');
  assert.equal(r.status, 503);
  assert.deepEqual(r.body, { error: 'not yet available' });
});

test('setCache on a key no route serves with an ETag does no serialization', () => {
  const payload = sample(10);
  const work = countWork(payload);
  setCache(freshKey(), payload); // e.g. prom-<q>, weather-<lat>-<lon>: served with res.json
  assert.equal(work.serialized(), 0);
  assert.equal(work.hashed(), 0);
});

test('a key the refresh loop rewrites is never the one evicted', () => {
  // Assert after every one-off key, BEFORE the periodic rewrite: checking only
  // after a rewrite would re-add the key and hide its eviction.
  const warm = freshKey();
  setCache(warm, { v: 0 });
  for (let i = 1; i <= 1000; i++) {
    setCache(freshKey(), { i }); // one-off keys (prom-<q>, weather-<lat>-<lon>)
    assert.notEqual(getCached(warm), null, `evicted after ${i} one-off keys`);
    if (i % 100 === 0) setCache(warm, { v: i }); // a refresh cycle
  }
});
