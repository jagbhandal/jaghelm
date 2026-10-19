/**
 * #261: the icon cache lives in the data dir, `JAGHELM_DATA_DIR` like every other
 * store, not always in the checkout's own data/. Drives handleCachedIcon through
 * a bare Express app; the CDN is a stubbed fetch, so no request leaves the box.
 * (That index.js boots it in JAGHELM_DATA_DIR is in icons.boot.test.js.)
 */
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import express from 'express';
import request from 'supertest';

const root = mkdtempSync(join(tmpdir(), 'jh-icon-cache-'));
process.env.JAGHELM_DATA_DIR = join(root, 'default'); // before the import: the module's default
const { initIconCache, handleCachedIcon } = await import('./icon-cache.js');

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
after(() => rmSync(root, { recursive: true, force: true }));

const app = express();
app.get('/cached', handleCachedIcon);

const ICON_URL = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/gitea.svg';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><title>gitea</title></svg>';
const hashOf = (url) => createHash('sha256').update(url).digest('hex');
const cachedPath = (dataDir, url) => join(dataDir, 'icon-cache', `${hashOf(url)}.svg`);
const get = (url) => request(app).get('/cached').query({ url }).buffer(true).parse((res, cb) => {
  let body = '';
  res.on('data', (c) => { body += c; });
  res.on('end', () => cb(null, body));
});

function stubCdn() {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(SVG, { status: 200, headers: { 'content-type': 'image/svg+xml' } });
  };
  return calls;
}

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
