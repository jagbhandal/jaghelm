/**
 * #375: safeFetch hands its TLS-skip Agent, from the undici package, to Node's
 * built-in fetch, which runs on the undici bundled with Node. The dispatcher API
 * changes between undici majors, so an Agent from another major fails every
 * request with "fetch failed" (undici 6's Agent under Node 26's undici 8:
 * "invalid onError method"). That broke every Proxmox request, the one preset with
 * tlsSkip. Bump the undici dependency together with Node.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

// The TLS-skip Agent's one job is `connect: { rejectUnauthorized: false }`. These
// run it against a self-signed certificate, so an undici bump that renames or
// ignores that option (undici 8 already adds a separate `tls` one) fails here
// instead of failing every Proxmox request. The certificate is made at run time
// with openssl, so no private key is committed (scripts/secret_rules.py flags one).
// openssl is in the node:26 image (Gitea check.yml) and on ubuntu-latest (GitHub);
// without it these tests fail rather than skip.
describe('over HTTPS with a self-signed certificate', () => {
  let tlsDir;
  let tlsServer;
  let tlsUrl;

  before(async () => {
    tlsDir = mkdtempSync(path.join(tmpdir(), 'http-test-tls-'));
    const keyFile = path.join(tlsDir, 'key.pem');
    const certFile = path.join(tlsDir, 'cert.pem');
    const r = spawnSync(
      'openssl',
      ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-days', '1',
        '-keyout', keyFile, '-out', certFile],
      { encoding: 'utf8' }
    );
    if (r.error?.code === 'ENOENT') {
      throw new Error(
        'openssl is not on PATH: these tests make a throwaway self-signed certificate with it. Install openssl.'
      );
    }
    if (r.error || r.status !== 0) {
      throw new Error(`openssl could not make a self-signed certificate: ${r.error?.message ?? r.stderr}`);
    }
    tlsServer = https.createServer(
      { key: readFileSync(keyFile), cert: readFileSync(certFile) },
      (req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end('{"ok":true}');
      }
    );
    await new Promise((resolve) => tlsServer.listen(0, '127.0.0.1', resolve));
    tlsUrl = `https://127.0.0.1:${tlsServer.address().port}/api2/json/version`;
  });

  after(() => {
    tlsServer?.closeAllConnections();
    tlsServer?.close();
    if (tlsDir) rmSync(tlsDir, { recursive: true, force: true });
  });

  // safeFetch rethrows only the message ("fetch failed"), so this reads the TLS
  // error code off what Node's fetch threw underneath it.
  async function refusalCode(request) {
    const realFetch = globalThis.fetch;
    let cause;
    globalThis.fetch = (...args) =>
      realFetch(...args).catch((err) => {
        cause = err?.cause;
        throw err;
      });
    try {
      await assert.rejects(request(), /fetch failed/);
    } finally {
      globalThis.fetch = realFetch;
    }
    return cause?.code;
  }

  test('a request through the TLS-skip Agent accepts the certificate', async () => {
    const res = await safeFetch(tlsUrl, {}, true);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });

  test('a request on the default dispatcher refuses the certificate', async () => {
    assert.equal(await refusalCode(() => safeFetch(tlsUrl, {}, false)), 'DEPTH_ZERO_SELF_SIGNED_CERT');
  });

  test('a request on the default dispatcher still refuses it right after a TLS-skip request', async () => {
    const res = await safeFetch(tlsUrl, {}, true);
    assert.equal(res.status, 200);
    await res.arrayBuffer();
    assert.equal(await refusalCode(() => safeFetch(tlsUrl, {}, false)), 'DEPTH_ZERO_SELF_SIGNED_CERT');
  });
});
