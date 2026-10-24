/**
 * The B2 bucket size job (#675): version accounting, pagination, the host
 * guard, a rejected key, backoff, one run at a time, the saved history and a
 * log that never holds the key.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  AUTHORIZE_URL,
  B2Error,
  BACKOFF_MS,
  BOOT_DELAY_MS,
  FRESH_MS,
  HISTORY_MAX,
  MAX_PAGES,
  RETRY_AFTER_MAX_MS,
  RUN_EVERY_MS,
  b2Answer,
  createB2Client,
  createB2Job,
  createB2Store,
  createTally,
  isB2Url,
  startB2Usage,
  stopB2Usage,
  weekChange,
} = await import('./b2.js');

const KEY_ID = '0012345abcdef'; // pragma: allowlist secret
const APP_KEY = 'K001-very-secret-application-key'; // pragma: allowlist secret
const TOKEN = 'tok-session-token-xyz'; // pragma: allowlist secret
const GB = 1_000_000_000;
const DAY = 86_400_000;

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'b2-'));
});
afterEach(() => {
  stopB2Usage();
  rmSync(dir, { recursive: true, force: true });
  for (const k of ['JAGHELM_B2_KEY_ID', 'JAGHELM_B2_APP_KEY', 'JAGHELM_B2_BUCKET']) delete process.env[k];
});

const up = (fileName, contentLength, uploadTimestamp, action = 'upload') => ({
  fileName,
  fileId: `id-${fileName}-${uploadTimestamp}`,
  contentLength,
  uploadTimestamp,
  action,
});
const res = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const AUTH_OK = {
  accountId: 'acct1',
  authorizationToken: TOKEN,
  apiInfo: {
    storageApi: {
      apiUrl: 'https://api003.backblazeb2.com',
      downloadUrl: 'https://f003.backblazeb2.com',
      allowed: { buckets: [{ id: 'bkt1', name: 'jagnet-homelab-backup' }], namePrefix: null, capabilities: ['listFiles'] },
    },
  },
};
const cfg = (fetchFn, now = () => 1_000) => ({
  keyId: KEY_ID,
  appKey: APP_KEY,
  bucket: 'jagnet-homelab-backup',
  fetchFn,
  now,
});
const SAMPLE = { liveBytes: 1, hiddenBytes: 0, files: 1, hiddenVersions: 0, prefixes: [] };

test('isB2Url takes only https hosts under backblazeb2.com', () => {
  assert.ok(isB2Url('https://api003.backblazeb2.com'));
  assert.ok(isB2Url('https://backblazeb2.com/x'));
  for (const bad of [
    'http://api003.backblazeb2.com',
    'https://evilbackblazeb2.com',
    'https://backblazeb2.com.evil.test',
    'https://api.backblazeb2.com@evil.test',
    'https://user:pw@api.backblazeb2.com',
    'https://api.backblazeb2.com:8443',
    'https://127.0.0.1',
    '//api.backblazeb2.com',
    '',
    undefined,
    42,
  ]) {
    assert.equal(isB2Url(bad), false, String(bad));
  }
});

test('the tally counts the newest version of each name and keeps older ones apart', () => {
  const t = createTally();
  for (const f of [
    up('FamilyVault/a.jpg', 100, 5000),
    up('FamilyVault/a.jpg', 70, 1000),
    up('FamilyVault/b.jpg', 0, 6000, 'hide'),
    up('FamilyVault/b.jpg', 40, 2000),
    up('immich-db/c.sql.gz', 10, 9000),
    up('top.txt', 5, 3000),
    up('big', 0, 100, 'start'),
    up('dir/', 0, 100, 'folder'),
  ]) {
    t.add(f);
  }
  const r = t.result();
  assert.equal(r.liveBytes, 100 + 10 + 5);
  assert.equal(r.hiddenBytes, 70 + 40);
  assert.equal(r.files, 3);
  assert.equal(r.hiddenVersions, 2);
  const by = Object.fromEntries(r.prefixes.map((p) => [p.name, p]));
  assert.equal(by.FamilyVault.bytes, 100);
  assert.equal(by.FamilyVault.lastUpload, 5000, 'the newest upload; a hide marker is no upload');
  assert.equal(by['immich-db'].lastUpload, 9000);
  assert.equal(by['(root)'].bytes, 5);
});

test('the tally ignores junk entries and bad numbers', () => {
  const t = createTally();
  for (const f of [null, 7, {}, { fileName: 3 }, { fileName: 'x/y', action: 'upload', contentLength: -5, uploadTimestamp: 'no' }]) {
    t.add(f);
  }
  const r = t.result();
  assert.equal(r.liveBytes, 0);
  assert.equal(r.files, 1);
});

test('a run authorizes, lists the pages in order and tallies them', async () => {
  const seen = [];
  const pages = [
    { files: [up('a/1', 10, 1), up('a/1', 4, 0)], nextFileName: 'a/2', nextFileId: 'idz' },
    { files: [up('a/2', 20, 2)], nextFileName: 'b/1', nextFileId: null },
    { files: [up('b/1', 30, 3)], nextFileName: null, nextFileId: null },
  ];
  let n = 0;
  const fetchFn = async (url, opts) => {
    seen.push({ url, opts });
    if (url === AUTHORIZE_URL) return res(200, AUTH_OK);
    return res(200, pages[n++]);
  };
  const out = await createB2Client(cfg(fetchFn)).sample();
  assert.equal(out.liveBytes, 60);
  assert.equal(out.hiddenBytes, 4);
  assert.equal(n, 3);
  const bodies = seen.slice(1).map((s) => JSON.parse(s.opts.body));
  assert.equal(bodies[0].startFileName, undefined);
  assert.deepEqual([bodies[1].startFileName, bodies[1].startFileId], ['a/2', 'idz']);
  assert.deepEqual([bodies[2].startFileName, bodies[2].startFileId], ['b/1', undefined]);
  assert.ok(bodies.every((b) => b.bucketId === 'bkt1'));
  assert.match(seen[0].opts.headers.Authorization, /^Basic /);
  assert.ok(seen.slice(1).every((s) => s.opts.headers.Authorization === TOKEN));
  assert.ok(seen.slice(1).every((s) => !JSON.stringify(s).includes(APP_KEY)));
  assert.ok(seen.every((s) => s.opts.trusted === false && s.opts.timeoutMs > 0));
});

test('requests go only to backblazeb2.com hosts', async () => {
  const hosts = new Set();
  const fetchFn = async (url) => {
    hosts.add(new URL(url).hostname);
    if (url === AUTHORIZE_URL) return res(200, AUTH_OK);
    return res(200, { files: [], nextFileName: null });
  };
  await createB2Client(cfg(fetchFn)).sample();
  assert.ok([...hosts].every((h) => h.endsWith('.backblazeb2.com')));
});

test('an apiUrl or downloadUrl off backblazeb2.com stops the run before any call to it', async () => {
  for (const storageApi of [
    { ...AUTH_OK.apiInfo.storageApi, apiUrl: 'https://api.evil.test' },
    { ...AUTH_OK.apiInfo.storageApi, downloadUrl: 'http://f003.backblazeb2.com' },
    { ...AUTH_OK.apiInfo.storageApi, apiUrl: 'https://backblazeb2.com.evil.test' },
  ]) {
    const urls = [];
    const fetchFn = async (url) => {
      urls.push(url);
      return res(200, { ...AUTH_OK, apiInfo: { storageApi } });
    };
    await assert.rejects(createB2Client(cfg(fetchFn)).sample(), (e) => e instanceof B2Error && e.kind === 'other');
    assert.deepEqual(urls, [AUTHORIZE_URL]);
  }
});

test('the bucket id comes from b2_list_buckets when the key does not name it', async () => {
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push(url.split('/').pop());
    if (url === AUTHORIZE_URL) {
      const { apiUrl, downloadUrl } = AUTH_OK.apiInfo.storageApi;
      return res(200, { ...AUTH_OK, apiInfo: { storageApi: { apiUrl, downloadUrl } } });
    }
    if (url.endsWith('b2_list_buckets')) {
      assert.deepEqual(JSON.parse(opts.body), { accountId: 'acct1', bucketName: 'jagnet-homelab-backup' });
      return res(200, { buckets: [{ bucketId: 'found1', bucketName: 'jagnet-homelab-backup' }] });
    }
    assert.equal(JSON.parse(opts.body).bucketId, 'found1');
    return res(200, { files: [up('x/y', 1, 1)], nextFileName: null });
  };
  const out = await createB2Client(cfg(fetchFn)).sample();
  assert.equal(out.liveBytes, 1);
  assert.deepEqual(calls, ['b2_authorize_account', 'b2_list_buckets', 'b2_list_file_versions']);
});

test('a bucket the key cannot see is an error that names the variable', async () => {
  const fetchFn = async (url) =>
    url === AUTHORIZE_URL
      ? res(200, { ...AUTH_OK, apiInfo: { storageApi: { ...AUTH_OK.apiInfo.storageApi, allowed: { buckets: [{ id: 'o', name: 'other' }], namePrefix: null } } } })
      : res(200, { buckets: [] });
  await assert.rejects(createB2Client(cfg(fetchFn)).sample(), /JAGHELM_B2_BUCKET/);
});

test('401 and 403 are a rejected key; other statuses and bad bodies are not', async () => {
  for (const status of [401, 403]) {
    await assert.rejects(
      createB2Client(cfg(async () => res(status, { code: 'bad_auth_token', message: APP_KEY }))).sample(),
      (e) => e.kind === 'auth' && !e.message.includes(APP_KEY)
    );
  }
  const later = async (url) => (url === AUTHORIZE_URL ? res(200, AUTH_OK) : res(403, {}));
  await assert.rejects(createB2Client(cfg(later)).sample(), (e) => e.kind === 'auth');
  for (const bad of [res(500, {}), res(200, 'not json'), res(200, { nothing: true })]) {
    await assert.rejects(createB2Client(cfg(async () => bad)).sample(), (e) => e instanceof B2Error && e.kind === 'other');
  }
  await assert.rejects(
    createB2Client(cfg(async () => { throw new Error(`connect ECONNREFUSED ${APP_KEY}`); })).sample(),
    (e) => e.kind === 'other' && !e.message.includes(APP_KEY)
  );
});

test('a listing past the page cap, or one that repeats a page, is stopped', async () => {
  let n = 0;
  const endless = async (url) =>
    url === AUTHORIZE_URL ? res(200, AUTH_OK) : (n++, res(200, { files: [], nextFileName: `f${n}`, nextFileId: 'i' }));
  await assert.rejects(createB2Client(cfg(endless)).sample(), /pages of files/);
  assert.equal(n, MAX_PAGES);
  const stuck = async (url) =>
    url === AUTHORIZE_URL ? res(200, AUTH_OK) : res(200, { files: [], nextFileName: 'same', nextFileId: 'i' });
  await assert.rejects(createB2Client(cfg(stuck)).sample(), /same page twice/);
});

test('a run past its deadline is stopped', async () => {
  let t = 0;
  const fetchFn = async (url) =>
    url === AUTHORIZE_URL ? res(200, AUTH_OK) : ((t += 100_000), res(200, { files: [], nextFileName: `f${t}`, nextFileId: 'i' }));
  await assert.rejects(createB2Client(cfg(fetchFn, () => t)).sample(), /too long/);
});

test('the saved history keeps one point a day, at most 90, and survives a restart', () => {
  const path = join(dir, 'b2.json');
  const sample = (live) => ({ liveBytes: live, hiddenBytes: 5, files: 3, hiddenVersions: 1, prefixes: [{ name: 'x', bytes: live, files: 3, lastUpload: 7 }] });
  const store = createB2Store({ path, bucket: 'bkt' });
  const day0 = 20_000 * DAY;
  store.recordSuccess(day0 + 1000, sample(1));
  store.recordSuccess(day0 + 5000, sample(2));
  assert.deepEqual(store.state().history.map((p) => p.live), [2], 'the same UTC day replaces');
  for (let i = 1; i <= 120; i++) store.recordSuccess(day0 + i * DAY, sample(100 + i));
  assert.equal(store.state().history.length, HISTORY_MAX);
  assert.equal(store.state().history.at(-1).live, 220);
  const again = createB2Store({ path, bucket: 'bkt' });
  assert.equal(again.state().history.length, HISTORY_MAX);
  assert.equal(again.state().latest.live, 220);
  assert.equal(createB2Store({ path, bucket: 'other' }).state().latest, null);
  writeFileSync(path, '{nope');
  assert.deepEqual(createB2Store({ path, bucket: 'bkt' }).state().history, []);
});

test('a hand-damaged file loads only its good parts', () => {
  const path = join(dir, 'b2.json');
  writeFileSync(
    path,
    JSON.stringify({
      bucket: 'bkt',
      latest: { at: 5, live: 'x', hidden: -1, files: 2.9, prefixes: [{ name: 3 }, { name: 'ok', bytes: 4 }] },
      history: [null, { t: 'a' }, { t: 3, live: 9 }],
      error: { kind: 'weird', at: 1 },
    })
  );
  const s = createB2Store({ path, bucket: 'bkt' }).state();
  assert.deepEqual(s.history.map((p) => p.t), [3]);
  assert.equal(s.latest.live, 0);
  assert.equal(s.latest.files, 2);
  assert.deepEqual(s.latest.prefixes.map((p) => p.name), ['ok']);
  assert.equal(s.error, null);
});

test('the week change needs a point 6 to 8 days back', () => {
  const h = (d, live) => ({ t: d * DAY, live });
  assert.equal(weekChange([]), null);
  assert.equal(weekChange([h(10, 5)]), null);
  assert.equal(weekChange([h(5, 5), h(10, 9)]), null, 'only 5 days');
  assert.equal(weekChange([h(3, 1), h(10, 9)]), 8, 'the point 7 days back');
  assert.equal(weekChange([h(0, 1), h(10, 9)]), null, 'a point 10 days back is no week');
  assert.equal(weekChange([h(2, 20), h(3, 18), h(10, 9)]), -11, 'the oldest within 8 days: shrinking');
});

function harness(client = { sample: async () => SAMPLE }) {
  const logs = [];
  const logger = { warn: (...a) => logs.push(['warn', ...a]), info: (...a) => logs.push(['info', ...a]), error: (...a) => logs.push(['error', ...a]), debug() {} };
  const timers = [];
  const store = createB2Store({ path: join(dir, 'b2.json'), bucket: 'bkt' });
  let clock = 50 * DAY;
  const job = createB2Job({
    client,
    store,
    logger,
    now: () => clock,
    setTimer: (fn, ms) => {
      const t = { fn, ms, unref() {} };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      if (t) t.cleared = true;
    },
  });
  return { job, store, logs, timers, advance: (ms) => (clock += ms) };
}

test('two runs at once are one request cycle', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((r) => (release = r));
  const h = harness({ sample: async () => { calls++; await gate; return SAMPLE; } });
  const a = h.job.run();
  const b = h.job.run();
  assert.equal(a, b);
  assert.ok(h.job.inFlight());
  release();
  await Promise.all([a, b]);
  assert.equal(calls, 1);
  assert.ok(!h.job.inFlight());
  assert.equal(h.store.state().latest.live, 1);
});

test('a good run schedules the next a day on; a boot run waits its delay', async () => {
  const h = harness();
  h.job.start();
  assert.equal(h.timers.at(-1).ms, BOOT_DELAY_MS);
  await h.job.run();
  assert.equal(h.timers.at(-1).ms, RUN_EVERY_MS);
});

test('a restart soon after a good sample does not read B2 again right away', async () => {
  const h = harness();
  await h.job.run();
  h.advance(60 * 60_000);
  h.job.start();
  assert.equal(h.timers.at(-1).ms, RUN_EVERY_MS - 60 * 60_000);
  h.advance(FRESH_MS);
  h.job.start();
  assert.equal(h.timers.at(-1).ms, BOOT_DELAY_MS);
});

test('failures back off, doubling to a ceiling, longer for a rejected key; success resets', async () => {
  let mode = 'other';
  const h = harness({
    sample: async () => {
      if (mode === 'ok') return SAMPLE;
      throw new B2Error(mode, mode === 'auth' ? 'Backblaze refused the key' : 'Backblaze did not answer');
    },
  });
  const waits = [];
  for (let i = 0; i < 8; i++) {
    await h.job.run();
    waits.push(h.timers.at(-1).ms);
  }
  assert.equal(waits[0], BACKOFF_MS.other[0]);
  assert.equal(waits[1], BACKOFF_MS.other[0] * 2);
  assert.equal(waits.at(-1), BACKOFF_MS.other[1]);
  assert.equal(h.store.state().error.kind, 'other');
  mode = 'ok';
  await h.job.run();
  assert.equal(h.timers.at(-1).ms, RUN_EVERY_MS);
  assert.equal(h.store.state().error, null);
  assert.ok(h.logs.some((l) => l[0] === 'info'), 'says when it works again');
  mode = 'auth';
  await h.job.run();
  assert.equal(h.timers.at(-1).ms, BACKOFF_MS.auth[0]);
  await h.job.run();
  await h.job.run();
  assert.equal(h.timers.at(-1).ms, BACKOFF_MS.auth[1]);
});

test('a rejected key warns once per attempt, in fixed words', async () => {
  const h = harness({ sample: async () => { throw new B2Error('auth', 'Backblaze refused the key'); } });
  await h.job.run();
  const warns = h.logs.filter((l) => l[0] === 'warn');
  assert.equal(warns.length, 1);
  assert.match(JSON.stringify(warns[0]), /B2 key rejected/);
  assert.equal(h.logs.length, 1);
});

test('nothing secret reaches the logs, the saved file or the answer, even when the failure carries it', async () => {
  process.env.JAGHELM_B2_KEY_ID = KEY_ID;
  process.env.JAGHELM_B2_APP_KEY = APP_KEY;
  process.env.JAGHELM_B2_BUCKET = 'jagnet-homelab-backup';
  const logs = [];
  const logger = { warn: (...a) => logs.push(a), info: (...a) => logs.push(a), error: (...a) => logs.push(a), debug: (...a) => logs.push(a) };
  const path = join(dir, 'b2.json');
  for (const fetchFn of [
    async () => res(401, { code: 'bad_auth_token', message: `key ${APP_KEY} ${TOKEN}` }),
    async () => { throw new Error(`boom ${APP_KEY} ${TOKEN} ${KEY_ID}`); },
    async (url) => (url === AUTHORIZE_URL ? res(200, AUTH_OK) : res(500, `${APP_KEY} ${TOKEN}`)),
  ]) {
    const store = createB2Store({ path, bucket: 'jagnet-homelab-backup', logger });
    const job = createB2Job({ client: createB2Client(cfg(fetchFn)), store, logger, setTimer: () => ({ unref() {} }), clearTimer() {} });
    await job.run();
  }
  const started = startB2Usage({ logger, deps: { store: createB2Store({ path, bucket: 'jagnet-homelab-backup', logger }), client: createB2Client(cfg(async () => res(401, {}))) } });
  await started.job.run();
  const everything = JSON.stringify([logs, existsSync(path) ? readFileSync(path, 'utf8') : '', b2Answer()]);
  for (const secret of [APP_KEY, TOKEN]) assert.ok(!everything.includes(secret), secret);
  assert.equal(b2Answer().error, 'key-rejected');
});

test('without the three variables there is no part 2; with some, a warning that names them', () => {
  const logs = [];
  const logger = { warn: (...a) => logs.push(a), info() {}, error() {}, debug() {} };
  assert.equal(startB2Usage({ logger }), null);
  assert.deepEqual(b2Answer(), { configured: false });
  assert.equal(logs.length, 0);
  process.env.JAGHELM_B2_KEY_ID = KEY_ID;
  assert.equal(startB2Usage({ logger }), null);
  assert.deepEqual(b2Answer(), { configured: false });
  assert.match(String(logs[0][0]), /JAGHELM_B2_KEY_ID.*JAGHELM_B2_APP_KEY.*JAGHELM_B2_BUCKET/);
  assert.ok(!JSON.stringify(logs).includes(KEY_ID));
});

test('the answer: pending before the first sample, then the saved numbers and sparkline', async () => {
  process.env.JAGHELM_B2_KEY_ID = KEY_ID;
  process.env.JAGHELM_B2_APP_KEY = APP_KEY;
  process.env.JAGHELM_B2_BUCKET = 'bkt';
  const store = createB2Store({ path: join(dir, 'b2.json'), bucket: 'bkt' });
  const sample = { liveBytes: 210 * GB, hiddenBytes: 3 * GB, files: 9, hiddenVersions: 2, prefixes: [{ name: 'FamilyVault', bytes: 5, files: 1, lastUpload: 77 }] };
  const started = startB2Usage({ deps: { store, client: { sample: async () => sample } } });
  assert.deepEqual(b2Answer(), { configured: true, bucket: 'bkt', pending: true, error: null, checkedAt: null });
  await started.job.run();
  const a = b2Answer();
  assert.equal(a.liveBytes, 210 * GB);
  assert.equal(a.hiddenBytes, 3 * GB);
  assert.equal(a.prefixes[0].name, 'FamilyVault');
  assert.equal(a.history.length, 1);
  assert.equal(a.error, null);
});

test('an unfinished large file (start) does not push the live upload into hidden bytes', () => {
  const t = createTally();
  t.add(up('big/file.bin', 0, 9000, 'start'));
  t.add(up('big/file.bin', 300, 5000));
  t.add(up('big/file.bin', 200, 1000));
  t.add(up('dir/', 0, 1, 'folder'));
  const r = t.result();
  assert.equal(r.liveBytes, 300);
  assert.equal(r.hiddenBytes, 200);
  assert.equal(r.files, 1);
});

test('a key limited to a name prefix lists only that prefix and says so, not "key rejected"', async () => {
  const bodies = [];
  const fetchFn = async (url, opts) => {
    if (url === AUTHORIZE_URL) {
      const api = AUTH_OK.apiInfo.storageApi;
      return res(200, { ...AUTH_OK, apiInfo: { storageApi: { ...api, allowed: { ...api.allowed, namePrefix: 'FamilyVault/' } } } });
    }
    bodies.push(JSON.parse(opts.body));
    return res(200, { files: [up('FamilyVault/a', 7, 1)], nextFileName: null });
  };
  const out = await createB2Client(cfg(fetchFn)).sample();
  assert.equal(bodies[0].prefix, 'FamilyVault/');
  assert.equal(out.restrictedTo, 'FamilyVault/');
  assert.equal(out.liveBytes, 7);
});

test('the older shape of the authorize answer (bucket beside the urls) still works', async () => {
  const fetchFn = async (url, opts) => {
    if (url === AUTHORIZE_URL) {
      const { apiUrl, downloadUrl } = AUTH_OK.apiInfo.storageApi;
      return res(200, { ...AUTH_OK, apiInfo: { storageApi: { apiUrl, downloadUrl, bucketId: 'old1', bucketName: 'jagnet-homelab-backup' } } });
    }
    assert.equal(JSON.parse(opts.body).bucketId, 'old1');
    return res(200, { files: [], nextFileName: null });
  };
  await createB2Client(cfg(fetchFn)).sample();
});

test('a redirect from Backblaze is refused, never followed', async () => {
  let opts;
  const fetchFn = async (url, o) => {
    opts = o;
    return { status: 302, ok: false, headers: { get: () => 'https://evil.test/' }, text: async () => '' };
  };
  await assert.rejects(createB2Client(cfg(fetchFn)).sample(), (e) => e instanceof B2Error && /redirect/.test(e.message));
  assert.equal(opts.noRedirects, true);
});

test('Retry-After on 429/503 is honoured up to a cap; without it the normal backoff', async () => {
  const mk = (status, retry) => async () => ({ status, ok: false, headers: { get: () => retry }, text: async () => '' });
  for (const [retry, want] of [['120', 120_000], ['999999', RETRY_AFTER_MAX_MS]]) {
    const h = harness(createB2Client(cfg(mk(429, retry))));
    await h.job.run();
    assert.equal(h.timers.at(-1).ms, want);
  }
  const h = harness(createB2Client(cfg(mk(503, null))));
  await h.job.run();
  assert.equal(h.timers.at(-1).ms, BACKOFF_MS.other[0]);
});

test('the real fetch helper with noRedirects throws on a 3xx instead of following it', async () => {
  const { fetchSafe } = await import('./util/safeFetchCore.js');
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('', { status: 302, headers: { location: 'https://api2.backblazeb2.com/x' } });
  };
  try {
    await assert.rejects(fetchSafe('https://api.backblazeb2.com/x', {}, { trusted: false, noRedirects: true }), /redirect refused/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = real;
  }
});
