/**
 * #261: the icon cache lives in the data dir, `JAGHELM_DATA_DIR` like every other
 * store, not always in the checkout's own data/. Drives handleCachedIcon through
 * a bare Express app; the CDN is a stubbed fetch, so no request leaves the box.
 * (That index.js boots it in JAGHELM_DATA_DIR is in icons.boot.test.js.)
 *
 * #255: the endpoint is unauthenticated, so it fetches only icon-repository URLs
 * (icon-sources.js), keys them by their canonical URL, caps each icon's size and
 * the whole cache's, and drops the least recently used icon to stay under it.
 */
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync,
  utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import express from 'express';
import request from 'supertest';

const root = mkdtempSync(join(tmpdir(), 'jh-icon-cache-'));
process.env.JAGHELM_DATA_DIR = join(root, 'default'); // before the import: the module's default
delete process.env.JAGHELM_ICON_CACHE_MAX_MB;
const {
  initIconCache, handleCachedIcon, iconCacheStats, resolveIconCacheMaxBytes,
  MAX_ICON_BYTES, DEFAULT_ICON_CACHE_MAX_BYTES, ICON_CSP, MAX_ICON_FETCHES, MAX_QUEUED_ICON_FETCHES,
} = await import('./icon-cache.js');

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
after(() => rmSync(root, { recursive: true, force: true }));

const app = express();
app.get('/cached', handleCachedIcon);

const icon = (slug) => `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/${slug}.svg`;
const ICON_URL = icon('gitea');
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><title>gitea</title></svg>';
/** An SVG of exactly `bytes` bytes. */
const svgOf = (bytes) => {
  const open = '<svg xmlns="http://www.w3.org/2000/svg">';
  const close = '</svg>';
  return open + ' '.repeat(bytes - open.length - close.length) + close;
};
const hashOf = (url) => createHash('sha256').update(url).digest('hex');
const cachedPath = (dataDir, url) => join(dataDir, 'icon-cache', `${hashOf(url)}.svg`);
const cacheFiles = (dataDir) => readdirSync(join(dataDir, 'icon-cache')).sort();
const get = (url) => request(app).get('/cached').query({ url }).buffer(true).parse((res, cb) => {
  let body = '';
  res.on('data', (c) => { body += c; });
  res.on('end', () => cb(null, body));
});
let n = 0;
const freshDir = (name) => join(root, `${name}-${n++}`);

/** Stub the CDN; `respond(url)` returns the Response (default: SVG). Every URL fetched is recorded. */
function stubCdn(respond = () => new Response(SVG, { status: 200, headers: { 'content-type': 'image/svg+xml' } })) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    assert.equal(init?.redirect, 'manual', 'the icon fetch must not follow redirects by itself');
    return respond(String(url));
  };
  return calls;
}
const svgResponse = (body, headers = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'image/svg+xml', ...headers } });

test('initIconCache creates icon-cache/ in the data dir it is given', () => {
  const dataDir = join(root, 'init');
  initIconCache(dataDir);
  assert.ok(existsSync(join(dataDir, 'icon-cache')));
});

test('initIconCache defaults to JAGHELM_DATA_DIR', () => {
  initIconCache();
  assert.ok(existsSync(join(root, 'default', 'icon-cache')));
});

test('an icon already in the data dir is served from it, without asking the CDN', async () => {
  const dataDir = join(root, 'hit');
  mkdirSync(join(dataDir, 'icon-cache'), { recursive: true });
  writeFileSync(cachedPath(dataDir, ICON_URL), SVG);
  initIconCache(dataDir);
  const calls = stubCdn();
  const r = await get(ICON_URL);
  assert.equal(r.status, 200);
  assert.equal(r.headers['x-icon-cache'], 'HIT');
  assert.equal(r.body, SVG);
  assert.deepEqual(calls, []);
});

test('an icon fetched from the CDN is written to the data dir', async () => {
  const dataDir = join(root, 'miss');
  initIconCache(dataDir);
  const calls = stubCdn();
  const r = await get(ICON_URL);
  assert.equal(r.status, 200);
  assert.equal(r.headers['x-icon-cache'], 'MISS');
  assert.deepEqual(calls, [ICON_URL]);
  assert.equal(readFileSync(cachedPath(dataDir, ICON_URL), 'utf8'), SVG);
  // The next request is a HIT from that file.
  const again = await get(ICON_URL);
  assert.equal(again.headers['x-icon-cache'], 'HIT');
  assert.equal(calls.length, 1);
});

test('a relative data dir still serves cached icons (sendFile needs an absolute path)', async () => {
  const dataDir = join(root, 'relative');
  mkdirSync(join(dataDir, 'icon-cache'), { recursive: true });
  writeFileSync(cachedPath(dataDir, ICON_URL), SVG);
  initIconCache(relative(process.cwd(), dataDir));
  const r = await get(ICON_URL);
  assert.equal(r.status, 200);
  assert.equal(r.headers['x-icon-cache'], 'HIT');
  assert.equal(r.body, SVG);
});

// ── #255: what the endpoint fetches ────────────────────────────────────────

test('a URL outside the icon repositories is refused without a request', async () => {
  const dataDir = freshDir('refused');
  initIconCache(dataDir);
  const calls = stubCdn();
  for (const url of [
    'https://example.com/icon.svg',
    'http://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'https://cdn.jsdelivr.net/gh/attacker/repo@latest/svg/gitea.svg',
    'https://cdn.jsdelivr.net/npm/anything@1.0.0/big.svg',
    'https://raw.githubusercontent.com/attacker/repo/main/payload.svg',
    'https://cdn.jsdelivr.net/gh/attacker/repo/../../gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg%2F..%2F..%2Fx.svg',
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@v1.2.3/svg/gitea.svg',
    'https://cdn.jsdelivr.net:8443/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'https://u:p@cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg',
    'https://169.254.169.254/latest/meta-data/x.svg',
    'not a url',
  ]) {
    const r = await get(url);
    assert.equal(r.status, 403, url);
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(cacheFiles(dataDir), []);
});

test('a missing or repeated ?url= is a 400', async () => {
  initIconCache(freshDir('bad-query'));
  const calls = stubCdn();
  assert.equal((await request(app).get('/cached')).status, 400);
  const twice = await request(app).get('/cached').query(`url=${encodeURIComponent(ICON_URL)}&url=${encodeURIComponent(icon('plex'))}`);
  assert.equal(twice.status, 400);
  assert.deepEqual(calls, []);
});

test('query strings and other spellings of one icon share one fetch and one cache file', async () => {
  const dataDir = freshDir('variants');
  initIconCache(dataDir);
  const calls = stubCdn();
  for (const url of [
    `${ICON_URL}?v=1`,
    `${ICON_URL}?v=2&cachebust=${Date.now()}`,
    `${ICON_URL}#x`,
    'https://CDN.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/gitea.svg',
    'https://cdn.jsdelivr.net/gh/walkxcode/Dashboard-Icons/svg/gitea.svg',
  ]) {
    const r = await get(url);
    assert.equal(r.status, 200, url);
    assert.equal(r.body, SVG);
  }
  assert.deepEqual(calls, [ICON_URL], 'only the canonical URL is fetched, once');
  assert.deepEqual(cacheFiles(dataDir), [`${hashOf(ICON_URL)}.svg`]);
});

test('a redirect to another icon-repository URL is followed; anywhere else is refused', async () => {
  const dataDir = freshDir('redirects');
  initIconCache(dataDir);
  const RAW = 'https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/svg/gitea.svg';
  let calls = stubCdn((url) => (url === ICON_URL
    ? new Response(null, { status: 302, headers: { location: `${RAW}?x=1` } })
    : svgResponse(SVG)));
  const ok = await get(ICON_URL);
  assert.equal(ok.status, 200);
  assert.equal(ok.body, SVG);
  assert.deepEqual(calls, [ICON_URL, RAW], 'the redirect target is fetched in its canonical form');

  for (const location of [
    'https://evil.example/gitea.svg',
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:3099/api/secrets',
    '/gh/attacker/repo@latest/svg/gitea.svg', // relative, resolved against the CDN
    'https://cdn.jsdelivr.net/gh/attacker/repo@latest/svg/gitea.svg',
  ]) {
    const slug = `r${n++}`;
    calls = stubCdn(() => new Response(null, { status: 301, headers: { location } }));
    const r = await get(icon(slug));
    assert.equal(r.status, 502, location);
    assert.deepEqual(calls, [icon(slug)], `followed ${location}`);
  }
  // A 3xx without a Location, and a redirect loop, are failures too.
  calls = stubCdn(() => new Response(null, { status: 304 }));
  const noLocation = await request(app).get('/cached').query({ url: icon('no-location') });
  assert.equal(noLocation.status, 502);
  assert.match(noLocation.body.error, /redirected away/);
  calls = stubCdn((url) => new Response(null, { status: 302, headers: { location: url } }));
  const loop = await request(app).get('/cached').query({ url: icon('loop') });
  assert.equal(loop.status, 502);
  assert.match(loop.body.error, /too many redirects/);
  assert.ok(calls.length <= 4, `a loop made ${calls.length} requests`);
  assert.deepEqual(cacheFiles(dataDir), [`${hashOf(ICON_URL)}.svg`]);
});

// ── #255: what the endpoint stores and serves ──────────────────────────────

test('icons are served with a sandboxing CSP, nosniff and their image type', async () => {
  initIconCache(freshDir('headers'));
  stubCdn();
  assert.equal(ICON_CSP, "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  for (const state of ['MISS', 'HIT']) {
    const r = await get(ICON_URL);
    assert.equal(r.headers['x-icon-cache'], state);
    assert.equal(r.headers['content-security-policy'], ICON_CSP, state);
    assert.equal(r.headers['x-content-type-options'], 'nosniff', state);
    assert.match(r.headers['content-type'], /^image\/svg\+xml/, state);
  }
  const PNG_URL = 'https://cdn.jsdelivr.net/gh/selfhst/icons@latest/png/gitea.png';
  stubCdn(() => new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { 'content-type': 'image/png' } }));
  const png = await request(app).get('/cached').query({ url: PNG_URL });
  assert.equal(png.status, 200);
  assert.match(png.headers['content-type'], /^image\/png/);
  assert.equal(png.headers['content-security-policy'], ICON_CSP);
});

test('an icon over the size cap is not cached; the browser is sent to the CDN for it', async () => {
  const dataDir = freshDir('oversize');
  initIconCache(dataDir);
  assert.equal(MAX_ICON_BYTES, 512 * 1024);
  // Declared too large: refused before the body is read.
  let calls = stubCdn(() => svgResponse(SVG, { 'content-length': String(MAX_ICON_BYTES + 1) }));
  let r = await request(app).get('/cached').query({ url: `${icon('declared')}?v=9` });
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, icon('declared'), 'sent to the canonical CDN URL');
  assert.equal(r.headers['x-icon-cache'], 'BYPASS');
  assert.equal(calls.length, 1);
  // Streamed past the cap with no Content-Length.
  calls = stubCdn(() => svgResponse(svgOf(MAX_ICON_BYTES + 1)));
  r = await request(app).get('/cached').query({ url: icon('streamed') });
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, icon('streamed'));
  // Exactly at the cap is fine.
  stubCdn(() => svgResponse(svgOf(MAX_ICON_BYTES)));
  r = await request(app).get('/cached').query({ url: icon('at-cap') });
  assert.equal(r.status, 200);
  assert.deepEqual(cacheFiles(dataDir), [`${hashOf(icon('at-cap'))}.svg`]);
});

test('a response that is not the icon type asked for is refused and not cached', async () => {
  const dataDir = freshDir('content-type');
  initIconCache(dataDir);
  for (const type of ['text/html', 'text/plain; charset=utf-8', 'application/octet-stream', 'image/png', 'image/svg+xml-evil', '']) {
    stubCdn(() => new Response('<script>alert(1)</script>', { status: 200, headers: type ? { 'content-type': type } : {} }));
    const r = await get(icon(`type-${n++}`));
    assert.equal(r.status, 502, type || '(none)');
  }
  // With parameters, and in any case, the type itself is what counts.
  stubCdn(() => new Response(SVG, { status: 200, headers: { 'content-type': 'Image/SVG+XML; charset=utf-8' } }));
  assert.equal((await get(icon('type-ok'))).status, 200);
  assert.deepEqual(cacheFiles(dataDir), [`${hashOf(icon('type-ok'))}.svg`]);
});

test('an upstream error, an empty body or a timeout is not cached', async () => {
  const dataDir = freshDir('errors');
  initIconCache(dataDir);
  stubCdn(() => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } }));
  assert.equal((await get(icon('missing'))).status, 502);
  stubCdn(() => svgResponse(''));
  assert.equal((await get(icon('empty'))).status, 502);
  stubCdn(() => { throw new DOMException('The operation timed out.', 'TimeoutError'); });
  assert.equal((await get(icon('slow'))).status, 504);
  stubCdn(() => { throw new TypeError('fetch failed'); });
  assert.equal((await get(icon('down'))).status, 502);
  assert.deepEqual(cacheFiles(dataDir), []);
});

// ── #255: the total-bytes cap ──────────────────────────────────────────────

test('JAGHELM_ICON_CACHE_MAX_MB sets the cap; a bad value keeps the 50 MB default', () => {
  assert.equal(DEFAULT_ICON_CACHE_MAX_BYTES, 50 * 1024 * 1024);
  assert.equal(resolveIconCacheMaxBytes({}), DEFAULT_ICON_CACHE_MAX_BYTES);
  assert.equal(resolveIconCacheMaxBytes({ JAGHELM_ICON_CACHE_MAX_MB: '10' }), 10 * 1024 * 1024);
  assert.equal(resolveIconCacheMaxBytes({ JAGHELM_ICON_CACHE_MAX_MB: '0.5' }), 512 * 1024);
  for (const bad of ['0', '-1', 'abc', 'Infinity', '']) {
    assert.equal(resolveIconCacheMaxBytes({ JAGHELM_ICON_CACHE_MAX_MB: bad }), DEFAULT_ICON_CACHE_MAX_BYTES, bad);
  }
  process.env.JAGHELM_ICON_CACHE_MAX_MB = '2';
  try {
    initIconCache(freshDir('env'));
    assert.equal(iconCacheStats().maxBytes, 2 * 1024 * 1024);
  } finally {
    delete process.env.JAGHELM_ICON_CACHE_MAX_MB;
  }
});

test('the cache is capped by total bytes and drops the least recently used icon', async () => {
  const dataDir = freshDir('lru');
  const SIZE = 1000;
  initIconCache(dataDir, { maxBytes: 3 * SIZE });
  stubCdn(() => svgResponse(svgOf(SIZE)));
  for (const slug of ['a', 'b', 'c']) assert.equal((await get(icon(slug))).status, 200);
  assert.deepEqual(iconCacheStats(), { count: 3, bytes: 3 * SIZE, maxBytes: 3 * SIZE });
  // Using a makes b the least recently used.
  assert.equal((await get(icon('a'))).headers['x-icon-cache'], 'HIT');
  assert.equal((await get(icon('d'))).status, 200);
  assert.ok(!existsSync(cachedPath(dataDir, icon('b'))), 'b was not evicted');
  for (const slug of ['a', 'c', 'd']) assert.ok(existsSync(cachedPath(dataDir, icon(slug))), slug);
  assert.deepEqual(iconCacheStats(), { count: 3, bytes: 3 * SIZE, maxBytes: 3 * SIZE });
  // b is fetched again when it is next asked for.
  assert.equal((await get(icon('b'))).headers['x-icon-cache'], 'MISS');
});

test('the cap counts what is already on disk at boot and trims the oldest first', async () => {
  const dataDir = freshDir('boot');
  const dir = join(dataDir, 'icon-cache');
  mkdirSync(dir, { recursive: true });
  const SIZE = 1000;
  const t0 = Date.now() / 1000 - 1000;
  const seeded = ['old1', 'old2', 'old3', 'old4'];
  seeded.forEach((slug, i) => {
    const p = cachedPath(dataDir, icon(slug));
    writeFileSync(p, svgOf(SIZE));
    utimesSync(p, t0 + i, t0 + i);
  });
  // A temp file a crash left mid-write, and a file that isn't the cache's.
  const temp = `${cachedPath(dataDir, icon('crashed'))}.tmp.123.456.abc`;
  writeFileSync(temp, 'partial');
  writeFileSync(join(dir, 'README.txt'), 'not an icon');

  initIconCache(dataDir, { maxBytes: 3 * SIZE });
  assert.deepEqual(iconCacheStats(), { count: 3, bytes: 3 * SIZE, maxBytes: 3 * SIZE });
  assert.ok(!existsSync(cachedPath(dataDir, icon('old1'))), 'the oldest file was kept');
  assert.ok(!existsSync(temp), 'the temp file was kept');
  assert.ok(existsSync(join(dir, 'README.txt')), 'a file that is not the cache\'s was removed');

  // A new icon evicts the next oldest of the files found at boot.
  stubCdn(() => svgResponse(svgOf(SIZE)));
  assert.equal((await get(icon('new'))).status, 200);
  assert.ok(!existsSync(cachedPath(dataDir, icon('old2'))));
  for (const slug of ['old3', 'old4', 'new']) assert.ok(existsSync(cachedPath(dataDir, icon(slug))), slug);
  assert.equal(iconCacheStats().bytes, 3 * SIZE);
});

test('concurrent requests never take the cache over its cap', async () => {
  const dataDir = freshDir('concurrent');
  const SIZE = 1000;
  initIconCache(dataDir, { maxBytes: 3 * SIZE + 10 });
  stubCdn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 20));
    return svgResponse(svgOf(SIZE));
  });
  const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => get(icon(`c${i}`))));
  // A 302 to the CDN when another icon evicted this one before it was sent:
  // this cache holds 3, so that can happen here.
  for (const r of responses) assert.ok([200, 302].includes(r.status), String(r.status));
  assert.ok(responses.filter((r) => r.status === 200).length >= 3);
  const onDisk = cacheFiles(dataDir).reduce((sum, f) => sum + statSync(join(dataDir, 'icon-cache', f)).size, 0);
  assert.ok(onDisk <= 3 * SIZE + 10, `${onDisk} bytes on disk`);
  assert.equal(iconCacheStats().bytes, onDisk, 'the count matches the disk');
  assert.equal(iconCacheStats().count, 3);
});

test('concurrent requests for one icon share one fetch', async () => {
  initIconCache(freshDir('dedupe'));
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = stubCdn(async () => {
    await gate;
    return svgResponse(SVG);
  });
  const pending = Promise.all(Array.from({ length: 5 }, () => get(ICON_URL)));
  // Long enough for all five to reach the handler; one that arrives later is a HIT anyway.
  setTimeout(release, 200);
  for (const r of await pending) {
    assert.equal(r.status, 200);
    assert.equal(r.body, SVG);
  }
  assert.deepEqual(calls, [ICON_URL]);
});

test('a cached file deleted behind the cache\'s back is fetched again, not a 500', async () => {
  const dataDir = freshDir('deleted');
  initIconCache(dataDir);
  const calls = stubCdn();
  assert.equal((await get(ICON_URL)).status, 200);
  unlinkSync(cachedPath(dataDir, ICON_URL));
  const r = await get(ICON_URL);
  assert.equal(r.status, 200);
  assert.equal(r.body, SVG);
  assert.equal(r.headers['x-icon-cache'], 'MISS');
  assert.equal(calls.length, 2);
  assert.ok(existsSync(cachedPath(dataDir, ICON_URL)));
  assert.equal(iconCacheStats().count, 1);
});

test('a file cached under a URL no longer accepted is counted, refused, and evicted first', async () => {
  const dataDir = freshDir('legacy');
  mkdirSync(join(dataDir, 'icon-cache'), { recursive: true });
  const OLD = 'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/gitea.svg';
  const oldPath = cachedPath(dataDir, OLD);
  writeFileSync(oldPath, svgOf(1000));
  const jpg = join(dataDir, 'icon-cache', `${hashOf('https://raw.githubusercontent.com/x/y/main/a.jpg')}.jpg`);
  writeFileSync(jpg, 'jpeg bytes');
  utimesSync(oldPath, Date.now() / 1000 - 100, Date.now() / 1000 - 100);
  initIconCache(dataDir, { maxBytes: 2000 });
  assert.equal(iconCacheStats().count, 2);
  const calls = stubCdn(() => svgResponse(svgOf(1000)));
  assert.equal((await get(OLD)).status, 403);
  assert.deepEqual(calls, []);
  assert.equal((await get(icon('current'))).status, 200);
  assert.ok(!existsSync(oldPath), 'the oldest file, the legacy one, is evicted first');
  assert.ok(existsSync(cachedPath(dataDir, icon('current'))));
});

test('a file an earlier version cached under another spelling of an accepted URL is reused, not fetched again', async () => {
  const dataDir = freshDir('adopt');
  mkdirSync(join(dataDir, 'icon-cache'), { recursive: true });
  // Before #255 the key was the URL exactly as the browser sent it.
  const asSent = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/gitea.svg?v=1';
  writeFileSync(cachedPath(dataDir, asSent), SVG);
  initIconCache(dataDir);
  const calls = stubCdn();
  const r = await get(asSent);
  assert.equal(r.status, 200);
  assert.equal(r.headers['x-icon-cache'], 'HIT');
  assert.equal(r.body, SVG);
  assert.deepEqual(calls, []);
  // It now lives under the canonical URL's name, for every spelling.
  assert.deepEqual(cacheFiles(dataDir), [`${hashOf(ICON_URL)}.svg`]);
  assert.equal((await get(ICON_URL)).headers['x-icon-cache'], 'HIT');
  assert.deepEqual(calls, []);
  assert.deepEqual(iconCacheStats(), { count: 1, bytes: SVG.length, maxBytes: DEFAULT_ICON_CACHE_MAX_BYTES });
});

// ── #255 review: memory across concurrent misses ───────────────────────────

/** Resolves once `cond()` holds, polling. */
const until = async (cond) => {
  while (!cond()) await new Promise((resolve) => setTimeout(resolve, 2));
};

test('no more than MAX_ICON_FETCHES upstream fetches run at once', async () => {
  assert.equal(MAX_ICON_FETCHES, 8);
  assert.equal(MAX_QUEUED_ICON_FETCHES, 256);
  const dataDir = freshDir('in-flight');
  initIconCache(dataDir);
  let running = 0;
  let peak = 0;
  stubCdn(async () => {
    running++;
    peak = Math.max(peak, running);
    // Hold the first fetches until every slot is busy, so the limit is reached
    // however slowly the requests arrive; then let them all through.
    await until(() => peak >= MAX_ICON_FETCHES);
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
    running--;
    return svgResponse(svgOf(1000));
  });
  const responses = await Promise.all(Array.from({ length: 40 }, (_, i) => get(icon(`f${i}`))));
  for (const r of responses) assert.equal(r.status, 200);
  assert.equal(peak, MAX_ICON_FETCHES, `${peak} fetches ran at once`);
  assert.equal(cacheFiles(dataDir).length, 40, 'every queued miss was fetched and cached in the end');
});

test('past the wait queue a miss is a 503 with Retry-After, and is not fetched', async () => {
  initIconCache(freshDir('queue-full'), { maxFetches: 2, maxQueued: 3 });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = stubCdn(async () => {
    await gate;
    return svgResponse(SVG);
  });
  const refused = [];
  const all = Array.from({ length: 8 }, (_, i) => request(app).get('/cached').query({ url: icon(`q${i}`) })
    .then((r) => { if (r.status === 503) refused.push(r); return r; }));
  // 2 fetching and 3 waiting: the other 3 are refused straight away.
  await until(() => refused.length === 3);
  assert.equal(calls.length, 2);
  for (const r of refused) {
    assert.equal(r.headers['retry-after'], '5');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.match(r.body.error, /busy/);
  }
  release();
  const results = await Promise.all(all);
  assert.equal(results.filter((r) => r.status === 200).length, 5);
  assert.equal(calls.length, 5, 'only the accepted misses were fetched');
});

test('requests for one icon share its fetch and take no slot or queue place', async () => {
  initIconCache(freshDir('coalesce-slot'), { maxFetches: 1, maxQueued: 0 });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = stubCdn(async () => {
    await gate;
    return svgResponse(SVG);
  });
  // .then() sends a supertest request; until then it is only built.
  const same = Array.from({ length: 5 }, () => get(ICON_URL).then((r) => r));
  await until(() => calls.length === 1);
  // The one slot is taken and nothing may wait: another icon is refused...
  assert.equal((await get(icon('other'))).status, 503);
  release();
  // ...but every request for the icon being fetched got it, from one fetch.
  for (const r of await Promise.all(same)) {
    assert.equal(r.status, 200);
    assert.equal(r.body, SVG);
  }
  assert.deepEqual(calls, [ICON_URL]);
});

test('an icon the cache could not store is a 302 to the CDN, not served from memory', async () => {
  const dataDir = freshDir('not-stored');
  initIconCache(dataDir, { maxBytes: 500 });
  stubCdn(() => svgResponse(svgOf(1000)));
  const r = await request(app).get('/cached').query({ url: `${icon('big-for-cache')}?v=1` });
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, icon('big-for-cache'));
  assert.equal(r.headers['x-icon-cache'], 'BYPASS');
  assert.equal(r.headers['cache-control'], 'no-store', 'may not last: ask the cache again next time');
  assert.deepEqual(cacheFiles(dataDir), []);
});

test('a miss is written from the chunks it was read in, and served from the file', async () => {
  const dataDir = freshDir('chunks');
  initIconCache(dataDir);
  const body = svgOf(200 * 1024);
  const bytes = Buffer.from(body);
  stubCdn(() => new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 7001) controller.enqueue(new Uint8Array(bytes.subarray(i, i + 7001)));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'image/svg+xml' } }));
  const r = await get(icon('chunked'));
  assert.equal(r.status, 200);
  assert.equal(r.body, body);
  assert.equal(r.headers['content-length'], String(bytes.length));
  assert.equal(r.headers['x-icon-cache'], 'MISS');
  assert.ok(r.headers['last-modified'], 'the miss was streamed from the file (sendFile), not written from memory');
  assert.equal(readFileSync(cachedPath(dataDir, icon('chunked')), 'utf8'), body);
  assert.equal(iconCacheStats().bytes, bytes.length);
});

// send stats a file and sets its headers before it opens it: a file that can't be
// opened then (evicted in between, or unreadable) fails with those headers set.
// Root opens a mode-000 file anyway, so this one runs only as another user.
test('a cached file that fails after send set its headers leaves none of them behind', {
  skip: process.getuid?.() === 0 && 'root can open a mode-000 file',
}, async () => {
  const dataDir = freshDir('open-fails');
  initIconCache(dataDir);
  stubCdn();
  assert.equal((await get(ICON_URL)).status, 200);
  const path = cachedPath(dataDir, ICON_URL);
  chmodSync(path, 0o000);
  try {
    // The fetch it falls back to finds the icon too large to cache: a 302 that
    // carries none of the unreadable file's headers.
    stubCdn(() => svgResponse(SVG, { 'content-length': String(MAX_ICON_BYTES + 1) }));
    const r = await request(app).get('/cached').query({ url: ICON_URL });
    assert.equal(r.status, 302);
    assert.equal(r.headers['content-length'], '0');
    assert.equal(r.headers['x-icon-cache'], 'BYPASS');
    for (const h of ['etag', 'last-modified', 'content-type', 'content-security-policy']) {
      assert.equal(r.headers[h], undefined, h);
    }
  } finally {
    try { chmodSync(path, 0o644); } catch { /* evicted */ }
  }
});

// ── #371: jsDelivr refuses some Dashboard Icons (403 "Package size exceeded") ──

const rawOf = (slug) => `https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/svg/${slug}.svg`;
const PACKAGE_TOO_BIG = () => new Response('Package size exceeded the configured limit of 50 MB.', {
  status: 403, headers: { 'content-type': 'text/plain' },
});

test('#371: an icon jsDelivr answers 403 for is fetched from raw.githubusercontent.com and cached under the jsDelivr URL', async () => {
  const dataDir = freshDir('fallback-403');
  initIconCache(dataDir);
  const calls = stubCdn((url) => (url.startsWith('https://cdn.jsdelivr.net/') ? PACKAGE_TOO_BIG() : svgResponse(SVG)));
  const r = await get(icon('gitea'));
  assert.equal(r.status, 200);
  assert.equal(r.headers['x-icon-cache'], 'MISS');
  assert.equal(r.body, SVG);
  assert.deepEqual(calls, [icon('gitea'), rawOf('gitea')]);
  assert.deepEqual(cacheFiles(dataDir), [`${hashOf(icon('gitea'))}.svg`]);
  // The next request is a hit: no CDN at all.
  const again = await get(icon('gitea'));
  assert.equal(again.headers['x-icon-cache'], 'HIT');
  assert.equal(calls.length, 2);
});

test('#371: a jsDelivr 5xx or network failure falls back to raw.githubusercontent.com too', async () => {
  initIconCache(freshDir('fallback-5xx'));
  stubCdn((url) => (url.startsWith('https://cdn.jsdelivr.net/')
    ? new Response('bad gateway', { status: 502, headers: { 'content-type': 'text/plain' } })
    : svgResponse(SVG)));
  assert.equal((await get(icon('a-502'))).status, 200);
  const calls = stubCdn((url) => {
    if (url.startsWith('https://cdn.jsdelivr.net/')) throw new TypeError('fetch failed');
    return svgResponse(SVG);
  });
  assert.equal((await get(icon('a-down'))).status, 200);
  assert.deepEqual(calls, [icon('a-down'), rawOf('a-down')]);
});

test('#371: a 404 is not retried, and a failing fallback is the failure', async () => {
  initIconCache(freshDir('fallback-none'));
  const calls = stubCdn(() => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } }));
  assert.equal((await get(icon('nope'))).status, 502);
  assert.deepEqual(calls, [icon('nope')]);
  const both = stubCdn(() => PACKAGE_TOO_BIG());
  assert.equal((await get(icon('both-down'))).status, 502);
  assert.deepEqual(both, [icon('both-down'), rawOf('both-down')]);
});

test('#371: a selfh.st icon falls back to its own repository, and a raw URL has no further fallback', async () => {
  initIconCache(freshDir('fallback-selfhst'));
  const calls = stubCdn((url) => (url.startsWith('https://cdn.jsdelivr.net/') ? PACKAGE_TOO_BIG() : svgResponse(SVG)));
  const selfhst = 'https://cdn.jsdelivr.net/gh/selfhst/icons@latest/svg/gitea.svg';
  assert.equal((await get(selfhst)).status, 200);
  assert.deepEqual(calls, [selfhst, 'https://raw.githubusercontent.com/selfhst/icons/main/svg/gitea.svg']);
  const raw = stubCdn(() => PACKAGE_TOO_BIG());
  assert.equal((await get(rawOf('only-raw'))).status, 502);
  assert.deepEqual(raw, [rawOf('only-raw')]);
});
