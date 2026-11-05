/**
 * Prometheus reads go as a POST with the query in the body, never in the URL.
 * NOT_JOB carries the Docker random-name alternation (several KB), and the
 * `reset` events query holds the selector twice: as a GET query string that is
 * a URL past the ~8 KB request-line limit a reverse proxy in front of
 * Prometheus applies (414), which failed the whole events read. A real HTTP
 * server stands in for Prometheus so the request on the wire is what is read.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { eventQueries } from './containerEvents.js';
import { NOT_JOB } from './util/helperContainers.js';

const { initDiscovery, promQuery, promQueryRange, PromQueryError } = await import('./discovery.js');

/** @type {{ method?: string, url?: string, type?: string, body: string }[]} */
const seen = [];
let reply = () => ({ status: 200, body: { status: 'success', data: { resultType: 'vector', result: [] } } });

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, type: req.headers['content-type'], body });
    const { status, body: out } = reply();
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
initDiscovery(`http://127.0.0.1:${server.address().port}`);
after(() => server.close());

const { reset } = eventQueries('node=~"vm-test"', 3600);

test('the reset query is long enough to have broken a GET (twice NOT_JOB)', () => {
  assert.ok(reset.split(NOT_JOB).length === 3, 'the selector is in the query twice');
  assert.ok(encodeURIComponent(reset).length > 8000, `URL-encoded length ${encodeURIComponent(reset).length}`);
});

test('promQuery: the query travels in a form body, the URL stays short', async () => {
  seen.length = 0;
  await promQuery(reset);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url, '/api/v1/query');
  assert.ok(seen[0].url.length < 200, `url is ${seen[0].url.length} chars`);
  assert.equal(seen[0].type, 'application/x-www-form-urlencoded');
  assert.equal(new URLSearchParams(seen[0].body).get('query'), reset);
});

test('promQueryRange: query, start, end and step travel in the body, the URL stays short', async () => {
  seen.length = 0;
  reply = () => ({ status: 200, body: { status: 'success', data: { resultType: 'matrix', result: [] } } });
  await promQueryRange(reset, { start: 100, end: 400, step: 60 });
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url, '/api/v1/query_range');
  assert.ok(seen[0].url.length < 200, `url is ${seen[0].url.length} chars`);
  assert.equal(seen[0].type, 'application/x-www-form-urlencoded');
  const p = new URLSearchParams(seen[0].body);
  assert.deepEqual([p.get('query'), p.get('start'), p.get('end'), p.get('step')], [reset, '100', '400', '60']);
});

test('response parsing is as it was: results returned, an error status rejects, a non-2xx rejects with its status', async () => {
  const result = [{ metric: { node: 'vm-test', name: 'a' }, value: [1, '1'] }];
  reply = () => ({ status: 200, body: { status: 'success', data: { resultType: 'vector', result } } });
  assert.deepEqual(await promQuery(reset), result);

  reply = () => ({ status: 200, body: { status: 'error', error: 'bad' } });
  await assert.rejects(promQuery('up'), (err) => err instanceof PromQueryError && err.failure === 'rejected');

  reply = () => ({ status: 503, body: {} });
  await assert.rejects(promQuery('up'), (err) => err instanceof PromQueryError && err.status === 503);
});
