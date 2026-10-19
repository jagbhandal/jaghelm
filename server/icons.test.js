/**
 * Icon index (#242): boot reads the persisted names-only index and never calls
 * GitHub; the first icon search builds it, a stale one refreshes conditionally
 * (If-None-Match) in the background, and a failed, rate-limited or oversized
 * refresh keeps the index it had. GitHub is a mocked global fetch throughout.
 */
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

const root = mkdtempSync(join(tmpdir(), 'jh-icons-'));
process.env.JAGHELM_DATA_DIR = root; // no auth.json here, so auth is off for the route test
delete process.env.DASH_PASS;

const icons = await import('./icons.js');
const { iconRoutes } = await import('./routes/icons.js');
const {
  initIconIndex, ensureIconIndex, searchIcons, getIconCount, _iconRefreshSettled,
  ICON_INDEX_FILE, REFRESH_INTERVAL_MS, RETRY_AFTER_FAILURE_MS, MAX_LISTING_BYTES,
} = icons;

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
after(() => rmSync(root, { recursive: true, force: true }));

const HOUR = 60 * 60 * 1000;
let clock = Date.UTC(2026, 9, 19, 12);
const now = () => clock;

let n = 0;
const freshDir = () => mkdtempSync(join(root, `case-${n++}-`));

const DASH = 'dashboard-icons';
const SELF = 'selfhst';
const repoOf = (url) => (url.includes('homarr-labs/dashboard-icons') ? DASH : SELF);

/** A git-trees listing of one repo's svg/ directory, as GitHub returns it. */
function listing(files, etag) {
  const tree = files.map((path) => ({ path, mode: '100644', type: 'blob', sha: 'x', size: 1 }));
  return new Response(JSON.stringify({ sha: 'x', url: 'x', tree, truncated: false }), {
    status: 200, headers: { 'content-type': 'application/json', etag },
  });
}

/** Mock GitHub: handlers[repo](call) returns the Response; every call is recorded. */
function mockGitHub(handlers) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), headers: new Headers(init.headers) };
    calls.push(call);
    return handlers[repoOf(call.url)](call);
  };
  return calls;
}

function persist(dir, repos) {
  writeFileSync(join(dir, ICON_INDEX_FILE), JSON.stringify({ version: 1, repos }));
}
const readPersisted = (dir) => JSON.parse(readFileSync(join(dir, ICON_INDEX_FILE), 'utf8'));

const freshRepos = () => ({
  [DASH]: { etag: 'W/"d1"', checkedAt: clock, slugs: ['plex', 'sonarr'] },
  [SELF]: { etag: 'W/"s1"', checkedAt: clock, slugs: ['plex', 'jellyseerr'] },
});

test('boot reads a persisted index and makes no request', async () => {
  const dir = freshDir();
  persist(dir, freshRepos());
  const calls = mockGitHub({});

  await initIconIndex({ dataDir: dir, now });
  await ensureIconIndex(); // a search on a fresh index doesn't refresh it either
  assert.equal(calls.length, 0, 'GitHub was called');

  assert.equal(getIconCount(), 3, 'plex is in both repositories and counted once');
  assert.deepEqual(searchIcons('plex'), [{
    name: 'Plex', slug: 'plex', repo: DASH, repoLabel: 'Dashboard Icons',
    url: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/plex.svg',
  }]);
  assert.deepEqual(searchIcons('jelly').map((i) => i.url),
    ['https://cdn.jsdelivr.net/gh/selfhst/icons@latest/svg/jellyseerr.svg']);
  assert.deepEqual(searchIcons('').map((i) => i.slug), ['jellyseerr', 'plex', 'sonarr'], 'sorted by name');
});

test('boot with no index makes no request; the first search builds and persists it', async () => {
  const dir = freshDir();
  const calls = mockGitHub({
    [DASH]: () => listing(['plex.svg', 'home-assistant.svg', 'README.md'], 'W/"d1"'),
    [SELF]: () => listing(['plex.svg', 'jellyseerr.svg'], 'W/"s1"'),
  });

  await initIconIndex({ dataDir: dir, now });
  assert.equal(calls.length, 0, 'boot called GitHub');
  assert.equal(getIconCount(), 0);

  await ensureIconIndex(); // no index at all: the first search waits for it
  assert.deepEqual(calls.map((c) => c.url).sort(), [
    'https://api.github.com/repos/homarr-labs/dashboard-icons/git/trees/main:svg',
    'https://api.github.com/repos/selfhst/icons/git/trees/main:svg',
  ], 'lists only the svg/ directory, not the whole repository recursively');
  for (const c of calls) assert.equal(c.headers.get('if-none-match'), null);

  assert.deepEqual(searchIcons('').map((i) => [i.slug, i.repo]),
    [['home-assistant', DASH], ['jellyseerr', SELF], ['plex', DASH]]);
  assert.equal(searchIcons('home assistant')[0].name, 'Home Assistant', 'matches the display name too');

  const saved = readPersisted(dir);
  assert.equal(saved.version, 1);
  assert.deepEqual(saved.repos[DASH], { etag: 'W/"d1"', checkedAt: clock, slugs: ['plex', 'home-assistant'] });
  assert.deepEqual(saved.repos[SELF], { etag: 'W/"s1"', checkedAt: clock, slugs: ['plex', 'jellyseerr'] });

  // The next boot reuses it without a request.
  await initIconIndex({ dataDir: dir, now });
  await ensureIconIndex();
  assert.equal(calls.length, 2, 'a later boot or search called GitHub again');
  assert.equal(getIconCount(), 3);
});

test('a stale index refreshes with If-None-Match in the background and serves the old one meanwhile', async () => {
  const dir = freshDir();
  const stale = clock - REFRESH_INTERVAL_MS - 1;
  persist(dir, {
    [DASH]: { etag: 'W/"d1"', checkedAt: stale, slugs: ['plex', 'sonarr'] },
    [SELF]: { etag: 'W/"s1"', checkedAt: stale, slugs: ['jellyseerr'] },
  });
  let release;
  const gate = new Promise((r) => { release = r; });
  const calls = mockGitHub({
    [DASH]: async () => { await gate; return new Response(null, { status: 304, headers: { etag: 'W/"d1"' } }); },
    [SELF]: async () => { await gate; return listing(['jellyseerr.svg', 'immich.svg'], 'W/"s2"'); },
  });

  await initIconIndex({ dataDir: dir, now });
  await ensureIconIndex(); // returns while GitHub hasn't answered
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.headers.get('if-none-match')).sort(), ['W/"d1"', 'W/"s1"']);
  assert.deepEqual(searchIcons('').map((i) => i.slug), ['jellyseerr', 'plex', 'sonarr'], 'old index served');

  await ensureIconIndex(); // a second search while it runs doesn't start another
  assert.equal(calls.length, 2);

  release();
  await _iconRefreshSettled();
  assert.deepEqual(searchIcons('').map((i) => i.slug), ['immich', 'jellyseerr', 'plex', 'sonarr'],
    '304 kept dashboard-icons, 200 replaced selfhst');
  const saved = readPersisted(dir);
  assert.deepEqual(saved.repos[DASH], { etag: 'W/"d1"', checkedAt: clock, slugs: ['plex', 'sonarr'] });
  assert.deepEqual(saved.repos[SELF], { etag: 'W/"s2"', checkedAt: clock, slugs: ['jellyseerr', 'immich'] });
});

test('a failed or rate-limited refresh keeps the index, logs once, and waits an hour', async () => {
  const dir = freshDir();
  const stale = clock - REFRESH_INTERVAL_MS - 1;
  persist(dir, {
    [DASH]: { etag: 'W/"d1"', checkedAt: stale, slugs: ['plex'] },
    [SELF]: { etag: 'W/"s1"', checkedAt: stale, slugs: ['jellyseerr'] },
  });
  const before = readFileSync(join(dir, ICON_INDEX_FILE), 'utf8');
  const limited = () => new Response('{"message":"API rate limit exceeded"}', {
    status: 403, headers: { 'x-ratelimit-remaining': '0' },
  });
  let calls = mockGitHub({ [DASH]: limited, [SELF]: () => { throw new TypeError('fetch failed'); } });

  const warned = [];
  const realWrite = process.stderr.write;
  process.stderr.write = (chunk, ...rest) => {
    if (String(chunk).includes('"module":"icons"')) { warned.push(JSON.parse(String(chunk))); return true; }
    return realWrite.call(process.stderr, chunk, ...rest);
  };
  try {
    await initIconIndex({ dataDir: dir, now });
    await ensureIconIndex();
    await _iconRefreshSettled();
    assert.equal(calls.length, 2);
    assert.deepEqual(searchIcons('').map((i) => i.slug), ['jellyseerr', 'plex'], 'old index kept');
    assert.equal(readFileSync(join(dir, ICON_INDEX_FILE), 'utf8'), before, 'file rewritten after a failure');
    assert.equal(warned.length, 1, 'one warning for the failed refresh');
    assert.match(JSON.stringify(warned[0]), /403/);

    clock += RETRY_AFTER_FAILURE_MS - 1;
    await ensureIconIndex();
    await _iconRefreshSettled();
    assert.equal(calls.length, 2, 'retried within the hour');

    clock += 1;
    await ensureIconIndex();
    await _iconRefreshSettled();
    assert.equal(calls.length, 4, 'not retried after the hour');
    assert.equal(warned.length, 1, 'a second failure in a row logged again');

    calls = mockGitHub({
      [DASH]: () => new Response(null, { status: 304 }),
      [SELF]: () => new Response(null, { status: 304 }),
    });
    clock += RETRY_AFTER_FAILURE_MS;
    await ensureIconIndex();
    await _iconRefreshSettled();
    assert.equal(calls.length, 2);
    assert.equal(readPersisted(dir).repos[DASH].checkedAt, clock, 'recovered refresh was not persisted');
    assert.deepEqual(searchIcons('').map((i) => i.slug), ['jellyseerr', 'plex']);
  } finally {
    process.stderr.write = realWrite;
  }
});

test('a listing over the body cap is refused and the old index kept', async () => {
  const dir = freshDir();
  const stale = clock - REFRESH_INTERVAL_MS - 1;
  persist(dir, {
    [DASH]: { etag: null, checkedAt: stale, slugs: ['plex'] },
    [SELF]: { etag: null, checkedAt: clock, slugs: ['jellyseerr'] },
  });
  let sent = 0;
  const calls = mockGitHub({
    // No content-length, so only reading the body can find out how big it is. It
    // would go on to 4x the cap (endless, as far as the reader can tell).
    [DASH]: () => new Response(new ReadableStream({
      pull(c) {
        if (sent >= 4 * MAX_LISTING_BYTES) return c.close();
        const chunk = new Uint8Array(1024 * 1024).fill(0x20);
        sent += chunk.length;
        c.enqueue(chunk);
      },
    }), { status: 200 }),
  });

  await initIconIndex({ dataDir: dir, now });
  await ensureIconIndex();
  await _iconRefreshSettled();
  assert.equal(calls.length, 1, 'only the stale repository is refreshed');
  assert.ok(sent < 2 * MAX_LISTING_BYTES, `read ${sent} bytes, far past the cap`);
  assert.deepEqual(searchIcons('').map((i) => i.slug), ['jellyseerr', 'plex']);
});

test('a corrupt or tampered index file is ignored, not trusted', async () => {
  const calls = mockGitHub({});

  const corrupt = freshDir();
  writeFileSync(join(corrupt, ICON_INDEX_FILE), '{"version":1,"repos":{');
  await initIconIndex({ dataDir: corrupt, now });
  assert.equal(getIconCount(), 0);

  const tampered = freshDir();
  persist(tampered, {
    [DASH]: { etag: 7, checkedAt: clock + HOUR, slugs: ['ok', '../etc/passwd', 'a b', '<svg onload=x>', 42, 'x'.repeat(200)] },
    [SELF]: 'nope',
  });
  await initIconIndex({ dataDir: tampered, now });
  assert.equal(calls.length, 0);
  assert.deepEqual(searchIcons('').map((i) => i.slug), ['ok']);

  // A checkedAt from the future can't postpone the refresh forever: it counts as stale.
  const refreshed = mockGitHub({
    [DASH]: () => listing(['ok.svg', 'plex.svg'], 'W/"d2"'),
    [SELF]: () => listing(['immich.svg'], 'W/"s2"'),
  });
  await ensureIconIndex();
  await _iconRefreshSettled();
  assert.equal(refreshed.length, 2);
  for (const c of refreshed) assert.equal(c.headers.get('if-none-match'), null, 'sent a tampered etag');
  assert.deepEqual(searchIcons('').map((i) => i.slug), ['immich', 'ok', 'plex']);
});

test('a listing with no icons, or not a listing at all, keeps the old index', async () => {
  const dir = freshDir();
  const stale = clock - REFRESH_INTERVAL_MS - 1;
  persist(dir, {
    [DASH]: { etag: null, checkedAt: stale, slugs: ['plex'] },
    [SELF]: { etag: null, checkedAt: stale, slugs: ['jellyseerr'] },
  });
  mockGitHub({
    [DASH]: () => listing(['README.md'], 'W/"d2"'),
    [SELF]: () => new Response('{"message":"Not Found"}', { status: 200 }),
  });
  await initIconIndex({ dataDir: dir, now });
  await ensureIconIndex();
  await _iconRefreshSettled();
  assert.deepEqual(searchIcons('').map((i) => i.slug), ['jellyseerr', 'plex']);
  assert.equal(readPersisted(dir).repos[DASH].checkedAt, stale);
});

test('GET /api/icons: the first search waits for the index, a failure answers empty', async () => {
  const app = express();
  app.use('/api/icons', iconRoutes);

  const dir = freshDir();
  mockGitHub({
    [DASH]: () => listing(['plex.svg', 'portainer.svg'], 'W/"d1"'),
    [SELF]: () => listing(['plex.svg', 'pihole.svg'], 'W/"s1"'),
  });
  await initIconIndex({ dataDir: dir, now });
  const r = await request(app).get('/api/icons?q=p&limit=2');
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 3);
  assert.deepEqual(r.body.results.map((i) => i.slug), ['pihole', 'plex']);
  assert.ok(existsSync(join(dir, ICON_INDEX_FILE)));

  const offline = freshDir();
  mockGitHub({ [DASH]: () => { throw new TypeError('fetch failed'); }, [SELF]: () => { throw new TypeError('fetch failed'); } });
  await initIconIndex({ dataDir: offline, now });
  const r2 = await request(app).get('/api/icons?q=plex');
  assert.equal(r2.status, 200);
  assert.deepEqual(r2.body, { count: 0, results: [] });
  assert.equal(existsSync(join(offline, ICON_INDEX_FILE)), false);
});
