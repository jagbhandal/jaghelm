/**
 * fetchSafe: SSRF re-validation across redirects + response-body cap.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
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

test('a cross-origin redirect drops API-key headers along with authorization and cookie', async () => {
  let got = null;
  const dest = await listen((req, res) => { got = req.headers; res.writeHead(200); res.end('ok'); });
  const redir = await listen((req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${portOf(dest)}/x` }); res.end();
  });
  try {
    await fetchSafe(`http://127.0.0.1:${portOf(redir)}/`, {
      headers: {
        'X-API-Key': 'k1', // pragma: allowlist secret
        'x-api-token': 'k2', // pragma: allowlist secret
        Authorization: 'Bearer k3',
        Cookie: 'c=1',
        'X-Other': 'kept',
      },
    });
    assert.equal(got['x-api-key'], undefined);
    assert.equal(got['x-api-token'], undefined);
    assert.equal(got.authorization, undefined);
    assert.equal(got.cookie, undefined);
    assert.equal(got['x-other'], 'kept');
  } finally { dest.close(); redir.close(); }
});

test('a same-origin redirect keeps the API key', async () => {
  const seen = [];
  const srv = await listen((req, res) => {
    seen.push(req.headers['x-api-key']);
    if (req.url === '/') { res.writeHead(302, { location: '/next' }); res.end(); return; }
    res.writeHead(200); res.end('ok');
  });
  try {
    await fetchSafe(`http://127.0.0.1:${portOf(srv)}/`, { headers: { 'X-API-Key': 'k1' } }); // pragma: allowlist secret
    assert.deepEqual(seen, ['k1', 'k1']);
  } finally { srv.close(); }
});
