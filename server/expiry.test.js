/**
 * The expiry tracker's answer and its route (#676): absent when nothing is set
 * up, soonest first with days worked out now, "checking" until a new target's
 * handshake is in, a failure of one target not touching the others, the
 * Tailscale source folded in (and a rejected key said, never green), the
 * https hosts of the integration URLs offered and not added, and the
 * background check's start, repeat and stop. TLS reads are real handshakes
 * with local servers; the Tailscale API is a stub fetch.
 */
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import tls from 'node:tls';
import express from 'express';
import request from 'supertest';

delete process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS;
delete process.env.JAGHELM_TAILSCALE_API_KEY;
delete process.env.JAGHELM_TAILNET;

const { expiryAnswer, checkTargets, startExpiryChecks, stopExpiryChecks, suggestedTargets, _resetExpiry } =
  await import('./expiry.js');
const { invalidateDisplayConfigCache, stopBackgroundRefresh } = await import('./refresh.js');
const { useUnsavedConfig } = await import('./config.js');
const { _resetTailscale } = await import('./tailscaleExpiry.js');
const { infrastructureRoutes } = await import('./routes/infrastructure.js');
const { makeCert } = await import('./testing/selfSignedCert.js');

const DAY = 86_400_000;
const FILE = join(process.env.JAGHELM_DATA_DIR, 'display-config.json');
const servers = [];
after(() => {
  servers.forEach((s) => s.close());
  _resetExpiry();
  stopBackgroundRefresh();
  rmSync(FILE, { force: true });
});

async function server(endsInDays, issuerCn = 'Test CA') {
  const now = Date.now();
  const creds = makeCert({
    cn: 'x.test',
    issuerCn,
    notBefore: new Date(now - 300 * DAY),
    notAfter: new Date(now + endsInDays * DAY),
  });
  const s = tls.createServer(creds, (c) => c.on('error', () => {}));
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  servers.push(s);
  return `127.0.0.1:${s.address().port}`;
}

function saveTargets(tlsList, extra = {}) {
  writeFileSync(FILE, JSON.stringify({ expiry: { tls: tlsList }, ...extra }));
  invalidateDisplayConfigCache();
}
const settle = async (answer) => {
  // Wait for the background reads a first answer starts.
  for (let i = 0; i < 100; i++) {
    const a = await answer();
    if (!a.items.some((x) => x.state === 'checking')) return a;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('still checking');
};

beforeEach(() => {
  _resetExpiry();
  _resetTailscale();
  delete process.env.JAGHELM_TAILSCALE_API_KEY;
  rmSync(FILE, { force: true });
  invalidateDisplayConfigCache();
  useUnsavedConfig({ nodes: {}, integrations: {} });
});

test('nothing set up: not configured and nothing listed', async () => {
  const a = await expiryAnswer();
  assert.equal(a.configured, false);
  assert.deepEqual(a.items, []);
  assert.equal(a.noExpiry, null);
  assert.deepEqual(a.tailscale, { configured: false });
});

test('TLS targets: soonest first, days worked out now, issuer shown, each as checking until its handshake is in', async () => {
  const [far, soon, gone] = [await server(200, 'Far CA'), await server(5, 'Soon CA'), await server(-2, 'Old CA')];
  saveTargets([far, soon, gone]);
  const first = await expiryAnswer();
  assert.equal(first.configured, true);
  assert.ok(first.items.every((i) => i.state === 'checking' && i.daysLeft === null), 'checking at first');
  const a = await settle(() => expiryAnswer());
  assert.deepEqual(a.items.map((i) => i.name), [gone, soon, far]);
  const byName = Object.fromEntries(a.items.map((i) => [i.name, i]));
  assert.equal(byName[gone].state, 'expired');
  assert.ok(byName[gone].daysLeft <= -1);
  assert.equal(byName[soon].state, 'ok');
  assert.ok([4, 5].includes(byName[soon].daysLeft), String(byName[soon].daysLeft));
  assert.equal(byName[soon].detail, 'Issued by Soon CA');
  assert.equal(byName[soon].source, 'tls');
  // The days move with the clock, not with when the certificate was read.
  const later = await expiryAnswer(Date.now() + 3 * DAY);
  assert.ok([1, 2].includes(later.items.find((i) => i.name === soon).daysLeft));
  const past = await expiryAnswer(Date.now() + 6 * DAY);
  assert.equal(past.items.find((i) => i.name === soon).state, 'expired');
});

test('one target failing leaves the others read, and says which and how', async () => {
  const good = await server(30);
  saveTargets([good, '127.0.0.1:1']);
  const a = await settle(() => expiryAnswer());
  const states = Object.fromEntries(a.items.map((i) => [i.name, i.state]));
  assert.equal(states[good], 'ok');
  assert.equal(states['127.0.0.1:1'], 'unreachable');
  const bad = a.items.find((i) => i.state === 'unreachable');
  assert.equal(bad.daysLeft, null);
  assert.equal(bad.expires, null);
  assert.equal(a.items.at(-1).name, '127.0.0.1:1', 'undated last');
});

test('a target removed in Settings drops out; one added is checked at once', async () => {
  const one = await server(30);
  const two = await server(60);
  saveTargets([one]);
  await settle(() => expiryAnswer());
  saveTargets([one, two]);
  const a = await settle(() => expiryAnswer());
  assert.equal(a.items.length, 2);
  saveTargets([two]);
  assert.deepEqual((await expiryAnswer()).items.map((i) => i.name), [two]);
});

test('a hand-edited list is read as the entries that parse', async () => {
  const ok = await server(30);
  saveTargets([ok, 'https://nope/x', 42, ok, '  ']);
  const a = await settle(() => expiryAnswer());
  assert.deepEqual(a.items.map((i) => i.name), [ok]);
});

test('with the network setting on, a private target is listed as refused, never "ok"', async () => {
  const s = await server(30);
  saveTargets([s]);
  process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS = 'true';
  try {
    const a = await settle(() => expiryAnswer());
    assert.equal(a.items[0].state, 'blocked');
    assert.equal(a.items[0].daysLeft, null);
  } finally {
    delete process.env.JAGHELM_BLOCK_PRIVATE_NETWORKS;
  }
});

test('Tailscale keys join the list; key-expiry-off devices are one line; a rejected key is said and lists nothing', async () => {
  process.env.JAGHELM_TAILSCALE_API_KEY = 'tskey' + '-api-x'; // pragma: allowlist secret
  const soon = new Date(Date.now() + 4 * DAY).toISOString();
  const far = new Date(Date.now() + 80 * DAY).toISOString();
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        devices: [
          { nodeId: 'a', hostname: 'laptop', expires: far },
          { nodeId: 'b', hostname: 'phone', expires: soon },
          { nodeId: 'c', hostname: 'srv1', keyExpiryDisabled: true },
          { nodeId: 'd', hostname: 'srv2', keyExpiryDisabled: true },
          { nodeId: 'e', hostname: 'odd' },
        ],
      })
    );
  const a = await expiryAnswer(Date.now(), { fetchImpl });
  assert.equal(a.configured, true, 'a key alone makes the section exist');
  assert.deepEqual(a.items.map((i) => [i.name, i.source, i.state]), [
    ['phone', 'tailscale', 'ok'],
    ['laptop', 'tailscale', 'ok'],
    ['odd', 'tailscale', 'unknown'],
  ]);
  assert.deepEqual(a.noExpiry, { count: 2, names: ['srv1', 'srv2'] });
  assert.deepEqual(a.tailscale, { configured: true, state: 'ok' });

  _resetTailscale();
  const denied = await expiryAnswer(Date.now(), { fetchImpl: async () => new Response('{}', { status: 401 }) });
  assert.deepEqual(denied.tailscale, { configured: true, state: 'rejected' });
  assert.deepEqual(denied.items, []);
  assert.equal(denied.configured, true);
  assert.ok(!JSON.stringify(denied).includes('tskey'));
});

test('the https hosts of the integration URLs are offered, not added; tracked ones and credentials are left out', async () => {
  useUnsavedConfig({
    nodes: {},
    integrations: {
      a: { type: 'x', url: 'https://nas.example.com' },
      b: { type: 'x', url: 'https://nas.example.com/other/path' },
      c: { type: 'x', url: 'https://git.example.com:8443/api' },
      d: { type: 'x', url: 'http://plain.example.com' },
      e: { type: 'x', url: 'https://user:pw@secret.example.com' },
      f: { type: 'x', url: '$secret:something' },
      g: { type: 'x' },
      h: { type: 'x', url: 'https://tracked.example.com' },
      i: null,
    },
  });
  assert.deepEqual(suggestedTargets(['tracked.example.com']), ['nas.example.com', 'git.example.com:8443']);
  saveTargets(['tracked.example.com']);
  const a = await expiryAnswer();
  assert.deepEqual(a.suggestions, ['nas.example.com', 'git.example.com:8443']);
  assert.deepEqual(a.items.map((i) => i.name), ['tracked.example.com'], 'a suggestion is never tracked on its own');
  assert.equal(a.configured, true);
});

test('suggestions alone do not make the section exist', async () => {
  useUnsavedConfig({ nodes: {}, integrations: { a: { url: 'https://nas.example.com' } } });
  const a = await expiryAnswer();
  assert.equal(a.configured, false);
  assert.deepEqual(a.suggestions, ['nas.example.com']);
});

test('the background check: reads once after the delay, again every period, and stops', async () => {
  const seen = [];
  const probe = async (key) => {
    seen.push(key);
    return { state: 'ok', notAfter: new Date(Date.now() + 30 * DAY).toISOString(), issuer: null, code: null, checkedAt: Date.now() };
  };
  saveTargets(['one.test', 'two.test']);
  startExpiryChecks({ delayMs: 40, everyMs: 120, probe });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(seen.length, 0, 'not at once: after the delay');
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(seen.sort(), ['one.test', 'two.test']);
  await new Promise((r) => setTimeout(r, 160));
  assert.ok(seen.length >= 4, `again after the period (${seen.length})`);
  stopExpiryChecks();
  const n = seen.length;
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(seen.length, n, 'stopped');
});

test('checkTargets bounds its work and survives a probe that throws', async () => {
  let active = 0;
  let peak = 0;
  const probe = async (key) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 10));
    active--;
    if (key === 'boom.test') throw new Error('x');
    return { state: 'ok', notAfter: new Date(Date.now() + DAY).toISOString(), issuer: null, code: null, checkedAt: Date.now() };
  };
  const keys = Array.from({ length: 12 }, (_, i) => (i === 3 ? 'boom.test' : `h${i}.test`));
  saveTargets(keys);
  await checkTargets(keys, probe);
  assert.ok(peak <= 5, `at most 5 at once (${peak})`);
  const a = await expiryAnswer();
  assert.equal(a.items.find((i) => i.name === 'boom.test').state, 'handshake_failed');
  assert.equal(a.items.filter((i) => i.state === 'ok').length, 11);
});

test('GET /api/expiry: the answer with an ETag, a 304 on a repeat, and never an error status', async () => {
  const app = express();
  app.use('/api', infrastructureRoutes);
  const off = await request(app).get('/api/expiry');
  assert.equal(off.status, 200);
  assert.equal(off.body.configured, false);
  assert.ok(off.headers.etag);
  const again = await request(app).get('/api/expiry').set('If-None-Match', off.headers.etag);
  assert.equal(again.status, 304);

  const s = await server(40);
  saveTargets([s]);
  await settle(() => expiryAnswer());
  const on = await request(app).get('/api/expiry');
  assert.equal(on.status, 200);
  assert.equal(on.body.configured, true);
  assert.equal(on.body.items[0].name, s);
});

test('the answer carries the name-mismatch flag and the offline Tailscale devices apart from the items', async () => {
  const s = await server(30);
  saveTargets([s]);
  const a = await settle(() => expiryAnswer());
  assert.equal(a.items[0].mismatch, true, 'the test certificate is for localhost, not for the address typed');
  process.env.JAGHELM_TAILSCALE_API_KEY = 'tskey' + '-api-x'; // pragma: allowlist secret
  const ago = (n) => new Date(Date.now() - n * DAY).toISOString();
  const fetchImpl = async () =>
    new Response(JSON.stringify({ devices: [{ nodeId: 'a', name: 'gone.t.ts.net', expires: ago(10), lastSeen: ago(60) }] }));
  const b = await expiryAnswer(Date.now(), { fetchImpl });
  assert.deepEqual(b.offline.map((o) => o.name), ['gone']);
  assert.ok(!b.items.some((i) => i.name === 'gone'));
});
