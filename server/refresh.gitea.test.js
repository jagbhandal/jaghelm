/**
 * refreshGitea (gitea.js) must send JAGHELM_GITEA_TOKEN as an Authorization
 * header, never in the query string — Gitea's router log records full request
 * URLs, so a ?token= param leaks the credential into container logs (and
 * anything shipping them).
 *
 * Without JAGHELM_GITEA_URL no Gitea is set up (#272): nothing is polled, the
 * payload says so, and the boot logs it once.
 *
 * A poll reads each repo once, on its default branch, and polls come every 5
 * minutes, not every cycle (#249). Each test starts with no poll made yet.
 *
 * A repos/search answer without a repo list (an error object, a proxy's HTML
 * page) logs what Gitea sent and fails like an HTTP error (#399). So does every
 * repo's request failing. No log line carries the token or a URL's password.
 *
 * Each row carries its CI result, branch and short sha (#532): a repo with
 * Actions is read through its push runs, one request; one without Actions, or
 * without a run, through its commits, with no CI result.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

process.env.JAGHELM_GITEA_URL = 'http://gitea.test:3060';
process.env.JAGHELM_GITEA_TOKEN = 'secret-test-token';
delete process.env.GITEA_URL;
delete process.env.GITEA_TOKEN;

const { runCycleRefreshes, startBackgroundRefresh, stopBackgroundRefresh, getRefreshHealth } =
  await import('./refresh.js');
const { GITEA_POLL_MS, _resetGiteaPoll, giteaFailure, refreshGitea } = await import('./gitea.js');
const { getCached, setCache } = await import('./cache.js');
const { infrastructureRoutes } = await import('./routes/infrastructure.js');
const { buildStatus, DEFAULT_THRESHOLDS } = await import('./status/index.js');

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => _resetGiteaPoll());

// The commits request asks for no diff stats, files or signature checks
// (#532): the Pipeline shows none, and they made each answer about half again
// as big and three times as slow.
const SLIM = '&stat=false&verification=false&files=false';

/**
 * A Gitea Actions run as /actions/runs lists it (#532): run `id` (newer is
 * higher) on the commit `sha` (padded to 40 characters) and `branch`, a push
 * run of `workflow` that `conclusion`s, or is still `status`.
 */
function ciRun(
  id,
  sha,
  {
    branch = 'main',
    status = 'completed',
    conclusion = status === 'completed' ? 'success' : null,
    workflow = 'ci.yml',
    title = `Commit ${sha}`,
    at = '2026-10-20T09:00:00Z',
  } = {}
) {
  return {
    id,
    head_sha: sha.padEnd(40, '0'),
    head_branch: branch,
    event: 'push',
    status,
    conclusion,
    path: `${workflow}@refs/heads/${branch}`,
    display_title: title,
    created_at: at,
    actor: { login: 'jag', full_name: 'Jag' },
  };
}

/** Run `fn` with JAGHELM_GITEA_URL unset, then put it back. */
async function withoutGiteaUrl(fn) {
  const saved = process.env.JAGHELM_GITEA_URL;
  delete process.env.JAGHELM_GITEA_URL;
  try {
    return await fn();
  } finally {
    process.env.JAGHELM_GITEA_URL = saved;
  }
}

/**
 * The structured log lines written while `fn` runs (handed to `fn` as they
 * come, too); anything else passes through.
 */
async function captureLogs(fn) {
  const lines = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  const tap = (orig) =>
    function (chunk, ...rest) {
      try {
        const obj = JSON.parse(String(chunk));
        if (obj && obj.module && obj.level) {
          lines.push(obj);
          return true;
        }
      } catch {
        // not one of ours
      }
      return orig.call(this, chunk, ...rest);
    };
  process.stdout.write = tap(origOut);
  process.stderr.write = tap(origErr);
  try {
    await fn(lines);
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return lines;
}

test('refreshGitea: token goes in the Authorization header, not the URL, for every request', async () => {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: new Headers(init.headers) });
    const u = String(url);
    if (u.includes('/repos/search')) {
      return Response.json({
        data: [
          { name: 'ci', full_name: 'o/ci', has_actions: true },
          { name: 'r', full_name: 'o/r', has_actions: false },
        ],
      });
    }
    if (u.includes('/actions/runs')) {
      return Response.json({ total_count: 1, workflow_runs: [ciRun(1, 'aaa')] });
    }
    return Response.json([
      { sha: 'abcdef123', commit: { message: 'm', author: { date: '2026-10-10', name: 'a' } } },
    ]);
  };

  const result = await refreshGitea();

  assert.equal(result.length, 2);
  // repos/search, o/ci's runs and o/r's commits: guards against the loop below passing vacuously.
  assert.deepEqual(
    calls.map((c) => new URL(c.url).pathname),
    ['/api/v1/repos/search', '/api/v1/repos/o/ci/actions/runs', '/api/v1/repos/o/r/commits']
  );
  for (const { url, headers } of calls) {
    assert.ok(!url.includes('secret-test-token'), `token leaked into URL: ${url}`);
    assert.equal(headers.get('authorization'), 'token secret-test-token');
  }
});

test('without JAGHELM_GITEA_URL: answers { configured: false }, fetches nothing, logs nothing and is no cycle error', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error('no fetch expected');
  };

  let first;
  let errors;
  const lines = await captureLogs(() =>
    withoutGiteaUrl(async () => {
      first = await refreshGitea();
      await refreshGitea();
      errors = await runCycleRefreshes([['gitea', refreshGitea]]);
    })
  );

  assert.deepEqual(first, { configured: false });
  assert.deepEqual(getCached('gitea'), { configured: false }, 'cached, so /api/gitea/activity answers it');
  assert.deepEqual(calls, [], 'no localhost:3060 default any more');
  assert.deepEqual(errors, []);
  assert.deepEqual(lines, []);
});

test('without JAGHELM_GITEA_URL: the boot logs "Gitea panel off" once, and no cycle logs it again', async (t) => {
  globalThis.fetch = async (url) => {
    throw new Error(`no network in this test: ${url}`);
  };
  // Record the loop's timers instead of letting them fire; the test runs ticks by hand.
  const timers = [];
  const realSetInterval = globalThis.setInterval;
  t.mock.method(globalThis, 'setInterval', (fn, ms) => {
    timers.push({ fn, ms });
    return realSetInterval(() => {}, 2 ** 31 - 1).unref();
  });

  const lines = await captureLogs(() =>
    withoutGiteaUrl(async () => {
      startBackgroundRefresh();
      const deadline = Date.now() + 10_000;
      while (getRefreshHealth().state !== 'ok') {
        if (Date.now() > deadline) throw new Error('the warm-up cycle did not finish');
        await new Promise((r) => setTimeout(r, 20));
      }
      await timers.at(-1).fn(); // two more cycles
      await timers.at(-1).fn();
      stopBackgroundRefresh();
    })
  );

  const gitea = lines.filter((l) => /gitea/i.test(l.msg));
  assert.deepEqual(
    gitea.map((l) => [l.level, l.msg]),
    [['info', 'Gitea panel off: JAGHELM_GITEA_URL is not set']]
  );
});

test('with JAGHELM_GITEA_URL set, the boot does not log "Gitea panel off"', async (t) => {
  globalThis.fetch = async (url) => {
    throw new Error(`no network in this test: ${url}`);
  };
  const realSetInterval = globalThis.setInterval;
  t.mock.method(globalThis, 'setInterval', () => realSetInterval(() => {}, 2 ** 31 - 1).unref());

  const lines = await captureLogs(async (seen) => {
    startBackgroundRefresh();
    // Wait for its warm-up cycle to poll Gitea (and fail: no network here), so
    // the cycle doesn't outlive the test.
    const deadline = Date.now() + 10_000;
    while (!seen.some((l) => l.msg === 'Gitea refresh error')) {
      if (Date.now() > deadline) throw new Error('the warm-up cycle never polled Gitea');
      await new Promise((r) => setTimeout(r, 20));
    }
    stopBackgroundRefresh();
  });

  assert.equal(lines.filter((l) => l.msg.includes('Gitea panel off')).length, 0);
});

/**
 * Make repos/search answer `body` (sent as is) with `status`; any other request
 * is recorded. Returns the URLs fetched.
 */
function searchAnswers(status, body, contentType = 'application/json') {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(body, { status, headers: { 'content-type': contentType } });
  };
  return calls;
}

/** Poll Gitea once with an empty cache; the log lines it wrote and its result. */
async function refreshOnce() {
  setCache('gitea', null); // what a cold cache reads as
  _resetGiteaPoll(); // due now
  let result;
  const lines = await captureLogs(async () => {
    result = await refreshGitea();
  });
  return { result, lines };
}

/** Each log line as Loki gets it: JSON, without the time. */
const asLogged = (lines) => lines.map(({ time: _time, ...rest }) => rest);

// What Gitea answers an API call without a valid token.
const SIGNED_IN_ONLY = JSON.stringify({
  message: 'Only signed in user is allowed to call APIs.',
  url: 'http://gitea.test:3060/api/swagger',
});

test('repos/search answering an error object: one line with the status and what Gitea said, no TypeError (#399)', async () => {
  const calls = searchAnswers(403, SIGNED_IN_ONLY);

  const { result, lines } = await refreshOnce();

  assert.equal(result, null);
  assert.deepEqual(asLogged(lines), [
    {
      level: 'error',
      module: 'refresh',
      msg: 'Gitea refresh error: no repo list in the answer',
      status: 403,
      message: 'Only signed in user is allowed to call APIs.',
      words: 'Gitea refused the request (HTTP 403)',
    },
  ]);
  assert.equal(calls.length, 1, 'no repo, so no commits are fetched');
});

test('repos/search answering an error object fails like an HTTP error: nothing cached, a cycle error, a 502 (#399)', async () => {
  searchAnswers(403, SIGNED_IN_ONLY);

  let errors;
  let res;
  await captureLogs(async () => {
    setCache('gitea', null);
    errors = await runCycleRefreshes([['gitea', refreshGitea]]);
    assert.equal(getCached('gitea'), null, 'nothing cached');
    const app = express();
    app.use('/api', infrastructureRoutes);
    res = await request(app).get('/api/gitea/activity');
  });

  assert.deepEqual(errors, ['gitea']);
  assert.equal(res.status, 502);
  assert.deepEqual(res.body, { error: 'Gitea data not yet available' });
});

test('repos/search failing in its own shape, { ok: false, error }: its error is the message (#399)', async () => {
  searchAnswers(500, JSON.stringify({ ok: false, error: 'search failed' }));

  const { result, lines } = await refreshOnce();

  assert.equal(result, null);
  assert.deepEqual(
    lines.map((l) => [l.msg, l.status, l.message]),
    [['Gitea refresh error: no repo list in the answer', 500, 'search failed']]
  );
});

test('repos/search answering JSON with no list and no message: the status alone (#399)', async () => {
  for (const body of ['{}', 'null', '{"data":null}', '"ok"', '42']) {
    searchAnswers(200, body);

    const { result, lines } = await refreshOnce();

    assert.equal(result, null, body);
    assert.deepEqual(
      asLogged(lines),
      [
        {
          level: 'error',
          module: 'refresh',
          msg: 'Gitea refresh error: no repo list in the answer',
          status: 200,
          words: "Gitea's answer couldn't be read",
        },
      ],
      body
    );
  }
});

test('repos/search answering a body that is not JSON: the same line, no parse error (#399)', async () => {
  for (const [status, body, type] of [
    [502, '<html><body><h1>502 Bad Gateway</h1></body></html>', 'text/html'],
    [503, '', 'text/plain'],
  ]) {
    searchAnswers(status, body, type);

    const { result, lines } = await refreshOnce();

    assert.equal(result, null);
    assert.deepEqual(asLogged(lines), [
      {
        level: 'error',
        module: 'refresh',
        msg: 'Gitea refresh error: no repo list in the answer',
        status,
        words: `Gitea answered with an error (HTTP ${status})`,
      },
    ]);
  }
});

test('the line never carries the token, the Authorization header or URL credentials, and is cut to 200 characters (#399)', async () => {
  const token = process.env.JAGHELM_GITEA_TOKEN;
  const echoes = [
    `bad token ${token}`,
    `Authorization: token ${token} refused`,
    'no access to http://jag:hunter2@gitea.test:3060/api/v1/repos/search?token=k1',
    // The token straddles the 200th character: taken out before the cut, so no
    // part of it is left.
    `${'x'.repeat(190)} ${token} and more`,
  ];
  for (const message of echoes) {
    searchAnswers(401, JSON.stringify({ message }));

    const { lines } = await refreshOnce();

    assert.equal(lines.length, 1);
    const line = JSON.stringify(lines[0]);
    for (const secret of [token, token.slice(0, 6), 'hunter2', 'k1']) {
      assert.ok(!line.includes(secret), `${secret} in ${line}`);
    }
    assert.ok(lines[0].message.length <= 201, lines[0].message);
  }

  searchAnswers(401, JSON.stringify({ message: 'y'.repeat(1000) }));
  const { lines } = await refreshOnce();
  assert.equal(lines[0].message, `${'y'.repeat(200)}…`);
});

test('a repo list in either shape still refreshes, an empty one too (#399)', async () => {
  const repo = { name: 'r', full_name: 'o/r', fork: false, mirror: false, archived: false };
  for (const [search, expected] of [
    [{ ok: true, data: [repo] }, ['o/r']],
    [[repo], ['o/r']],
    // A Gitea with no repo the token can see: a success, not "no repo list".
    [{ ok: true, data: [] }, []],
    [[], []],
  ]) {
    globalThis.fetch = async (url) => {
      const body = String(url).includes('/repos/search')
        ? search
        : [{ sha: 'abcdef123', commit: { message: 'm', author: { date: '2026-10-10', name: 'a' } } }];
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    };

    const { result, lines } = await refreshOnce();

    assert.deepEqual(result.map((r) => r.fullName), expected, JSON.stringify(search));
    assert.deepEqual(getCached('gitea'), result, 'cached');
    assert.deepEqual(lines, [], JSON.stringify(search));
    let errors;
    await captureLogs(async () => {
      errors = await runCycleRefreshes([['gitea', refreshGitea]]);
    });
    assert.deepEqual(errors, [], JSON.stringify(search));
  }
});

test('a JAGHELM_GITEA_URL with a user or password is refused (#419): the panel is off, nothing is fetched or logged, no cycle error', async () => {
  const saved = process.env.JAGHELM_GITEA_URL;
  try {
    for (const url of ['http://jag:hunter2@127.0.0.1:9', 'http://jag:1234/hunter2@127.0.0.1:9']) { // pragma: allowlist secret
      process.env.JAGHELM_GITEA_URL = url;
      const calls = [];
      globalThis.fetch = async (u) => {
        calls.push(String(u));
        throw new Error('fetched');
      };
      const out = await refreshOnce();
      assert.deepEqual(out.result, { configured: false }, url);
      assert.deepEqual(getCached('gitea'), { configured: false });
      assert.deepEqual(calls, [], 'nothing fetched');
      assert.deepEqual(out.lines, [], 'the boot said it once; the cycles say nothing');
      const errors = await runCycleRefreshes([['gitea', refreshGitea]]);
      assert.deepEqual(errors, []);
    }
  } finally {
    process.env.JAGHELM_GITEA_URL = saved;
  }
});

/**
 * Make repos/search list the repos `a` and `b`, without Actions, and each
 * commits request answer what `commits[repo]` gives: a Response, or a thrown
 * error.
 */
function commitsAnswer(commits) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/repos/search')) {
      const repos = ['a', 'b'].map((n) => ({
        name: n,
        full_name: `o/${n}`,
        fork: false,
        mirror: false,
        archived: false,
        has_actions: false,
      }));
      return Response.json({ ok: true, data: repos });
    }
    return commits[u.match(/\/repos\/o\/(\w+)\/commits/)[1]]();
  };
}

const COMMITS = () =>
  Response.json([{ sha: 'abcdef123', commit: { message: 'm', author: { date: '2026-10-10', name: 'a' } } }]);

test('every repo request failing fails the refresh: one redacted line, nothing cached, a cycle error, a 502', async () => {
  const token = process.env.JAGHELM_GITEA_TOKEN;
  commitsAnswer({
    a: () => {
      throw new Error(`token ${token} refused, connect ECONNREFUSED http://jag:hunter2@gitea.test:3060/api/v1/repos/o/a`);
    },
    b: () => new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
  });

  const { result, lines } = await refreshOnce();

  assert.equal(result, null);
  assert.equal(getCached('gitea'), null, 'nothing cached');
  assert.deepEqual(
    lines.map((l) => [l.level, l.msg, l.repos]),
    [['error', 'Gitea refresh error: every repo request failed', 2]]
  );
  assert.match(lines[0].err, /ECONNREFUSED/);
  const line = JSON.stringify(lines[0]);
  for (const secret of [token, 'hunter2']) assert.ok(!line.includes(secret), `${secret} in ${line}`);

  let errors;
  let res;
  await captureLogs(async () => {
    errors = await runCycleRefreshes([['gitea', refreshGitea]]);
    const app = express();
    app.use('/api', infrastructureRoutes);
    res = await request(app).get('/api/gitea/activity');
  });
  assert.deepEqual(errors, ['gitea']);
  assert.equal(res.status, 502);
});

test('every repo answering a 5xx fails the poll with the status, instead of an empty list (#341)', async () => {
  for (const answer of [
    () => Response.json({ message: 'internal error' }, { status: 500 }),
    () => new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
  ]) {
    commitsAnswer({ a: answer, b: answer });

    const { result, lines } = await refreshOnce();

    assert.equal(result, null, 'a failed poll, not a Gitea with no commits');
    assert.equal(getCached('gitea'), null);
    const status = lines[0].err.match(/HTTP (\d{3})/)[1];
    assert.deepEqual(
      lines.map((l) => [l.level, l.msg, l.words]),
      [['error', 'Gitea refresh error: every repo request failed', `Gitea answered with an error (HTTP ${status})`]]
    );
  }
});

test('a repo answering a 5xx among good ones is left out; a blip on every repo keeps the last list (#341)', async (t) => {
  const T0 = 2_300_000_000_000;
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  giteaWith([['a', 'main']]);
  const good = await refreshGitea();
  assert.equal(good.length, 1);
  const app = express();
  app.use('/api', infrastructureRoutes);

  commitsAnswer({ a: () => Response.json({ message: 'boom' }, { status: 500 }), b: COMMITS });
  t.mock.timers.tick(GITEA_POLL_MS);
  const some = await captureLogs(async () => refreshGitea());
  assert.deepEqual(some, [], 'no line for some repos failing');

  commitsAnswer({
    a: () => Response.json({ message: 'boom' }, { status: 500 }),
    b: () => Response.json({ message: 'boom' }, { status: 500 }),
  });
  await captureLogs(async () => {
    t.mock.timers.tick(GITEA_POLL_MS);
    assert.equal(await refreshGitea(), null);
    const res = await request(app).get('/api/gitea/activity');
    assert.equal(res.status, 200, 'the last good list is still served');
    assert.equal(res.body.length, 1);
  });
});

test('an empty repo (repos/search says `empty`) is never asked for commits (#341)', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/repos/search')) {
      return Response.json({
        ok: true,
        data: [
          { name: 'a', full_name: 'o/a', fork: false, mirror: false, archived: false, has_actions: false, empty: false },
          { name: 'e', full_name: 'o/e', fork: false, mirror: false, archived: false, has_actions: false, empty: true },
        ],
      });
    }
    return COMMITS();
  };
  const { result, lines } = await refreshOnce();
  assert.deepEqual(lines, []);
  assert.deepEqual(result.map((r) => r.fullName), ['o/a']);
  assert.ok(!calls.some((u) => u.includes('/repos/o/e/')), 'no request for the empty repo');
});

test('some commits requests failing: the others are listed, as before, with no log line', async () => {
  commitsAnswer({
    a: () => {
      throw new Error('fetch failed');
    },
    b: COMMITS,
  });

  const { result, lines } = await refreshOnce();

  assert.deepEqual(result.map((r) => r.fullName), ['o/b']);
  assert.deepEqual(getCached('gitea'), result);
  assert.deepEqual(lines, []);
  let errors;
  await captureLogs(async () => {
    errors = await runCycleRefreshes([['gitea', refreshGitea]]);
  });
  assert.deepEqual(errors, []);
});

// ── Default branches, one request per repo, every 5 minutes (#249) ───────

/**
 * A Gitea without Actions whose repos/search lists `repos` (name,
 * default_branch) under o/, each answering one commit; the URLs it was asked
 * are in the returned list.
 */
function giteaWith(repos) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/repos/search')) {
      return Response.json({
        ok: true,
        data: repos.map(([name, branch]) => ({
          name,
          full_name: `o/${name}`,
          fork: false,
          mirror: false,
          archived: false,
          has_actions: false,
          ...(branch !== undefined && { default_branch: branch }),
        })),
      });
    }
    return COMMITS();
  };
  return calls;
}

test("a poll reads each repo once, on the branch Gitea names as the repo's default (#249), with no stats, files or verification (#532)", async () => {
  const calls = giteaWith([['a', 'main'], ['b', 'develop'], ['c', 'release/2.x'], ['d', undefined]]);

  const { result, lines } = await refreshOnce();

  assert.deepEqual(lines, []);
  assert.deepEqual(result.map((r) => r.fullName).sort(), ['o/a', 'o/b', 'o/c', 'o/d']);
  const base = 'http://gitea.test:3060/api/v1/repos';
  assert.deepEqual(calls.sort(), [
    `${base}/o/a/commits?limit=5&sha=main${SLIM}`,
    `${base}/o/b/commits?limit=5&sha=develop${SLIM}`,
    `${base}/o/c/commits?limit=5&sha=release%2F2.x${SLIM}`,
    // No default branch named: Gitea's own default, with no sha.
    `${base}/o/d/commits?limit=5${SLIM}`,
    `${base}/search?limit=20`,
  ]);
});

test('Gitea is polled every 5 minutes, not every cycle: between polls nothing is asked and the last list stands (#249)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const calls = giteaWith([['a', 'main']]);
  const app = express();
  app.use('/api', infrastructureRoutes);

  const first = await refreshGitea();
  assert.equal(calls.length, 2, 'repos/search and one commits request');

  // Ten 30 s cycles and a dashboard read each: no request, the same list.
  for (let i = 0; i < 9; i += 1) {
    t.mock.timers.tick(30_000);
    assert.equal(await refreshGitea(), first);
    assert.deepEqual(await runCycleRefreshes([['gitea', refreshGitea]]), []);
    const res = await request(app).get('/api/gitea/activity');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, first);
  }
  t.mock.timers.tick(GITEA_POLL_MS - 9 * 30_000 - 1);
  await refreshGitea();
  assert.equal(calls.length, 2, 'nothing asked before 5 minutes');

  t.mock.timers.tick(1);
  await refreshGitea();
  assert.equal(calls.length, 4, 'the next poll, at 5 minutes');
});

test('a failed poll keeps the last list, its age in Last-Modified, and is retried after 30 s, then twice as long each time up to 5 minutes (#249)', async (t) => {
  const T0 = 2_000_000_000_000;
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  giteaWith([['a', 'main']]);
  const good = await refreshGitea();
  const app = express();
  app.use('/api', infrastructureRoutes);

  t.mock.timers.tick(GITEA_POLL_MS);
  const calls = searchAnswers(503, '', 'text/plain');
  let errors;
  let res;
  await captureLogs(async () => {
    assert.equal(await refreshGitea(), null);
    errors = await runCycleRefreshes([['gitea', refreshGitea]]);
    res = await request(app).get('/api/gitea/activity');
  });
  assert.deepEqual(errors, ['gitea'], 'failed: the status model has Gitea failed');
  assert.equal(res.status, 200, 'the last list is still served');
  assert.deepEqual(res.body, good);
  assert.equal(res.headers['last-modified'], new Date(T0).toUTCString(), 'its age: when Gitea last answered');
  assert.equal(calls.length, 1);

  // Retried after 30 s, 60 s, 120 s, 240 s, then every 5 minutes; nothing between.
  await captureLogs(async () => {
    for (const wait of [30_000, 60_000, 120_000, 240_000, GITEA_POLL_MS, GITEA_POLL_MS]) {
      const before = calls.length;
      t.mock.timers.tick(wait - 1);
      await refreshGitea();
      assert.equal(calls.length, before, `nothing before ${wait} ms`);
      t.mock.timers.tick(1);
      await refreshGitea();
      assert.equal(calls.length, before + 1, `a retry at ${wait} ms`);
    }
  });
});

test('the last list is served for two polls after Gitea last answered, then the route answers 502 (#249)', async (t) => {
  const T0 = 2_100_000_000_000;
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  giteaWith([['a', 'main']]);
  await refreshGitea();
  const app = express();
  app.use('/api', infrastructureRoutes);
  searchAnswers(503, '', 'text/plain');

  await captureLogs(async () => {
    t.mock.timers.tick(2 * GITEA_POLL_MS - 1);
    await refreshGitea();
    assert.equal((await request(app).get('/api/gitea/activity')).status, 200);
    t.mock.timers.tick(1);
    assert.equal((await request(app).get('/api/gitea/activity')).status, 502);
  });
});

test('one poll at a time: calls while a poll runs share it (#249)', async () => {
  const calls = giteaWith([['a', 'main'], ['b', 'main']]);
  const [x, y, z] = await Promise.all([refreshGitea(), refreshGitea(), runCycleRefreshes([['gitea', refreshGitea]])]);
  assert.equal(x, y);
  assert.deepEqual(z, []);
  assert.equal(calls.length, 3, 'repos/search and two commits requests, once');
});

test('a Gitea failure is logged when it starts and when it clears, not at every poll (#249)', async (t) => {
  const T0 = 2_200_000_000_000;
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  searchAnswers(503, '', 'text/plain');
  const lines = await captureLogs(async () => {
    await refreshGitea();
    for (const wait of [30_000, 60_000, 120_000]) {
      t.mock.timers.tick(wait);
      await refreshGitea();
    }
    giteaWith([['a', 'main']]);
    t.mock.timers.tick(240_000);
    await refreshGitea();
    t.mock.timers.tick(GITEA_POLL_MS);
    await refreshGitea();
  });
  assert.deepEqual(
    asLogged(lines).filter((l) => l.level !== 'debug'),
    [
      {
        level: 'error',
        module: 'refresh',
        msg: 'Gitea refresh error: no repo list in the answer',
        status: 503,
        words: 'Gitea answered with an error (HTTP 503)',
      },
      { level: 'info', module: 'refresh', msg: 'Gitea answers again', failedPolls: 4, downSec: 450 },
    ]
  );
});

test('a Gitea failing for another reason logs again, with its words; the status model says them (#605)', async (t) => {
  const T0 = 2_200_000_000_000;
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  searchAnswers(503, '', 'text/plain');
  const lines = await captureLogs(async () => {
    await refreshGitea();
    t.mock.timers.tick(30_000);
    await refreshGitea(); // the same cause: debug only
    assert.deepEqual(giteaFailure(), { cause: 'http', status: 503 });
    searchAnswers(401, JSON.stringify({ message: 'token is required' }));
    t.mock.timers.tick(60_000);
    await refreshGitea();
  });
  assert.deepEqual(
    asLogged(lines)
      .filter((l) => l.level !== 'debug')
      .map((l) => [l.level, l.words]),
    [
      ['error', 'Gitea answered with an error (HTTP 503)'],
      ['error', 'Gitea refused the credentials'],
    ]
  );
  const status = buildStatus({
    inputs: { giteaConfigured: true, cycleErrors: ['gitea'], giteaFailure: giteaFailure() },
    thresholds: DEFAULT_THRESHOLDS,
    now: T0,
  }).status;
  assert.equal(status.sources.gitea.error, 'Gitea refused the credentials');
  giteaWith([['a', 'main']]);
  t.mock.timers.tick(GITEA_POLL_MS);
  await captureLogs(() => refreshGitea());
  assert.equal(giteaFailure(), null, 'answering again: no failure kept');
});

test('the old names GITEA_URL and GITEA_TOKEN still work, for one release (#249)', async () => {
  const saved = [process.env.JAGHELM_GITEA_URL, process.env.JAGHELM_GITEA_TOKEN];
  delete process.env.JAGHELM_GITEA_URL;
  delete process.env.JAGHELM_GITEA_TOKEN;
  process.env.GITEA_URL = 'http://old-gitea.test:3000';
  process.env.GITEA_TOKEN = 'old-name-token'; // pragma: allowlist secret
  try {
    const seen = [];
    globalThis.fetch = async (url, init = {}) => {
      seen.push([String(url), new Headers(init.headers).get('authorization')]);
      return String(url).includes('/repos/search')
        ? Response.json({
            ok: true,
            data: [{ name: 'r', full_name: 'o/r', default_branch: 'main', has_actions: false }],
          })
        : COMMITS();
    };
    const { result } = await refreshOnce();
    assert.deepEqual(result.map((r) => r.fullName), ['o/r']);
    assert.deepEqual(seen, [
      ['http://old-gitea.test:3000/api/v1/repos/search?limit=20', 'token old-name-token'],
      [`http://old-gitea.test:3000/api/v1/repos/o/r/commits?limit=5&sha=main${SLIM}`, 'token old-name-token'],
    ]);
  } finally {
    delete process.env.GITEA_URL;
    delete process.env.GITEA_TOKEN;
    [process.env.JAGHELM_GITEA_URL, process.env.JAGHELM_GITEA_TOKEN] = saved;
  }
});

// ── CI status, branch and sha on each row, one request per repo (#532) ───

/**
 * A Gitea whose repos/search lists `repos` under o/, each `{ name, actions,
 * runs }`: `actions` false is a repo with Actions off (has_actions: false);
 * `runs` is its run list, or a function answering the runs request. Its
 * commits request answers one commit. The URLs it was asked are returned.
 */
function giteaWithRuns(repos) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/repos/search')) {
      return Response.json({
        ok: true,
        data: repos.map((r) => ({
          name: r.name,
          full_name: `o/${r.name}`,
          fork: false,
          mirror: false,
          archived: false,
          default_branch: 'main',
          has_actions: r.actions !== false,
        })),
      });
    }
    const repo = repos.find((r) => u.includes(`/repos/o/${r.name}/`));
    if (u.includes('/actions/runs')) {
      if (typeof repo.runs === 'function') return repo.runs();
      return Response.json({ total_count: repo.runs.length, workflow_runs: repo.runs });
    }
    return COMMITS();
  };
  return calls;
}

const RUNS_URL = (repo) =>
  `http://gitea.test:3060/api/v1/repos/o/${repo}/actions/runs?event=push&limit=10`;
const COMMITS_URL = (repo) =>
  `http://gitea.test:3060/api/v1/repos/o/${repo}/commits?limit=5&sha=main${SLIM}`;

test('a failed run: its row is crit, "Failed", with its branch and short sha, served by the route (#532)', async () => {
  giteaWithRuns([
    {
      name: 'app',
      runs: [
        ciRun(2, 'f00dfeed', {
          branch: 'fix/access-log-245',
          conclusion: 'failure',
          title: 'Log every request',
          at: '2026-10-20T08:00:00Z',
        }),
        ciRun(1, 'c0ffee11', { at: '2026-10-20T07:00:00Z', title: 'Merge pull request #12' }),
      ],
    },
  ]);

  const { result, lines } = await refreshOnce();

  assert.deepEqual(lines, []);
  assert.deepEqual(result, [
    {
      repo: 'app',
      fullName: 'o/app',
      commits: [
        {
          sha: 'f00dfee',
          message: 'Log every request',
          date: '2026-10-20T08:00:00Z',
          author: 'Jag',
          ref: 'fix/access-log-245',
          ci: { state: 'crit', word: 'Failed' },
        },
        {
          sha: 'c0ffee1',
          message: 'Merge pull request #12',
          date: '2026-10-20T07:00:00Z',
          author: 'Jag',
          ref: 'main',
          ci: { state: 'ok', word: 'Passed' },
        },
      ],
    },
  ]);
  const app = express();
  app.use('/api', infrastructureRoutes);
  const res = await request(app).get('/api/gitea/activity');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body[0].commits[0].ci, { state: 'crit', word: 'Failed' });
});

test('one request per repo per poll, however many rows and runs (#532)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 3_000_000_000_000 });
  // Ten runs each: two workflows on each of five commits.
  const runs = (repo) =>
    Array.from({ length: 10 }, (_, i) =>
      ciRun(100 - i, `${repo}${Math.floor(i / 2)}`, {
        workflow: i % 2 ? 'deploy.yml' : 'check.yml',
      })
    );
  const calls = giteaWithRuns(['a', 'b', 'c'].map((name) => ({ name, runs: runs(name) })));

  const first = await refreshGitea();

  // A full page: its oldest commit may have runs off it, so it is left out.
  assert.deepEqual(
    first.map((r) => r.commits.length),
    [4, 4, 4],
    'four rows a repo'
  );
  assert.deepEqual(calls.sort(), [
    RUNS_URL('a'),
    RUNS_URL('b'),
    RUNS_URL('c'),
    'http://gitea.test:3060/api/v1/repos/search?limit=20',
  ]);

  // Between polls nothing; the next poll asks the same four again.
  t.mock.timers.tick(GITEA_POLL_MS - 1);
  await refreshGitea();
  assert.equal(calls.length, 4);
  t.mock.timers.tick(1);
  await refreshGitea();
  assert.equal(calls.length, 8);
});

test("a commit's runs are one row: the newest run of each workflow, the worst answer of them (#532)", async () => {
  giteaWithRuns([
    {
      name: 'app',
      runs: [
        // A deploy that failed, run again and now passing; its check still running.
        ciRun(5, 'aaaaaaa', { workflow: 'deploy.yml' }),
        ciRun(4, 'aaaaaaa', { workflow: 'check.yml', status: 'in_progress' }),
        ciRun(3, 'aaaaaaa', { workflow: 'deploy.yml', conclusion: 'failure' }),
        // The same commit pushed to another branch is its own row.
        ciRun(2, 'aaaaaaa', { branch: 'release', conclusion: 'cancelled' }),
        ciRun(1, 'bbbbbbb', { conclusion: 'skipped' }),
      ],
    },
  ]);

  const { result } = await refreshOnce();

  assert.deepEqual(
    result[0].commits.map((c) => [c.sha, c.ref, c.ci.word, c.ci.state]),
    [
      ['aaaaaaa', 'main', 'Running', 'unknown'],
      ['aaaaaaa', 'release', 'Cancelled', 'unknown'],
      ['bbbbbbb', 'main', 'Skipped', 'unknown'],
    ]
  );
});

test('a repo without Actions: its commits, no lamp, no false failure, no log line (#532)', async () => {
  const notFound = () => Response.json({ message: 'not found' }, { status: 404 });
  const calls = giteaWithRuns([
    // Actions off: its commits, and no runs request.
    { name: 'off', actions: false, runs: [] },
    // Actions on, no workflow yet (Gitea answers "pending" for such a commit's status).
    { name: 'idle', runs: [] },
    // A Gitea, or a repo, with no Actions API: 404.
    { name: 'old', runs: notFound },
    { name: 'ci', runs: [ciRun(1, 'ccccccc', { conclusion: 'failure' })] },
  ]);

  const { result, lines } = await refreshOnce();

  assert.deepEqual(lines, []);
  const byRepo = Object.fromEntries(result.map((r) => [r.repo, r.commits]));
  for (const repo of ['off', 'idle', 'old']) {
    assert.deepEqual(
      byRepo[repo],
      [{ sha: 'abcdef1', message: 'm', date: '2026-10-10', author: 'a', ref: 'main', ci: null }],
      repo
    );
  }
  assert.equal(byRepo.ci[0].ci.word, 'Failed', 'only the run that failed reads as failed');
  // One request for the repo with runs and the one with Actions off; two for
  // the repos whose runs request answered no run.
  assert.deepEqual(calls.filter((u) => !u.includes('/search')).sort(), [
    RUNS_URL('ci'),
    RUNS_URL('idle'),
    COMMITS_URL('idle'),
    COMMITS_URL('off'),
    RUNS_URL('old'),
    COMMITS_URL('old'),
  ]);
  let errors;
  await captureLogs(async () => {
    errors = await runCycleRefreshes([['gitea', refreshGitea]]);
  });
  assert.deepEqual(errors, [], 'no cycle error');
});

test('a runs request that fails leaves that repo out, as a commits request did; all failing fails the poll (#532)', async () => {
  const down = () => {
    throw new Error('fetch failed');
  };
  giteaWithRuns([
    { name: 'a', runs: down },
    { name: 'b', runs: [ciRun(1, 'bbbbbbb')] },
  ]);
  const some = await refreshOnce();
  assert.deepEqual(
    some.result.map((r) => r.repo),
    ['b']
  );
  assert.deepEqual(some.lines, []);

  giteaWithRuns([
    { name: 'a', runs: down },
    { name: 'b', runs: down },
  ]);
  const all = await refreshOnce();
  assert.equal(all.result, null);
  assert.deepEqual(
    all.lines.map((l) => [l.level, l.msg, l.repos]),
    [['error', 'Gitea refresh error: every repo request failed', 2]]
  );
});

test('a full page of runs leaves out its oldest commit, whose other workflows may be off it: no false "Passed" (#532)', async () => {
  // Four workflows a push, as ilaaj-nanoclaw has: ten runs are two commits
  // whole and two of the third's runs, which passed; its other two, off the
  // page, failed.
  const push = (first, sha, conclusions) =>
    conclusions.map((conclusion, i) =>
      ciRun(first - i, sha, { workflow: `w${i}.yml`, conclusion })
    );
  const page = [
    ...push(100, 'aaaaaaa', ['success', 'success', 'success', 'success']),
    ...push(90, 'bbbbbbb', ['success', 'failure', 'success', 'success']),
    ...push(80, 'ccccccc', ['success', 'success']),
  ];
  assert.equal(page.length, 10);
  giteaWithRuns([{ name: 'app', runs: page }]);

  const { result } = await refreshOnce();

  assert.deepEqual(
    result[0].commits.map((c) => [c.sha, c.ci.word]),
    [
      ['aaaaaaa', 'Passed'],
      ['bbbbbbb', 'Failed'],
    ]
  );

  // A page that isn't full holds every run there is: all its commits are rows.
  giteaWithRuns([{ name: 'app', runs: page.slice(0, 9) }]);
  const short = await refreshOnce();
  assert.deepEqual(
    short.result[0].commits.map((c) => c.sha),
    ['aaaaaaa', 'bbbbbbb', 'ccccccc']
  );

  // A full page of one commit's runs keeps it: there is no other to show.
  giteaWithRuns([{ name: 'app', runs: push(100, 'ddddddd', Array(10).fill('success')) }]);
  const one = await refreshOnce();
  assert.deepEqual(
    one.result[0].commits.map((c) => c.sha),
    ['ddddddd']
  );
});

test('a repo with Actions on but no run is asked for its commits alone for an hour, then for runs again (#532)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 4_000_000_000_000 });
  const idle = { name: 'idle', runs: [] };
  const calls = giteaWithRuns([idle, { name: 'ci', runs: [ciRun(1, 'ccccccc')] }]);
  const asked = () =>
    calls
      .splice(0)
      .filter((u) => !u.includes('/search'))
      .sort();

  // The first poll finds no run: its commits, a second request.
  await refreshGitea();
  assert.deepEqual(asked(), [RUNS_URL('ci'), RUNS_URL('idle'), COMMITS_URL('idle')]);

  // Each poll in the next hour: one request a repo.
  for (let poll = 1; poll < 12; poll += 1) {
    t.mock.timers.tick(GITEA_POLL_MS);
    const result = await refreshGitea();
    assert.deepEqual(asked(), [RUNS_URL('ci'), COMMITS_URL('idle')], `poll ${poll}`);
    assert.equal(result.find((r) => r.repo === 'idle').commits[0].ci, null);
  }

  // An hour on, its runs are asked for again: a first workflow shows.
  idle.runs = [ciRun(2, 'iiiiiii', { conclusion: 'failure' })];
  t.mock.timers.tick(GITEA_POLL_MS);
  const result = await refreshGitea();
  assert.deepEqual(asked(), [RUNS_URL('ci'), RUNS_URL('idle')]);
  assert.equal(result.find((r) => r.repo === 'idle').commits[0].ci.word, 'Failed');
});
