/**
 * #547: the display config saves only over the version a device read, as
 * services.yaml does (#423), with the same mechanism (util/fileVersion.js).
 *
 * POST /api/display-config replaced display-config.json with whatever a
 * device sent. A device open from before another's change posted its old
 * copy, so a section hidden elsewhere came back. Now GET answers the file's
 * version (an HMAC-SHA256 of its bytes with the per-install key) as a strong
 * ETag, and the POST must carry it back in If-Match: none is a 428, an old one
 * a 409 with the version now, and nothing is written either way. A missing
 * file's version takes the first save. The GET's ETag is that version, so a
 * poll's If-None-Match still gets a 304.
 *
 * These drive the real route against the real file.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

const { displayConfigRoutes } = await import('./displayConfig.js');
const { stopBackgroundRefresh } = await import('../refresh.js');

after(() => stopBackgroundRefresh());

const DIR = process.env.JAGHELM_DATA_DIR;
const PATH = join(DIR, 'display-config.json');
const KEY_PATH = join(DIR, 'config-version.key');

const app = express();
app.disable('etag'); // as index.js: no ETag but the routes' own
app.use(express.json());
app.use('/api/display-config', displayConfigRoutes);

const read = (headers = {}) => request(app).get('/api/display-config').set(headers);
const write = (body, version) => {
  const r = request(app).post('/api/display-config');
  if (version !== undefined) r.set('If-Match', version);
  return r.send(body);
};

/** The file's version as the server makes it: an HMAC-SHA256 of its bytes, as an ETag. */
const fileVersion = () =>
  `"${createHmac('sha256', readFileSync(KEY_PATH)).update(readFileSync(PATH)).digest('base64url')}"`;
const fileText = () => readFileSync(PATH, 'utf8');
/** Put `config` on disk, as a hand edit or another device's save would. */
const onDisk = (config) => writeFileSync(PATH, JSON.stringify(config, null, 2));

const START = { refreshInterval: 30, theme: 'dark', overviewSections: { services: true } };

test("GET answers the file's version as a strong ETag, and a write must send exactly that", async () => {
  onDisk(START);
  const r = await read();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, START);
  assert.equal(r.headers.etag, fileVersion());
  assert.match(r.headers.etag, /^"[A-Za-z0-9_-]{43}"$/);

  const saved = await write({ ...START, theme: 'light' }, r.headers.etag);
  assert.equal(saved.status, 200, saved.text);
  assert.equal(JSON.parse(fileText()).theme, 'light');
  // The answer is the new version, the one the next read answers.
  assert.equal(saved.headers.etag, fileVersion());
  assert.notEqual(saved.headers.etag, r.headers.etag);
  assert.equal((await read()).headers.etag, saved.headers.etag);
});

test("the version is the same key's HMAC as services.yaml's, so it survives a restart", async () => {
  onDisk(START);
  const key = readFileSync(KEY_PATH);
  assert.equal(key.length, 32);
  const want = `"${createHmac('sha256', key).update(fileText()).digest('base64url')}"`;
  assert.equal((await read()).headers.etag, want);
});

test('a poll with the ETag it holds gets a 304, and a 200 with the new ETag once the file changes', async () => {
  onDisk(START);
  const first = await read();
  const again = await read({ 'If-None-Match': first.headers.etag });
  assert.equal(again.status, 304);
  assert.equal(again.headers.etag, first.headers.etag);
  assert.equal(again.text, '');
  // A compressing proxy weakens the ETag on the way: still a 304.
  assert.equal((await read({ 'If-None-Match': `W/${first.headers.etag}` })).status, 304);

  onDisk({ ...START, theme: 'light' });
  const changed = await read({ 'If-None-Match': first.headers.etag });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.theme, 'light');
  assert.equal(changed.headers.etag, fileVersion());
});

test('a write without If-Match is refused (428) and the file is unchanged', async () => {
  onDisk(START);
  const before = fileText();
  const saved = await write({ ...START, theme: 'light' });
  assert.equal(saved.status, 428, saved.text);
  assert.match(saved.body.error, /If-Match/);
  assert.equal(fileText(), before);
});

test('a write over an older version is refused (409) with the version now, and the file is unchanged', async () => {
  onDisk(START);
  const deviceA = await read();
  const deviceB = await read();
  const hidden = { ...START, overviewSections: { services: false } };
  assert.equal((await write(hidden, deviceA.headers.etag)).status, 200);
  const after = fileText();

  const stale = await write({ ...START, theme: 'light' }, deviceB.headers.etag);
  assert.equal(stale.status, 409, stale.text);
  assert.equal(stale.body.stale, true);
  assert.equal(stale.headers.etag, fileVersion(), 'the 409 names the version now');
  assert.equal(fileText(), after);
  assert.deepEqual(JSON.parse(fileText()).overviewSections, { services: false });
});

test('a version that is not one is refused (409): *, a made-up one, an empty one', async (t) => {
  for (const version of ['*', '"made-up"', '""']) {
    await t.test(version, async () => {
      onDisk(START);
      const before = fileText();
      const saved = await write({ ...START, theme: 'light' }, version);
      assert.equal(saved.status, 409, saved.text);
      assert.equal(fileText(), before);
    });
  }
});

test('a hand edit after the read makes the write 409', async () => {
  onDisk(START);
  const r = await read();
  onDisk({ ...START, refreshInterval: 60 });
  const saved = await write({ ...START, theme: 'light' }, r.headers.etag);
  assert.equal(saved.status, 409, saved.text);
  assert.equal(JSON.parse(fileText()).refreshInterval, 60);
});

test("a missing file's version accepts the first write, and only while it is missing", async () => {
  rmSync(PATH, { force: true });
  const r = await read();
  assert.equal(r.status, 200);
  assert.equal(r.body, null);
  assert.equal(r.headers.etag, '"absent"');

  const first = await write(START, r.headers.etag);
  assert.equal(first.status, 200, first.text);
  assert.ok(existsSync(PATH));
  assert.deepEqual(JSON.parse(fileText()), START);
  assert.equal(first.headers.etag, fileVersion());

  // Another device that read the missing file can't write over the new one.
  const late = await write({ theme: 'light' }, r.headers.etag);
  assert.equal(late.status, 409, late.text);
  assert.deepEqual(JSON.parse(fileText()), START);
});

test('an invalid body is still a 400 before the version is looked at, and nothing is written', async () => {
  onDisk(START);
  const before = fileText();
  const r = await write({ refreshInterval: 0 });
  assert.equal(r.status, 400);
  assert.equal(fileText(), before);
});

test('a stored value Settings could never save back is dropped from the read, with one warning naming the key, and the next save heals the file', async (t) => {
  const SECRETISH = 'hand-typed-value-77';
  onDisk({ ...START, overviewSections: { services: SECRETISH }, refreshInterval: 'often' });
  const warned = [];
  for (const stream of [process.stdout, process.stderr]) {
    t.mock.method(stream, 'write', (chunk) => {
      warned.push(String(chunk));
      return true;
    });
  }
  const r = await read();
  await read();
  t.mock.restoreAll();

  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { theme: 'dark' });
  // The ETag is the version of the bytes on disk, bad values and all.
  assert.equal(r.headers.etag, fileVersion());
  const lines = warned.filter((l) => l.includes('display-config.json'));
  assert.equal(lines.length, 1, `one warning for the two reads: ${warned.join('')}`);
  assert.match(lines[0], /overviewSections/);
  assert.match(lines[0], /refreshInterval/);
  assert.ok(!lines[0].includes(SECRETISH), 'the warning quotes the value');
  assert.ok(!lines[0].includes('often'), 'the warning quotes the value');

  // What the device sends back is the read, with its own change: accepted.
  const saved = await write({ ...r.body, overviewSections: { services: false } }, r.headers.etag);
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(JSON.parse(fileText()), {
    theme: 'dark',
    overviewSections: { services: false },
  });
});
