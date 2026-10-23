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
 * repo's commits request failing. No log line carries the token or a URL's
 * password.
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
const { GITEA_POLL_MS, _resetGiteaPoll, refreshGitea } = await import('./gitea.js');
const { getCached, setCache } = await import('./cache.js');
const { infrastructureRoutes } = await import('./routes/infrastructure.js');

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => _resetGiteaPoll());

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

test('refreshGitea: token goes in the Authorization header, not the URL', async () => {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: new Headers(init.headers) });
    const body = String(url).includes('/repos/search')
      ? { data: [{ name: 'r', full_name: 'o/r', fork: false, mirror: false, archived: false }] }
      : [{ sha: 'abcdef123', commit: { message: 'm', author: { date: '2026-10-10', name: 'a' } } }];
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };

  const result = await refreshGitea();

  assert.equal(result.length, 1);
  assert.equal(calls.length, 2); // guards against the loop below passing vacuously
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
      [{ level: 'error', module: 'refresh', msg: 'Gitea refresh error: no repo list in the answer', status: 200 }],
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
      { level: 'error', module: 'refresh', msg: 'Gitea refresh error: no repo list in the answer', status },
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
 * Make repos/search list the repos `a` and `b`, and each commits request
 * answer what `commits[repo]` gives: a Response, or a thrown error.
 */
function commitsAnswer(commits) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/repos/search')) {
      const repos = ['a', 'b'].map((n) => ({ name: n, full_name: `o/${n}`, fork: false, mirror: false, archived: false }));
      return Response.json({ ok: true, data: repos });
    }
    return commits[u.match(/\/repos\/o\/(\w+)\/commits/)[1]]();
  };
}

const COMMITS = () =>
  Response.json([{ sha: 'abcdef123', commit: { message: 'm', author: { date: '2026-10-10', name: 'a' } } }]);

test('every commits request failing fails the refresh: one redacted line, nothing cached, a cycle error, a 502', async () => {
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
    [['error', 'Gitea refresh error: every commits request failed', 2]]
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
 * A Gitea whose repos/search lists `repos` (name, default_branch) under o/,
 * each answering one commit; the URLs it was asked are in the returned list.
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
          ...(branch !== undefined && { default_branch: branch }),
        })),
      });
    }
    return COMMITS();
  };
  return calls;
}

test("a poll reads each repo once, on the branch Gitea names as the repo's default (#249)", async () => {
  const calls = giteaWith([['a', 'main'], ['b', 'develop'], ['c', 'release/2.x'], ['d', undefined]]);

  const { result, lines } = await refreshOnce();

  assert.deepEqual(lines, []);
  assert.deepEqual(result.map((r) => r.fullName).sort(), ['o/a', 'o/b', 'o/c', 'o/d']);
  const base = 'http://gitea.test:3060/api/v1/repos';
  assert.deepEqual(calls.sort(), [
    `${base}/o/a/commits?limit=5&sha=main`,
    `${base}/o/b/commits?limit=5&sha=develop`,
    `${base}/o/c/commits?limit=5&sha=release%2F2.x`,
    // No default branch named: Gitea's own default, with no sha.
    `${base}/o/d/commits?limit=5`,
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

test('a failed poll is a cycle error and a 502 until the next poll, with no request between (#249)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 2_000_000 });
  giteaWith([['a', 'main']]);
  await refreshGitea();
  assert.ok(Array.isArray(getCached('gitea')));
  const app = express();
  app.use('/api', infrastructureRoutes);

  t.mock.timers.tick(GITEA_POLL_MS);
  const calls = searchAnswers(503, '', 'text/plain');
  let errors;
  let res;
  await captureLogs(async () => {
    assert.equal(await refreshGitea(), null);
    t.mock.timers.tick(60_000);
    errors = await runCycleRefreshes([['gitea', refreshGitea]]);
    res = await request(app).get('/api/gitea/activity');
  });
  assert.deepEqual(errors, ['gitea'], 'still failed: the status model keeps Gitea failed');
  assert.equal(res.status, 502, 'the old list is not served as if Gitea answered');
  assert.equal(calls.length, 1, 'one request: the failed poll');

  t.mock.timers.tick(GITEA_POLL_MS);
  giteaWith([['a', 'main']]);
  assert.deepEqual(await runCycleRefreshes([['gitea', refreshGitea]]), [], 'recovered at the next poll');
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
        ? Response.json({ ok: true, data: [{ name: 'r', full_name: 'o/r', default_branch: 'main' }] })
        : COMMITS();
    };
    const { result } = await refreshOnce();
    assert.deepEqual(result.map((r) => r.fullName), ['o/r']);
    assert.deepEqual(seen, [
      ['http://old-gitea.test:3000/api/v1/repos/search?limit=20', 'token old-name-token'],
      ['http://old-gitea.test:3000/api/v1/repos/o/r/commits?limit=5&sha=main', 'token old-name-token'],
    ]);
  } finally {
    delete process.env.GITEA_URL;
    delete process.env.GITEA_TOKEN;
    [process.env.JAGHELM_GITEA_URL, process.env.JAGHELM_GITEA_TOKEN] = saved;
  }
});
