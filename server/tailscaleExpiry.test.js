/**
 * Tailscale node keys for the expiry tracker (#676): the device parse over
 * defensive shapes, absent without a key, the request (one fixed address,
 * Bearer header only, no redirect), the 6-hour cache, and every failure ending
 * in a plain state with the key nowhere in the log or the answer.
 */
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const KEY = 'tskey-api-test-0123456789abcdef'; // pragma: allowlist secret
delete process.env.JAGHELM_TAILNET;
process.env.JAGHELM_TAILSCALE_API_KEY = KEY;
process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret

const logged = [];
const {
  API_ORIGIN,
  CACHE_TTL_MS,
  FAILURE_TTL_MS,
  REJECTED_TTL_MS,
  STALE_MAX_MS,
  parseDevices,
  tailscaleAnswer,
  _resetTailscale,
} = await import('./tailscaleExpiry.js');
const { setSecret, deleteSecret } = await import('./secrets.js');

// The logger writes to stdout/stderr; capture both for the no-secret check.
const realOut = process.stdout.write.bind(process.stdout);
const realErr = process.stderr.write.bind(process.stderr);
for (const [stream, real] of [
  [process.stdout, realOut],
  [process.stderr, realErr],
]) {
  stream.write = (chunk, ...rest) => {
    logged.push(String(chunk));
    return real(chunk, ...rest);
  };
}
after(() => {
  process.stdout.write = realOut;
  process.stderr.write = realErr;
  process.env.JAGHELM_TAILSCALE_API_KEY = KEY;
});

const NOW = Date.parse('2026-10-24T12:00:00Z');
const day = (n) => new Date(NOW + n * 86_400_000).toISOString();

const DEVICES = {
  devices: [
    { id: '1', nodeId: 'n1', name: 'pve.tailnet-abc.ts.net', hostname: 'pve', keyExpiryDisabled: false, expires: day(40) },
    { id: '2', nodeId: 'n2', name: 'phone.tailnet-abc.ts.net', hostname: 'phone', keyExpiryDisabled: false, expires: day(3) },
    { id: '3', nodeId: 'n3', name: 'server.tailnet-abc.ts.net', hostname: 'server', keyExpiryDisabled: true, expires: '0001-01-01T00:00:00Z' },
    { id: '4', nodeId: 'n4', name: 'tagged.tailnet-abc.ts.net', keyExpiryDisabled: true },
  ],
};

let calls;
function stub(handler) {
  calls = [];
  return async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(url, init);
  };
}
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  _resetTailscale();
  process.env.JAGHELM_TAILSCALE_API_KEY = KEY;
  delete process.env.JAGHELM_TAILNET;
  logged.length = 0;
});

test('parseDevices: keyed devices with their end date; key-expiry-off devices counted apart', () => {
  const p = parseDevices(DEVICES);
  assert.deepEqual(p.keyed.map((d) => [d.name, d.expires]), [
    ['pve', day(40)],
    ['phone', day(3)],
  ]);
  assert.equal(p.noExpiry.count, 2);
  assert.deepEqual(p.noExpiry.names, ['server', 'tagged']);
});

test('parseDevices: a missing, wrong or zero end date is unknown (null), never a date and never "no expiry"', () => {
  const p = parseDevices({
    devices: [
      { hostname: 'a' }, // nothing stated
      { hostname: 'b', expires: 'soon' },
      { hostname: 'c', expires: '0001-01-01T00:00:00Z' }, // zero time, expiry not stated off
      { hostname: 'd', expires: 12345 },
      { hostname: 'e', keyExpiryDisabled: 'yes', expires: day(5) }, // not true: still keyed
      null,
      'x',
    ],
  });
  assert.deepEqual(p.keyed.map((d) => [d.name, d.expires]), [
    ['a', null],
    ['b', null],
    ['c', null],
    ['d', null],
    ['e', day(5)],
  ]);
  assert.equal(p.noExpiry.count, 0);
});

test('parseDevices: the name is the hostname, else the first part of the FQDN, else a placeholder; control characters out', () => {
  const p = parseDevices({
    devices: [
      { name: 'box.tailnet.ts.net', expires: day(1) },
      { hostname: 'ho\nst', expires: day(1) },
      { expires: day(1) },
    ],
  });
  assert.deepEqual(p.keyed.map((d) => d.name), ['box', 'ho st', 'unnamed device']);
});

test('parseDevices: anything that is not a device list is null', () => {
  for (const bad of [null, undefined, 'x', 3, [], {}, { devices: 'no' }, { devices: {} }]) {
    assert.equal(parseDevices(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(parseDevices({ devices: [] }), { keyed: [], noExpiry: { count: 0, names: [] }, offline: [] });
});

test('no key set: the source is absent, and nothing is requested', async () => {
  delete process.env.JAGHELM_TAILSCALE_API_KEY;
  const f = stub(() => json(DEVICES));
  assert.equal(await tailscaleAnswer(NOW, f), null);
  assert.equal(calls.length, 0);
  process.env.JAGHELM_TAILSCALE_API_KEY = '';
  assert.equal(await tailscaleAnswer(NOW, f), null);
});

test('the request: one fixed address, the key in the Authorization header only, no redirect followed, the key\'s own tailnet by default', async () => {
  const f = stub(() => json(DEVICES));
  const a = await tailscaleAnswer(NOW, f);
  assert.equal(a.state, 'ok');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API_ORIGIN}/api/v2/tailnet/-/devices`);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  assert.ok(!calls[0].url.includes(KEY));
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.ok(!JSON.stringify(a).includes(KEY));
});

test('JAGHELM_TAILNET is escaped into the path; a value that is no tailnet name is not used', async () => {
  process.env.JAGHELM_TAILNET = 'example.com';
  await tailscaleAnswer(NOW, stub(() => json(DEVICES)));
  assert.equal(calls[0].url, `${API_ORIGIN}/api/v2/tailnet/example.com/devices`);
  _resetTailscale();
  process.env.JAGHELM_TAILNET = '../../etc/x?y=1';
  await tailscaleAnswer(NOW, stub(() => json(DEVICES)));
  assert.equal(calls[0].url, `${API_ORIGIN}/api/v2/tailnet/-/devices`);
});

test('a redirect is a failure: it is not followed and the key goes nowhere else', async () => {
  const f = stub(() => new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } }));
  const a = await tailscaleAnswer(NOW, f);
  assert.equal(a.state, 'unreachable');
  assert.equal(calls.length, 1, 'one request, the redirect not followed');
  assert.deepEqual(a.keyed, []);
});

test('one answer is kept 6 hours for every reader, then asked again', async () => {
  const f = stub(() => json(DEVICES));
  await Promise.all([tailscaleAnswer(NOW, f), tailscaleAnswer(NOW, f), tailscaleAnswer(NOW, f)]);
  assert.equal(calls.length, 1);
  await tailscaleAnswer(NOW + CACHE_TTL_MS - 1, f);
  assert.equal(calls.length, 1);
  await tailscaleAnswer(NOW + CACHE_TTL_MS + 1, f);
  assert.equal(calls.length, 2);
});

test('401 and 403: "rejected", the list dropped, one warning per window, and not asked again inside it', async () => {
  for (const status of [401, 403]) {
    _resetTailscale();
    logged.length = 0;
    const f = stub(() => json({ message: 'nope' }, status));
    const a = await tailscaleAnswer(NOW, f);
    assert.equal(a.state, 'rejected');
    assert.deepEqual(a.keyed, []);
    await tailscaleAnswer(NOW + 60_000, f);
    await tailscaleAnswer(NOW + REJECTED_TTL_MS - 1, f);
    assert.equal(calls.length, 1, String(status));
    const warns = logged.filter((l) => l.includes('Tailscale node keys not read'));
    assert.equal(warns.length, 1, `${status}: ${warns.length}`);
    await tailscaleAnswer(NOW + REJECTED_TTL_MS + 1, f);
    assert.equal(calls.length, 2);
  }
});

test('a server error, a network error, a timeout and a body that is not a device list each end in a plain state', async () => {
  const cases = [
    ['500', () => json({}, 500), 'unreachable'],
    ['network', () => { throw new TypeError('fetch failed'); }, 'unreachable'],
    ['timeout', () => { throw new DOMException('timed out', 'TimeoutError'); }, 'unreachable'],
    ['html', () => new Response('<html>', { status: 200 }), 'unreadable'],
    ['shape', () => json({ devices: 'x' }), 'unreadable'],
  ];
  for (const [label, handler, state] of cases) {
    _resetTailscale();
    const a = await tailscaleAnswer(NOW, stub(handler));
    assert.equal(a.state, state, label);
    assert.deepEqual(a.keyed, [], label);
    assert.equal(a.noExpiry.count, 0, label);
  }
});

test('a failed read is asked again after its window, and the last good list is served stale until then', async () => {
  let fail = false;
  const f = stub(() => (fail ? json({}, 503) : json(DEVICES)));
  await tailscaleAnswer(NOW, f);
  fail = true;
  const later = NOW + CACHE_TTL_MS + 1;
  const stale = await tailscaleAnswer(later, f);
  assert.equal(stale.stale, true);
  assert.equal(stale.keyed.length, 2, 'the last good list');
  // Inside the failure window: no new request.
  const n = calls.length;
  await tailscaleAnswer(later + FAILURE_TTL_MS - 1, f);
  assert.equal(calls.length, n);
  // Past the stale limit the list is no longer vouched for.
  const gone = await tailscaleAnswer(NOW + STALE_MAX_MS + CACHE_TTL_MS + FAILURE_TTL_MS + 10, f);
  assert.equal(gone.state, 'unreachable');
  assert.deepEqual(gone.keyed, []);
});

test('the key is in no log line, whatever the failure, even when the error text carries it', async () => {
  const sneaky = [
    () => { throw new Error(`connect failed with Authorization: Bearer ${KEY}`); },
    () => json({ message: `bad ${KEY}` }, 401),
    () => json({}, 500),
    () => new Response(`echo ${KEY}`, { status: 200 }),
  ];
  for (const h of sneaky) {
    _resetTailscale();
    const a = await tailscaleAnswer(NOW, stub(h));
    assert.ok(!JSON.stringify(a).includes(KEY));
  }
  assert.ok(logged.length > 0, 'something was logged, so the check means something');
  assert.ok(!logged.join('').includes(KEY));
});

test('the key set up in the Tailscale integration (the secret store) is used when .env has none; the REPLACE_ME template is unset', async () => {
  const STORED = 'tskey-api-stored-9876543210fedcba'; // pragma: allowlist secret
  setSecret('integration_tailscale_token', STORED);
  try {
    delete process.env.JAGHELM_TAILSCALE_API_KEY;
    let a = await tailscaleAnswer(NOW, stub(() => json(DEVICES)));
    assert.equal(a.state, 'ok');
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${STORED}`);
    // The template placeholder is no key: the stored one still wins.
    _resetTailscale();
    process.env.JAGHELM_TAILSCALE_API_KEY = 'REPLACE_ME';
    a = await tailscaleAnswer(NOW, stub(() => json(DEVICES)));
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${STORED}`);
    // .env beats the store.
    _resetTailscale();
    process.env.JAGHELM_TAILSCALE_API_KEY = KEY;
    await tailscaleAnswer(NOW, stub(() => json(DEVICES)));
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
    assert.ok(!logged.join('').includes(STORED));
  } finally {
    deleteSecret('integration_tailscale_token');
  }
  // With neither, absent; the template alone is absent too.
  _resetTailscale();
  process.env.JAGHELM_TAILSCALE_API_KEY = 'REPLACE_ME';
  assert.equal(await tailscaleAnswer(NOW, stub(() => json(DEVICES))), null);
  assert.equal(calls.length, 0);
});

test('parseDevices: the console machine name beats a hostname like "localhost"; equal names get their short id', () => {
  const p = parseDevices({
    devices: [
      { nodeId: 'nabc123456', name: 'pixel.tailnet.ts.net', hostname: 'localhost', expires: day(30) },
      { nodeId: 'nxyz987654', name: 'pi.tailnet.ts.net', hostname: 'pi', expires: day(31) },
      { nodeId: 'nqqq111111', name: 'pi-1.tailnet.ts.net', hostname: 'pi', expires: day(32) },
      { nodeId: 'naaa111CNTRL', name: 'twin.tailnet.ts.net', expires: day(33) },
      { nodeId: 'nbbb222CNTRL', name: 'twin.tailnet.ts.net', expires: day(34) },
    ],
  }, NOW);
  assert.deepEqual(p.keyed.map((d) => d.name), ['pixel', 'pi', 'pi-1', 'twin (aaa111)', 'twin (bbb222)']);
});

test('parseDevices: shared-in (isExternal) devices are skipped', () => {
  const p = parseDevices({ devices: [
    { name: 'mine.t.ts.net', expires: day(5) },
    { name: 'theirs.other.ts.net', isExternal: true, expires: day(1) },
  ] }, NOW);
  assert.deepEqual(p.keyed.map((d) => d.name), ['mine']);
});

test('parseDevices: an expired key on a device unseen for over 30 days is offline, not a row; seen recently or unknown stays a row', () => {
  const ago = (n) => new Date(NOW - n * 86_400_000).toISOString();
  const p = parseDevices({ devices: [
    { name: 'old.t.ts.net', expires: ago(20), lastSeen: ago(45) },
    { name: 'recent.t.ts.net', expires: ago(2), lastSeen: ago(1) },
    { name: 'noseen.t.ts.net', expires: ago(2) },
    { name: 'fine.t.ts.net', expires: day(9), lastSeen: ago(90) },
  ] }, NOW);
  assert.deepEqual(p.offline, [{ name: 'old', lastSeen: ago(45) }]);
  assert.deepEqual(p.keyed.map((d) => d.name), ['recent', 'noseen', 'fine']);
});
