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
 * Drive fetchSafe against a stubbed global fetch: hop i answers 302 to
 * locations[i], the hop after the last one 200. Returns the URL and headers each
 * hop was sent. Lets us test origins a local listener can't stand up (https,
 * other hostnames, port 80).
 */
async function hopsVia(start, locations, headers) {
  const locs = [].concat(locations);
  const realFetch = globalThis.fetch;
  /** @type {Array<{url: string, headers: Headers}>} */
  const hops = [];
  globalThis.fetch = async (url, init) => {
    hops.push({ url: String(url), headers: new Headers(init.headers) });
    const location = locs[hops.length - 1];
    return location
      ? new Response(null, { status: 302, headers: { location } })
      : new Response('ok', { status: 200 });
  };
  try {
    await fetchSafe(start, { headers });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(hops.length, locs.length + 1, 'every redirect was followed');
  return hops;
}

const SVC = 'svc.example.test';
const CREDS = { 'X-Gotify-Key': 'k1', Authorization: 'Bearer k2', Accept: 'application/json' }; // pragma: allowlist secret
const hasCreds = (hop) => [hop.headers.get('x-gotify-key'), hop.headers.get('authorization')];

// Origin = scheme + host + port, compared as the WHATWG URL parser normalizes them
// (lowercase host, default port elided). An origin change drops every header but
// the allowlisted ones.
for (const [what, start, location] of [
  ['another port on the same host', `http://${SVC}/`, `http://${SVC}:8080/next`],
  ['another host', `http://${SVC}/`, 'http://other.example.test/next'],
  ['a subdomain of the same host', `http://${SVC}/`, `http://api.${SVC}/next`],
  ['an https upgrade that adds a port', `http://${SVC}/`, `https://${SVC}:8443/next`],
  ['an https upgrade that changes the port', `http://${SVC}:8080/`, `https://${SVC}:8443/next`],
  ['an https upgrade from http on port 443', `http://${SVC}:443/`, `https://${SVC}/next`],
  ['an https upgrade to another host', `http://${SVC}/`, 'https://other.example.test/next'],
  ['an https upgrade to a subdomain', `http://${SVC}/`, `https://api.${SVC}/next`],
  ['an https -> http downgrade on the same host', `https://${SVC}/`, `http://${SVC}/next`],
]) {
  test(`origin change: ${what} drops credentials`, async () => {
    const hops = await hopsVia(start, location, CREDS);
    assert.equal(hops[1].url, new URL(location, start).href);
    assert.deepEqual(hasCreds(hops[1]), [null, null]);
    assert.equal(hops[1].headers.get('accept'), 'application/json');
  });
}

// Same origin keeps every header. So does the one exception: an http -> https
// upgrade to the same host and port (default ports 80 -> 443, or an explicit
// port kept), a reverse proxy's force-SSL.
for (const [what, start, location] of [
  ['a relative location', `http://${SVC}/`, '/next'],
  ['the explicit default port', `http://${SVC}/`, `http://${SVC}:80/next`],
  ['an upper-case host', `http://${SVC}/`, `http://${SVC.toUpperCase()}/next`],
  ['an http -> https upgrade on the same host', `http://${SVC}/`, `https://${SVC}/next`],
  ['an https upgrade to the explicit default port', `http://${SVC}/`, `https://${SVC}:443/next`],
  ['an https upgrade from the explicit default port', `http://${SVC}:80/`, `https://${SVC.toUpperCase()}/next`],
  ['an https upgrade keeping a non-default port', `http://${SVC}:8443/`, `https://${SVC}:8443/next`],
]) {
  test(`same origin or same-host upgrade: ${what} keeps credentials`, async () => {
    const hops = await hopsVia(start, location, CREDS);
    assert.deepEqual(hasCreds(hops[1]), ['k1', 'Bearer k2']);
  });
}

// Headers dropped on one hop stay dropped for the rest of the chain: neither a
// return to the first origin nor the same-host upgrade exception brings them back.
test('multi-hop: a return to the first origin does not restore dropped headers', async () => {
  const hops = await hopsVia('http://a.example.test/',
    ['http://b.example.test/', 'http://a.example.test/'], CREDS);
  assert.deepEqual(hasCreds(hops[2]), [null, null]);
});

// The CVE-2024-45336 shape (Go net/http): a same-origin hop after a cross-origin
// one must not restore what the cross-origin hop dropped.
test('multi-hop: a same-origin hop after a cross-origin one does not restore them', async () => {
  const hops = await hopsVia('http://a.example.test/',
    ['http://b.example.test/1', 'http://b.example.test/2'], CREDS);
  assert.deepEqual(hasCreds(hops[1]), [null, null]);
  assert.deepEqual(hasCreds(hops[2]), [null, null]);
});

test('multi-hop: an https -> http -> https bounce does not restore dropped headers', async () => {
  const hops = await hopsVia(`https://${SVC}/`, [`http://${SVC}/`, `https://${SVC}/`], CREDS);
  assert.deepEqual(hasCreds(hops[1]), [null, null]);
  assert.deepEqual(hasCreds(hops[2]), [null, null]);
});

test('multi-hop: upgrade keeps them, a cross-origin hop drops them, and they stay dropped', async () => {
  const hops = await hopsVia(`http://${SVC}/`,
    [`https://${SVC}/`, 'https://evil.example.test/', `https://${SVC}/`], CREDS);
  assert.deepEqual(hasCreds(hops[1]), ['k1', 'Bearer k2']);
  assert.deepEqual(hasCreds(hops[2]), [null, null]);
  assert.deepEqual(hasCreds(hops[3]), [null, null]);
});

/** Run fn, returning the safeFetch log entries it wrote (warn goes to stderr). */
async function safeFetchWarnings(fn) {
  const lines = [];
  const orig = process.stderr.write;
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  try {
    await fn();
  } finally {
    process.stderr.write = orig;
  }
  return lines.map((l) => JSON.parse(l)).filter((e) => e.module === 'safeFetch');
}

test('dropping headers warns once per origin pair, with names and a count but no values', async () => {
  const host = `h${randomBytes(4).toString('hex')}.example.test`;
  const secrets = [randomBytes(8).toString('hex'), randomBytes(8).toString('hex')];
  const headers = { 'X-Gotify-Key': secrets[0], Authorization: `Bearer ${secrets[1]}`, Accept: 'application/json' };
  const run = (to) => safeFetchWarnings(() => hopsVia(`http://${host}/`, to, headers));

  const first = await run(`http://other.${host}/x`);
  assert.equal(first.length, 1);
  assert.equal(first[0].level, 'warn');
  assert.equal(first[0].from, `http://${host}`);
  assert.equal(first[0].to, `http://other.${host}`);
  assert.equal(first[0].dropped, 2);
  assert.deepEqual([...first[0].headers].sort(), ['authorization', 'x-gotify-key']);
  assert.match(first[0].msg, /redirected http:\/\/\S+ → http:\/\/\S+; 2 headers not forwarded/);

  assert.equal((await run(`http://other.${host}/y`)).length, 0, 'same pair warns once');
  const third = await run(`http://third.${host}/`);
  assert.equal(third.length, 1, 'a new pair warns again');

  const logged = JSON.stringify([...first, ...third]);
  for (const v of secrets) assert.ok(!logged.includes(v), 'a header value reached the log');
});

test('the same-host https upgrade warns once per pair to configure https://, without values', async () => {
  const host = `h${randomBytes(4).toString('hex')}.example.test`;
  const secret = randomBytes(8).toString('hex');
  const run = () => safeFetchWarnings(() =>
    hopsVia(`http://${host}/`, `https://${host}/next`, { 'X-Gotify-Key': secret }));

  const first = await run();
  assert.equal(first.length, 1);
  assert.equal(first[0].from, `http://${host}`);
  assert.equal(first[0].to, `https://${host}`);
  assert.match(first[0].msg, new RegExp(`configure https://${host.replace(/\./g, '\\.')}`));
  assert.match(first[0].msg, /clear text on the first hop/);
  assert.equal(first[0].kept, 1);
  assert.deepEqual(first[0].headers, ['x-gotify-key']);
  assert.equal((await run()).length, 0, 'same pair warns once');
  assert.ok(!JSON.stringify(first).includes(secret), 'a header value reached the log');
});

test('no warning when only allowlisted headers were on the request', async () => {
  const host = `h${randomBytes(4).toString('hex')}.example.test`;
  const logged = await safeFetchWarnings(() =>
    hopsVia(`http://${host}/`, [`http://other.${host}/`, `https://other.${host}/`],
      { Accept: 'application/json' }));
  assert.equal(logged.length, 0);
});

/**
 * Drive fetchSafe against a stubbed global fetch where a redirect may be
 * refused: hop i answers `status` with locations[i], the hop after the last one
 * 200. Returns what each hop was sent and the error fetchSafe threw, if any.
 */
async function tryHops(start, locations, { status = 302, init = {}, cfg = {} } = {}) {
  const locs = [].concat(locations);
  const realFetch = globalThis.fetch;
  /** @type {Array<{url: string, method: string, body: any, headers: Headers}>} */
  const hops = [];
  globalThis.fetch = async (url, i) => {
    hops.push({ url: String(url), method: i.method, body: i.body, headers: new Headers(i.headers) });
    const location = locs[hops.length - 1];
    return location
      ? new Response(null, { status, headers: { location } })
      : new Response('ok', { status: 200 });
  };
  let error = null;
  try {
    await fetchSafe(start, init, cfg);
  } catch (err) {
    error = err;
  } finally {
    globalThis.fetch = realFetch;
  }
  return { hops, error };
}

// #224: a credential in the URL (a query-auth preset's key, a {token} endpoint)
// can't be dropped the way a header is, so a request flagged credentialInUrl
// does not follow a redirect to another origin at all.
const KEYED = { cfg: { credentialInUrl: true } };
for (const [what, start, location] of [
  ['another host', `http://${SVC}/api?apikey=k1`, 'http://other.example.test/api?apikey=k1'],
  ['another port on the same host', `http://${SVC}/api?apikey=k1`, `http://${SVC}:8080/api?apikey=k1`],
  ['a subdomain', `http://${SVC}/api?apikey=k1`, `http://api.${SVC}/api?apikey=k1`],
  ['an https upgrade that changes the port', `http://${SVC}/api?apikey=k1`, `https://${SVC}:8443/api?apikey=k1`],
  ['an https upgrade to another host', `http://${SVC}/api?apikey=k1`, 'https://other.example.test/api?apikey=k1'],
  ['an https -> http downgrade', `https://${SVC}/api?apikey=k1`, `http://${SVC}/api?apikey=k1`],
  ['another host, with the query left off', `http://${SVC}/api?apikey=k1`, 'http://other.example.test/'],
]) {
  test(`credential in the URL: ${what} is refused`, async () => {
    const { hops, error } = await tryHops(start, location, KEYED);
    assert.match(String(error?.message), /not following .*credential is in the URL/);
    assert.equal(hops.length, 1, 'the other origin was contacted');
  });
}

for (const [what, start, location] of [
  ['a same-origin redirect', `http://${SVC}/api?apikey=k1`, '/v2/api?apikey=k1'],
  ['the same-host http -> https upgrade', `http://${SVC}/api?apikey=k1`, `https://${SVC}/api?apikey=k1`],
  ['the upgrade keeping a non-default port', `http://${SVC}:8080/api?apikey=k1`, `https://${SVC}:8080/api?apikey=k1`],
]) {
  test(`credential in the URL: ${what} is followed`, async () => {
    const { hops, error } = await tryHops(start, location, KEYED);
    assert.equal(error, null);
    assert.equal(hops.length, 2);
    assert.equal(hops[1].url, new URL(location, start).href);
  });
}

test('credential in the URL: a cross-origin hop after an upgrade is refused', async () => {
  const { hops, error } = await tryHops(`http://${SVC}/api?apikey=k1`,
    [`https://${SVC}/api?apikey=k1`, 'https://evil.example.test/api?apikey=k1'], KEYED);
  assert.match(String(error?.message), /credential is in the URL/);
  assert.deepEqual(hops.map((h) => new URL(h.url).origin), [`http://${SVC}`, `https://${SVC}`]);
});

test('credential in the URL: an upgrade then a downgrade back to http is refused', async () => {
  const { hops, error } = await tryHops(`http://${SVC}/api?apikey=k1`,
    [`https://${SVC}/api?apikey=k1`, `http://${SVC}/api?apikey=k1`], KEYED);
  assert.match(String(error?.message), /credential is in the URL/);
  assert.equal(hops.length, 2);
});

test('without the flag, a cross-origin redirect is still followed', async () => {
  const { hops, error } = await tryHops(`http://${SVC}/api?q=1`, 'http://other.example.test/api?q=1');
  assert.equal(error, null);
  assert.equal(hops.length, 2);
});

test('credential in the URL: a real second origin receives no request', async () => {
  let reached = 0;
  const dest = await listen((req, res) => { reached++; res.writeHead(200); res.end('ok'); });
  const redir = await listen((req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${portOf(dest)}${req.url}` }); res.end();
  });
  try {
    await assert.rejects(
      fetchSafe(`http://127.0.0.1:${portOf(redir)}/api?apikey=k1`, {}, { credentialInUrl: true }),
      /credential is in the URL/,
    );
    assert.equal(reached, 0);
  } finally { dest.close(); redir.close(); }
});

test('a refused redirect warns once per origin pair, and neither log nor error holds the key', async () => {
  const host = `h${randomBytes(4).toString('hex')}.example.test`;
  const key = randomBytes(8).toString('hex');
  /** @type {Error | null} */
  let error = null;
  const run = (to) => safeFetchWarnings(async () => {
    ({ error } = await tryHops(`http://${host}/api?apikey=${key}`, `${to}?apikey=${key}`, KEYED));
  });

  const first = await run(`http://other.${host}/api`);
  assert.equal(first.length, 1);
  assert.equal(first[0].level, 'warn');
  assert.equal(first[0].from, `http://${host}`);
  assert.equal(first[0].to, `http://other.${host}`);
  assert.equal(first[0].refused, 'credential in URL');
  assert.ok(!JSON.stringify(first).includes(key), 'the key reached the log');
  assert.ok(!String(error?.message).includes(key), 'the key reached the error');
  assert.equal((await run(`http://other.${host}/x`)).length, 0, 'same pair warns once');
  assert.equal((await run(`http://third.${host}/`)).length, 1, 'a new pair warns again');
});
