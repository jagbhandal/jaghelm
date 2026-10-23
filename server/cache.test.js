/**
 * cache.js ETag contract (#251): the body and ETag of a warm-cached endpoint are
 * computed once per cached value, on its first request, not per request, and
 * If-None-Match is evaluated per RFC 9110 (weak comparison, a list of tags, `*`).
 *
 * The counters spy on JSON.stringify and crypto.createHash. cache.js calls
 * crypto.createHash through the default import, so the spy sees it.
 */
import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';

import { getCached, ifNoneMatchHits, jsonWithEtag, setCache, respondWarmCached } from './cache.js';

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

test('the body and ETag are computed once per setCache, on the first request', async () => {
  const key = freshKey();
  const app = appFor(key);
  setCache(key, sample(3));
  const first = await request(app).get('/x');

  const payload = sample(4);
  const expected = etagOf(payload); // before the counters start: etagOf hashes too
  const work = countWork(payload);
  setCache(key, payload);
  assert.equal(work.serialized(), 0, 'setCache does not serialize');
  assert.equal(work.hashed(), 0, 'setCache does not hash');

  const plain1 = await request(app).get('/x');
  assert.equal(work.serialized(), 1, 'the first request serializes the new value');
  assert.equal(work.hashed(), 1, 'the first request hashes the new value');
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
  assert.equal(work.serialized(), 1, 'no later request serialized the payload');
  assert.equal(work.hashed(), 1, 'no later request hashed the payload');

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

test('a value nobody requests is never serialized', () => {
  const payload = sample(10);
  const work = countWork(payload);
  setCache(freshKey(), payload); // a refresh cycle with no dashboard open, or weather-<lat>-<lon> (res.json)
  assert.equal(work.serialized(), 0);
  assert.equal(work.hashed(), 0);
});

test('a key the refresh loop rewrites is never the one evicted', () => {
  // Assert after every one-off key, BEFORE the periodic rewrite: checking only
  // after a rewrite would re-add the key and hide its eviction.
  const warm = freshKey();
  setCache(warm, { v: 0 });
  for (let i = 1; i <= 1000; i++) {
    setCache(freshKey(), { i }); // one-off keys (weather-<lat>-<lon>)
    assert.notEqual(getCached(warm), null, `evicted after ${i} one-off keys`);
    if (i % 100 === 0) setCache(warm, { v: i }); // a refresh cycle
  }
});

test('an entry lives 120 s by default, or the TTL it was written with', () => {
  const realNow = Date.now;
  const t0 = realNow();
  try {
    Date.now = () => t0;
    const plain = freshKey();
    const long = freshKey();
    setCache(plain, { a: 1 });
    setCache(long, { b: 2 }, null, { ttlMs: 600_000 });
    Date.now = () => t0 + 119_000;
    assert.deepEqual([getCached(plain), getCached(long)], [{ a: 1 }, { b: 2 }]);
    Date.now = () => t0 + 121_000;
    assert.deepEqual([getCached(plain), getCached(long)], [null, { b: 2 }]);
    Date.now = () => t0 + 600_001;
    assert.equal(getCached(long), null);
  } finally {
    Date.now = realNow;
  }
});

// #499: the status's build time rides beside its ETag, as Last-Modified, for
// the routes that ask. It is a header, so the ETag stays one per value.
test('with lastModified, a cached value is sent with its entry time as Last-Modified, on the 200 and the 304', async () => {
  const key = freshKey();
  const app = express();
  app.disable('etag');
  app.get('/x', (req, res) => jsonWithEtag(res, req, key, getCached(key), { lastModified: true }));
  const realNow = Date.now;
  // An HTTP date counts whole seconds: the entry's 750 ms are dropped.
  const t0 = Math.floor(realNow() / 1000) * 1000 - 10_000;
  try {
    Date.now = () => t0 + 750;
    setCache(key, sample(9));
  } finally {
    Date.now = realNow;
  }
  const first = await request(app).get('/x');
  assert.equal(first.status, 200);
  assert.equal(first.headers['last-modified'], new Date(t0).toUTCString());

  // The same value stored again later (the next cycle): a later time, the same ETag.
  try {
    Date.now = () => t0 + 5_000;
    setCache(key, sample(9));
  } finally {
    Date.now = realNow;
  }
  const cond = await request(app).get('/x').set('If-None-Match', first.headers.etag);
  assert.equal(cond.status, 304);
  assert.equal(cond.headers.etag, first.headers.etag);
  assert.equal(Date.parse(cond.headers['last-modified']), t0 + 5_000);
});

test('without lastModified (every other route), no Last-Modified; nor for a value not the cached one', async () => {
  const key = freshKey();
  setCache(key, sample(10));
  const plain = await request(appFor(key)).get('/x');
  assert.equal(plain.status, 200);
  assert.equal(plain.headers['last-modified'], undefined);

  const app = express();
  app.disable('etag');
  app.get('/x', (req, res) => jsonWithEtag(res, req, key, sample(10), { lastModified: true }));
  const other = await request(app).get('/x');
  assert.equal(other.status, 200);
  assert.equal(other.headers['last-modified'], undefined, 'no entry time to vouch for it');
});

// #586: a value whose ETag is computed from a part of it (the status, less the
// UPS readings that drift): a weak ETag of that part, the body as stored.
test('with etagOf, the ETag is a weak one of that part: equal parts, one ETag; the body is the value stored', async () => {
  const key = freshKey();
  const steady = (v) => ({ ...v, drift: undefined });
  const app = express();
  app.disable('etag');
  app.get('/x', (req, res) => jsonWithEtag(res, req, key, getCached(key)));

  setCache(key, { state: 'ok', drift: 20 }, null, { etagOf: steady });
  const first = await request(app).get('/x');
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { state: 'ok', drift: 20 });
  assert.equal(first.headers.etag, `W/${etagOf(steady({ state: 'ok', drift: 20 }))}`);

  // Only the drifting part moves: the same ETag, a 304 to its holder, the new body to anyone else.
  setCache(key, { state: 'ok', drift: 23 }, null, { etagOf: steady });
  const cond = await request(app).get('/x').set('If-None-Match', first.headers.etag);
  assert.equal(cond.status, 304);
  const full = await request(app).get('/x');
  assert.equal(full.headers.etag, first.headers.etag);
  assert.deepEqual(full.body, { state: 'ok', drift: 23 });

  // The part moves: a new ETag.
  setCache(key, { state: 'warn', drift: 23 }, null, { etagOf: steady });
  const moved = await request(app).get('/x').set('If-None-Match', first.headers.etag);
  assert.equal(moved.status, 200);
  assert.notEqual(moved.headers.etag, first.headers.etag);
});

test('a weak ETag matches its tag with or without W/, as RFC 9110 compares them for If-None-Match', () => {
  const tag = '"abc"';
  for (const header of [`W/${tag}`, tag, `"x", W/${tag}`, `"x", ${tag}`])
    assert.equal(ifNoneMatchHits(header, `W/${tag}`), true, header);
  assert.equal(ifNoneMatchHits('W/"abd"', `W/${tag}`), false);
});
