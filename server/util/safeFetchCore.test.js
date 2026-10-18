/**
 * fetchSafe: SSRF re-validation across redirects + response-body cap.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { fetchSafe } from './safeFetchCore.js';

function listen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}
const portOf = (srv) => srv.address().port;

test('follows a safe redirect and returns the final body', async () => {
  const dest = await listen((req, res) => { res.writeHead(200); res.end('REACHED_DEST'); });
  const redir = await listen((req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${portOf(dest)}/x` }); res.end();
  });
  try {
    const r = await fetchSafe(`http://127.0.0.1:${portOf(redir)}/`);
    assert.equal(r.status, 200);
    assert.equal((await r.text()).trim(), 'REACHED_DEST');
  } finally { dest.close(); redir.close(); }
});

test('BLOCKS a redirect to a cloud-metadata IP instead of following it', async () => {
  let followed = false;
  const redir = await listen((req, res) => {
    followed = true; // first hit is the redirector itself; the 169.254 hop must NOT fire
    res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); res.end();
  });
  try {
    await assert.rejects(
      fetchSafe(`http://127.0.0.1:${portOf(redir)}/`),
      /blocked host|169\.254\.169\.254/i,
    );
    assert.equal(followed, true); // we did hit the redirector...
    // ...but the guard threw on the metadata hop; there is no metadata server to assert
    // against, so the rejection itself is the proof the hop was re-validated, not followed.
  } finally { redir.close(); }
});

test('rejects a body that exceeds the size cap (streamed, no content-length)', async () => {
  const big = await listen((req, res) => {
    res.writeHead(200); // chunked, no content-length
    res.end('x'.repeat(5000));
  });
  try {
    await assert.rejects(
      fetchSafe(`http://127.0.0.1:${portOf(big)}/`, {}, { maxBytes: 1000 }),
      /too large/i,
    );
  } finally { big.close(); }
});

test('rejects early on a declared content-length over the cap', async () => {
  const big = await listen((req, res) => {
    const body = 'y'.repeat(5000);
    res.writeHead(200, { 'content-length': String(body.length) }); res.end(body);
  });
  try {
    await assert.rejects(
      fetchSafe(`http://127.0.0.1:${portOf(big)}/`, {}, { maxBytes: 1000 }),
      /too large/i,
    );
  } finally { big.close(); }
});

test('caps the redirect chain length', async () => {
  let srv;
  srv = await listen((req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${portOf(srv)}/loop` }); res.end();
  });
  try {
    await assert.rejects(fetchSafe(`http://127.0.0.1:${portOf(srv)}/`), /too many redirects/i);
  } finally { srv.close(); }
});

// #204: across an origin change only an allowlist of non-credential headers
// survives. A denylist missed every preset header it didn't name (X-Gotify-Key,
// X-Plex-Token, NC-Token, a custom authHeader, ...); these tests send such headers
// and check that none arrive, whatever their name or spelling.
test('a cross-origin redirect forwards only allowlisted headers', async () => {
  let got = null;
  const dest = await listen((req, res) => { got = req.headers; res.writeHead(200); res.end('ok'); });
  const redir = await listen((req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${portOf(dest)}/x` }); res.end();
  });
  // A header name no list could anticipate: proves this is an allowlist.
  const random = `x-${randomBytes(6).toString('hex')}`;
  try {
    await fetchSafe(`http://127.0.0.1:${portOf(redir)}/`, {
      headers: {
        // Dropped: credentials, in mixed spellings (Headers is case-insensitive).
        Authorization: 'Bearer k1',
        Cookie: 'c=1',
        'X-API-Key': 'k2', // pragma: allowlist secret
        'x-api-token': 'k3', // pragma: allowlist secret
        'X-Gotify-Key': 'k4', // pragma: allowlist secret
        'x-PLEX-token': 'k5',
        'Proxy-Authorization': 'Basic k6',
        [random]: 'k7',
        // Kept: content negotiation + client identity, never a secret.
        Accept: 'application/json',
        'Accept-Encoding': 'identity',
        'CONTENT-type': 'application/json',
        'User-Agent': 'jaghelm-test',
      },
    });
    for (const h of ['authorization', 'cookie', 'x-api-key', 'x-api-token', 'x-gotify-key',
      'x-plex-token', 'proxy-authorization', random]) {
      assert.equal(got[h], undefined, `${h} crossed the origin boundary`);
    }
    assert.equal(got.accept, 'application/json');
    assert.equal(got['accept-encoding'], 'identity');
    assert.equal(got['content-type'], 'application/json');
    assert.equal(got['user-agent'], 'jaghelm-test');
  } finally { dest.close(); redir.close(); }
});

test('a same-origin redirect keeps every header, credentials included', async () => {
  const seen = [];
  const random = `x-${randomBytes(6).toString('hex')}`;
  const srv = await listen((req, res) => {
    seen.push([req.headers['x-api-key'], req.headers['x-gotify-key'], req.headers[random]]);
    if (req.url === '/') { res.writeHead(302, { location: '/next' }); res.end(); return; }
    res.writeHead(200); res.end('ok');
  });
  try {
    await fetchSafe(`http://127.0.0.1:${portOf(srv)}/`, {
      headers: { 'X-API-Key': 'k1', 'X-Gotify-Key': 'k2', [random]: 'k3' }, // pragma: allowlist secret
    });
    assert.deepEqual(seen, [['k1', 'k2', 'k3'], ['k1', 'k2', 'k3']]);
  } finally { srv.close(); }
});

/**
 * Drive fetchSafe against a stubbed global fetch: the first hop answers 302 to
 * `location`, the next 200. Returns the headers each hop was sent. Lets us test
 * origins a local listener can't stand up (https, other hostnames, port 80).
 */
async function hopsVia(start, location, headers) {
  const realFetch = globalThis.fetch;
  /** @type {Array<{url: string, headers: Headers}>} */
  const hops = [];
  globalThis.fetch = async (url, init) => {
    hops.push({ url: String(url), headers: new Headers(init.headers) });
    return hops.length === 1
      ? new Response(null, { status: 302, headers: { location } })
      : new Response('ok', { status: 200 });
  };
  try {
    await fetchSafe(start, { headers });
  } finally {
    globalThis.fetch = realFetch;
  }
  return hops;
}

// Origin = scheme + host + port, compared as the WHATWG URL parser normalizes them
// (lowercase host, default port elided).
for (const [what, location] of [
  ['an http -> https upgrade on the same host', 'https://svc.example.test/next'],
  ['another port on the same host', 'http://svc.example.test:8080/next'],
  ['another host', 'http://other.example.test/next'],
  ['a subdomain of the same host', 'http://api.svc.example.test/next'],
]) {
  test(`origin change: ${what} drops credentials`, async () => {
    const hops = await hopsVia('http://svc.example.test/', location,
      { 'X-Gotify-Key': 'k1', Accept: 'application/json' }); // pragma: allowlist secret
    assert.equal(hops.length, 2);
    assert.equal(hops[1].url, location);
    assert.equal(hops[1].headers.get('x-gotify-key'), null);
    assert.equal(hops[1].headers.get('accept'), 'application/json');
  });
}

for (const [what, location] of [
  ['a relative location', '/next'],
  ['the explicit default port', 'http://svc.example.test:80/next'],
  ['an upper-case host', 'http://SVC.EXAMPLE.TEST/next'],
]) {
  test(`same origin: ${what} keeps credentials`, async () => {
    const hops = await hopsVia('http://svc.example.test/', location,
      { 'X-Gotify-Key': 'k1' }); // pragma: allowlist secret
    assert.equal(hops.length, 2);
    assert.equal(hops[1].headers.get('x-gotify-key'), 'k1');
  });
}
