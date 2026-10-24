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
  AUTH_BACKOFF_MS,
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

// The real #848's shape: intro, then "For Jag" with ### sub-headings and rows whose
// host blocks sit in indented code fences, then sections that must not count.
const BODY = [
  '**Running list of PRs whose change only takes effect after someone acts on a host.**',
  '- [ ] **#1** a row in the intro, above any section: not counted',
  '',
  '## For Jag, in sitting order',
  '',
  '### 1 · MS-S1 (where you sit)',
  '',
  '### 4 · JagHelm deploy (Gitea UI + vm-103)',
  '',
  '- [x] **jagdeep.bhandal/JagHelm#665** (#659 stage B) done.',
  '',
  '- [ ] **#879**: one-time recreate of every Arcane container. Blocks per host in the handbook.',
  '  ```bash',
  '  - [ ] not a row: indented in a code block',
  '  ## not a heading either',
  '  ```',
  '<!-- - [ ] **#2** commented out -->',
  '<!--',
  '- [ ] **#3** inside a multi-line comment',
  '-->',
  '',
  '## Waiting on Jag, no host needed',
  '',
  '- [ ] **jagdeep.bhandal/JagHelm#218**: APK build moves `setup-android` v3 → v4.',
  '',
  "## Claude's own host steps (no action for you)",
  '- [ ] **#4** Claude does it',
  '',
  '## Done',
  '- [X] **#872**: no host step needed.',
].join('\n');

test('parser: only the For Jag section counts, past its ### headings, code blocks and comments', () => {
  const r = parseHostActions(BODY, BASE);
  assert.equal(r.ok, true);
  assert.equal(r.total, 1);
  assert.deepEqual(r.items[0], {
    ref: '#879',
    title: 'one-time recreate of every Arcane container. Blocks per host in the handbook.',
    href: `${BASE}/jagdeep.bhandal/homelab-infra/issues/879`,
  });
});

test('parser: the heading is matched loosely, and a row names a repo or not', () => {
  const r = parseHostActions(
    '## FOR JAG\n- [ ] **jagdeep.bhandal/JagHelm#218**: APK build moves `setup-android` v3 → v4 (closes JagHelm #202).',
    BASE
  );
  assert.equal(r.items[0].ref, 'JagHelm#218');
  assert.equal(r.items[0].href, `${BASE}/jagdeep.bhandal/JagHelm/issues/218`);
  assert.match(r.items[0].title, /^APK build moves setup-android v3 → v4/);
});

test('parser: a fence is closed only by its own marker and length', () => {
  const body = [
    '## For Jag',
    '````md',
    '```',
    '- [ ] **#1** still inside the four-backtick block',
    '```',
    '- [ ] **#2** still inside',
    '````',
    '~~~',
    '```',
    '- [ ] **#3** inside the tilde block',
    '~~~',
    '- [ ] **#4** outside',
  ].join('\n');
  const r = parseHostActions(body, BASE);
  assert.deepEqual(
    r.items.map((i) => i.ref),
    ['#4']
  );
});

test('parser: a For Jag section with every row ticked, or its rows deleted, is zero, not unreadable', () => {
  assert.deepEqual(parseHostActions('## For Jag\n- [x] **#1** done\r\n- [X] **#2** done', BASE), {
    ok: true,
    total: 0,
    items: [],
  });
  assert.deepEqual(
    parseHostActions('## For Jag, in sitting order\n\n### 1 · MS-S1\n\n## Done\n', BASE),
    {
      ok: true,
      total: 0,
      items: [],
    }
  );
});

test('parser: not text, empty, or no For Jag section is unparseable, never a throw', () => {
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
  const r = parseHostActions('## For Jag\n- [ ] fix the thing\n- [ ] **Do it** later', BASE);
  assert.equal(r.total, 2);
  assert.equal(r.items[0].ref, null);
  assert.equal(r.items[0].title, 'fix the thing');
  assert.equal(r.items[0].href, ISSUE_HREF);
  assert.equal(r.items[1].ref, 'Do it');
  assert.equal(r.items[1].href, ISSUE_HREF);
});

test('parser: a long title is cut, markdown and control characters are taken out', () => {
  const long = `## For Jag\n- [ ] **#5** [link text](http://x.test/p?token=zzz) \`code\` ${'w '.repeat(200)}\u0007`;
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
  assert.equal(res.body.count, 1);
  assert.equal(res.body.items.length, 1);
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
  const rows = [
    '## For Jag',
    ...Array.from({ length: MAX_ITEMS + 3 }, (_, i) => `- [ ] **#${100 + i}** step ${i}`),
  ];
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
  assert.equal(good.count, 1);
  _expireHostActions();
  gitea.answer = () => ({ status: 502, json: {} });
  const next = await hostActionsAnswer(1_000 + CACHE_TTL_MS);
  assert.equal(next.ok, true);
  assert.equal(next.stale, true);
  assert.equal(next.count, 1);
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

test('route: a For Jag section with nothing open is count 0 with no warning', async () => {
  gitea.answer = () => ({
    status: 200,
    json: { body: '## For Jag\n\n- [x] **#1** done\n\n## Done\n' },
  });
  const lines = [];
  const err = process.stderr.write;
  process.stderr.write = function (chunk, ...rest) {
    lines.push(String(chunk));
    return err.call(this, chunk, ...rest);
  };
  let res;
  try {
    res = await request(app).get('/api/host-actions');
  } finally {
    process.stderr.write = err;
  }
  assert.equal(res.body.ok, true);
  assert.equal(res.body.count, 0);
  assert.equal(lines.join(''), '');
});

test('route: a refused token (403, 404) is "See #848", asked again only after the backoff, with one warn per window', async () => {
  for (const status of [403, 404]) {
    _resetHostActions();
    gitea.calls.length = 0;
    gitea.answer = () => ({ status, json: { message: 'no access, token secret-test-token' } });
    const lines = [];
    const err = process.stderr.write;
    process.stderr.write = function (chunk, ...rest) {
      lines.push(String(chunk));
      return err.call(this, chunk, ...rest);
    };
    let first;
    try {
      first = await request(app).get('/api/host-actions');
      await request(app).get('/api/host-actions');
      await request(app).get('/api/host-actions');
    } finally {
      process.stderr.write = err;
    }
    assert.deepEqual(first.body, { configured: true, ok: false, href: ISSUE_HREF });
    assert.equal(gitea.calls.length, 1, 'asked once within the backoff, not every minute');
    const warns = lines.filter((l) => l.includes('"level":"warn"'));
    assert.equal(warns.length, 1);
    assert.match(warns[0], new RegExp(`"status":${status}`));
    assert.ok(!warns[0].includes('secret-test-token') && !warns[0].includes('?token'));
  }
});

test('the backoff after a refused token is 10 minutes', () => {
  assert.equal(AUTH_BACKOFF_MS, 10 * 60_000);
});
