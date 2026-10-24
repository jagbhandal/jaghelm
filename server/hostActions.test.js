/**
 * Pending host steps (#673): the parser over homelab-infra #848's checklist,
 * and GET /api/host-actions on the real route with Gitea behind a stub fetch.
 * Absent without a URL and token, the token in the header only, one request
 * for any number of readers within the TTL, and every way Gitea can fail
 * ending in a plain answer with the link to #848, never a thrown error.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

process.env.JAGHELM_GITEA_URL = 'http://gitea.test:3060';
process.env.JAGHELM_GITEA_TOKEN = 'secret-test-token'; // pragma: allowlist secret
delete process.env.GITEA_URL;
delete process.env.GITEA_TOKEN;

const {
  parseHostActions,
  hostActionsAnswer,
  _expireHostActions,
  _resetHostActions,
  CACHE_TTL_MS,
  MAX_ITEMS,
} = await import('./hostActions.js');
const { infrastructureRoutes } = await import('./routes/infrastructure.js');

const BASE = 'http://gitea.test:3060';
const ISSUE_HREF = `${BASE}/jagdeep.bhandal/homelab-infra/issues/848`;
const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

// A cut of #848's real body: ticked rows, unticked rows with and without a repo in the reference.
const BODY = [
  '**Running list of PRs whose change only takes effect after someone acts on a host.**',
  '',
  '## For Jag',
  '',
  '- [x] **jagdeep.bhandal/JagHelm#665** (#659 stage B) done.',
  '',
  '- [ ] **#879**: one-time recreate of every Arcane container. Blocks per host in the handbook.',
  '',
  '## Waiting on Jag, no host needed',
  '',
  '- [ ] **jagdeep.bhandal/JagHelm#218**: APK build moves `setup-android` v3 → v4 (closes JagHelm #202).',
  '  ```bash',
  '  - [ ] not a row: indented in a code block',
  '  ```',
  '- [X] **#872**: no host step needed.',
].join('\n');

test('parser: the unticked top-level rows, in list order, with a link each', () => {
  const r = parseHostActions(BODY, BASE);
  assert.equal(r.ok, true);
  assert.equal(r.total, 2);
  assert.deepEqual(r.items[0], {
    ref: '#879',
    title: 'one-time recreate of every Arcane container. Blocks per host in the handbook.',
    href: `${BASE}/jagdeep.bhandal/homelab-infra/issues/879`,
  });
  assert.equal(r.items[1].ref, 'JagHelm#218');
  assert.equal(r.items[1].href, `${BASE}/jagdeep.bhandal/JagHelm/issues/218`);
  assert.match(r.items[1].title, /^APK build moves setup-android v3 → v4/);
});

test('parser: every row ticked is a list with none open, not unparseable', () => {
  const r = parseHostActions('- [x] **#1** done\r\n- [X] **#2** done', BASE);
  assert.deepEqual(r, { ok: true, total: 0, items: [] });
});

test('parser: not text, empty, or no checklist at all is unparseable, never a throw', () => {
  for (const body of [
    null,
    undefined,
    42,
    {},
    '',
    'just prose',
    '| a | b |\n|---|---|\n| 1 | 2 |',
  ]) {
    assert.deepEqual(parseHostActions(body, BASE), { ok: false }, String(body));
  }
});

test('parser: a row with no bold reference or no number links to the list itself', () => {
  const r = parseHostActions('- [ ] fix the thing\n- [ ] **Do it** later', BASE);
  assert.equal(r.total, 2);
  assert.equal(r.items[0].ref, null);
  assert.equal(r.items[0].title, 'fix the thing');
  assert.equal(r.items[0].href, ISSUE_HREF);
  assert.equal(r.items[1].ref, 'Do it');
  assert.equal(r.items[1].href, ISSUE_HREF);
});

test('parser: a long title is cut, markdown and control characters are taken out', () => {
  const long = `- [ ] **#5** [link text](http://x.test/p?token=zzz) \`code\` ${'w '.repeat(200)}\u0007`;
  const r = parseHostActions(long, BASE);
  assert.ok(r.items[0].title.length <= 110);
  assert.ok(!/\p{Cc}|http|zzz|`/u.test(r.items[0].title), r.items[0].title);
  assert.ok(r.items[0].title.startsWith('link text code w w'));
});

// ── the route ────────────────────────────────────────────────────────────

const app = express();
app.use('/api', infrastructureRoutes);

const gitea = { calls: [], answer: () => ({ status: 200, json: { body: BODY } }) };
globalThis.fetch = async (url, init = {}) => {
  gitea.calls.push({ url: String(url), headers: new Headers(init.headers) });
  const a = gitea.answer();
  if (a.throws) throw new Error(a.throws);
  return new Response(a.raw ?? JSON.stringify(a.json), {
    status: a.status,
    headers: { 'Content-Type': 'application/json' },
  });
};

beforeEach(async () => {
  gitea.calls.length = 0;
  gitea.answer = () => ({ status: 200, json: { body: BODY } });
  _resetHostActions();
  process.env.JAGHELM_GITEA_URL = 'http://gitea.test:3060';
  process.env.JAGHELM_GITEA_TOKEN = 'secret-test-token'; // pragma: allowlist secret
});

test('route: the count and the rows, read from the issue with the token in the header only', async () => {
  const res = await request(app).get('/api/host-actions');
  assert.equal(res.status, 200);
  assert.equal(res.body.configured, true);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.count, 2);
  assert.equal(res.body.items.length, 2);
  assert.equal(res.body.href, ISSUE_HREF);
  assert.equal(gitea.calls.length, 1);
  const { url, headers } = gitea.calls[0];
  assert.equal(url, `${BASE}/api/v1/repos/jagdeep.bhandal/homelab-infra/issues/848`);
  assert.ok(!url.includes('secret-test-token') && !url.includes('?'));
  assert.equal(headers.get('authorization'), 'token secret-test-token');
});

test('route: without the token or the URL it is absent and asks Gitea nothing', async () => {
  delete process.env.JAGHELM_GITEA_TOKEN;
  let res = await request(app).get('/api/host-actions');
  assert.deepEqual(res.body, { configured: false });
  process.env.JAGHELM_GITEA_TOKEN = 'secret-test-token'; // pragma: allowlist secret
  delete process.env.JAGHELM_GITEA_URL;
  res = await request(app).get('/api/host-actions');
  assert.deepEqual(res.body, { configured: false });
  assert.equal(gitea.calls.length, 0);
});

test('route: any number of readers within the TTL cost one request, and a repeat is a 304', async () => {
  const first = await request(app).get('/api/host-actions');
  await Promise.all([request(app).get('/api/host-actions'), request(app).get('/api/host-actions')]);
  assert.equal(gitea.calls.length, 1);
  const again = await request(app)
    .get('/api/host-actions')
    .set('If-None-Match', first.headers.etag);
  assert.equal(again.status, 304);
});

test('route: more rows than MAX_ITEMS list MAX_ITEMS and count them all', async () => {
  const rows = Array.from({ length: MAX_ITEMS + 3 }, (_, i) => `- [ ] **#${100 + i}** step ${i}`);
  gitea.answer = () => ({ status: 200, json: { body: rows.join('\n') } });
  const res = await request(app).get('/api/host-actions');
  assert.equal(res.body.count, MAX_ITEMS + 3);
  assert.equal(res.body.items.length, MAX_ITEMS);
  assert.equal(res.body.more, 3);
});

test('route: an unreadable body, bad JSON, a refusal or a network error are ok:false with the link', async () => {
  const failures = [
    () => ({ status: 200, json: { body: 'the list moved to a table' } }),
    () => ({ status: 200, json: { body: null } }),
    () => ({ status: 200, raw: '<html>proxy</html>' }),
    () => ({ status: 403, json: { message: 'token lacks scope' } }),
    () => ({ status: 404, json: { message: 'not found' } }),
    () => ({ status: 200, throws: 'connect ECONNREFUSED' }),
  ];
  for (const f of failures) {
    _resetHostActions();
    gitea.answer = f;
    const res = await request(app).get('/api/host-actions');
    assert.equal(res.status, 200, JSON.stringify(f()));
    assert.deepEqual(res.body, { configured: true, ok: false, href: ISSUE_HREF });
  }
});

test('answer: Gitea failing after a good read keeps the last list, marked stale', async () => {
  const good = await hostActionsAnswer(1_000);
  assert.equal(good.count, 2);
  _expireHostActions();
  gitea.answer = () => ({ status: 502, json: {} });
  const next = await hostActionsAnswer(1_000 + CACHE_TTL_MS);
  assert.equal(next.ok, true);
  assert.equal(next.stale, true);
  assert.equal(next.count, 2);
});

test('logs: a failure line never carries the token', async () => {
  const lines = [];
  const tap = (orig) =>
    function (chunk, ...rest) {
      lines.push(String(chunk));
      return orig.call(this, chunk, ...rest);
    };
  const out = process.stdout.write;
  const err = process.stderr.write;
  process.stdout.write = tap(out);
  process.stderr.write = tap(err);
  try {
    gitea.answer = () => ({
      status: 200,
      throws: 'refused token secret-test-token at http://jag:hunter2@gitea.test:3060/x?token=k1',
    });
    await request(app).get('/api/host-actions');
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
  const text = lines.join('');
  assert.match(text, /host steps list read failed/);
  for (const secret of ['secret-test-token', 'hunter2', 'k1']) {
    assert.ok(!text.includes(secret), `${secret} in the log`);
  }
});
