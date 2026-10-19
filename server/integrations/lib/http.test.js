/**
 * #375: safeFetch hands its TLS-skip Agent, from the undici package, to Node's
 * built-in fetch, which runs on the undici bundled with Node. The dispatcher API
 * changes between undici majors, so an Agent from another major fails every
 * request with "fetch failed" (undici 6's Agent under Node 26's undici 8:
 * "invalid onError method"). That broke every Proxmox request, the one preset with
 * tlsSkip. Bump the undici dependency together with Node.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { safeFetch } from './http.js';

const require = createRequire(import.meta.url);
const major = (v) => Number(String(v).split('.')[0]);

test("the undici package is the same major as the undici in Node's fetch", () => {
  const pkg = require('undici/package.json').version;
  assert.equal(
    major(pkg),
    major(process.versions.undici),
    `undici ${pkg} in package.json, but Node ${process.version} bundles undici ${process.versions.undici}`
  );
});

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end('{"ok":true}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
after(() => server.close());
const url = `http://127.0.0.1:${server.address().port}/api2/json/version`;

test('a request through the TLS-skip Agent reaches the server', async () => {
  const res = await safeFetch(url, {}, true);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('a request on the default dispatcher reaches the server', async () => {
  const res = await safeFetch(url, {}, false);
  assert.equal(res.status, 200);
});
