/**
 * One TLS certificate read (#676), against real local TLS servers presenting
 * certificates made in the test (testing/selfSignedCert.js): a good one, an
 * expired one and a self-signed one are all READ; a closed port, a plain-text
 * port and a stalled handshake are told apart; and the network setting refuses
 * private targets (and the metadata address always) before any socket opens.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';

import { probeTls, tidyName } from './tlsExpiry.js';
import { makeCert } from './testing/selfSignedCert.js';

const DAY = 86_400_000;
const servers = [];
after(() => servers.forEach((s) => s.close()));

/** A TLS server presenting a certificate ending `endsInDays` from now; records bytes clients send. */
async function tlsServer({ endsInDays, issuerCn, cn }) {
  const now = Date.now();
  const creds = makeCert({
    cn,
    issuerCn,
    notBefore: new Date(now - 400 * DAY),
    notAfter: new Date(now + endsInDays * DAY),
  });
  const seen = { servernames: [], bytes: 0 };
  const server = tls.createServer({ ...creds, SNICallback: (name, cb) => {
    seen.servernames.push(name);
    cb(null, tls.createSecureContext(creds));
  } }, (socket) => {
    socket.on('data', (d) => {
      seen.bytes += d.length;
    });
    socket.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return { port: server.address().port, seen, server };
}

const target = (port) => `127.0.0.1:${port}`;

test('a valid certificate: its end date and issuer, with nothing sent beyond the handshake', async () => {
  const s = await tlsServer({ endsInDays: 90, issuerCn: 'Test Issuing CA', cn: 'svc.test' });
  const r = await probeTls(target(s.port));
  assert.equal(r.state, 'ok');
  const days = (Date.parse(r.notAfter) - Date.now()) / DAY;
  assert.ok(days > 89 && days < 91, String(days));
  assert.equal(r.issuer, 'Test Issuing CA');
  await new Promise((r2) => setTimeout(r2, 50));
  assert.equal(s.seen.bytes, 0, 'no application data was sent');
});

test('an expired certificate is still read and reported as expired, with how long ago', async () => {
  const s = await tlsServer({ endsInDays: -3, issuerCn: 'Old CA', cn: 'svc.test' });
  const r = await probeTls(target(s.port));
  assert.equal(r.state, 'expired');
  assert.ok(Date.parse(r.notAfter) < Date.now());
  assert.equal(r.issuer, 'Old CA');
});

test('a self-signed certificate is read, not refused for being untrusted', async () => {
  const s = await tlsServer({ endsInDays: 30, cn: 'self.test' });
  const r = await probeTls(target(s.port));
  assert.equal(r.state, 'ok');
  assert.equal(r.issuer, 'self.test');
});

test('a name is sent as the server name (SNI); an IP address is not', async () => {
  const s = await tlsServer({ endsInDays: 30, cn: 'sni.test' });
  const r = await probeTls(`sni.test:${s.port}`, { lookup: async () => '127.0.0.1' });
  assert.equal(r.state, 'ok');
  assert.ok(s.seen.servernames.includes('sni.test'), JSON.stringify(s.seen.servernames));
  const before = s.seen.servernames.length;
  await probeTls(target(s.port));
  assert.equal(s.seen.servernames.length, before, 'an IP address sends no server name');
});

test('a port nothing listens on is unreachable', async () => {
  const closed = net.createServer();
  await new Promise((r) => closed.listen(0, '127.0.0.1', r));
  const { port } = closed.address();
  await new Promise((r) => closed.close(r));
  const r = await probeTls(target(port));
  assert.equal(r.state, 'unreachable');
  assert.equal(r.code, 'ECONNREFUSED');
  assert.equal(r.notAfter, null);
});

test('a name that does not resolve is unreachable', async () => {
  const r = await probeTls('gone.test', {
    lookup: async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND gone.test'), { code: 'ENOTFOUND' });
    },
  });
  assert.equal(r.state, 'unreachable');
  assert.equal(r.code, 'ENOTFOUND');
});

test('a port that connects but does not speak TLS is a failed handshake', async () => {
  const plain = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  await new Promise((r) => plain.listen(0, '127.0.0.1', r));
  servers.push(plain);
  const r = await probeTls(target(plain.address().port));
  assert.equal(r.state, 'handshake_failed');
});

test('a handshake that stalls is cut at the timeout and called a failed handshake', async () => {
  const sockets = [];
  const silent = net.createServer((socket) => {
    sockets.push(socket);
    socket.on('error', () => {});
  });
  await new Promise((r) => silent.listen(0, '127.0.0.1', r));
  servers.push(silent);
  const started = Date.now();
  const r = await probeTls(target(silent.address().port), { timeoutMs: 150 });
  sockets.forEach((s) => s.destroy());
  assert.equal(r.state, 'handshake_failed');
  assert.equal(r.code, 'ETIMEDOUT');
  assert.ok(Date.now() - started < 2000);
});

test('an issuer name is one short line: control characters out, long names cut', async () => {
  assert.equal(tidyName(`Evil\nCA${String.fromCharCode(0, 0x202e)} x`), 'Evil CA x');
  assert.equal(tidyName(['First', 'Second']), 'First');
  assert.equal(tidyName('   '), null);
  assert.equal(tidyName(42), null);
  assert.ok(tidyName('x'.repeat(200)).length <= 60);
});

test('the network setting refuses private, loopback and name-resolves-to-private targets; the metadata address is always refused', async () => {
  const s = await tlsServer({ endsInDays: 30, cn: 'p.test' });
  const strict = process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS;
  try {
    // Off (the default): a private address is a fine target on a homelab.
    delete process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS;
    assert.equal((await probeTls(target(s.port))).state, 'ok');
    assert.equal((await probeTls('169.254.169.254')).state, 'blocked');

    process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS = 'true';
    for (const t of [target(s.port), '192.168.68.11', '10.0.0.5:8443', '[::1]', '[fd00::1]', 'localhost']) {
      assert.equal((await probeTls(t)).state, 'blocked', t);
    }
    // A public-looking name that resolves to a private address, at connect time.
    let connected = false;
    const r = await probeTls('looks-public.example', {
      lookup: async () => '10.1.2.3',
      connect: () => {
        connected = true;
        throw new Error('must not connect');
      },
    });
    assert.equal(r.state, 'blocked');
    assert.equal(connected, false, 'no socket was opened');
  } finally {
    if (strict === undefined) delete process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS;
    else process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS = strict;
  }
});

test('a target that is not a host and port is blocked, never connected to', async () => {
  let connected = false;
  const r = await probeTls('https://evil.example/x', {
    connect: () => {
      connected = true;
      throw new Error('no');
    },
  });
  assert.equal(r.state, 'blocked');
  assert.equal(connected, false);
});
