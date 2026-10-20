/**
 * refreshGitea must send GITEA_TOKEN as an Authorization header, never in the
 * query string — Gitea's router log records full request URLs, so a ?token=
 * param leaks the credential into container logs (and anything shipping them).
 *
 * Without GITEA_URL no Gitea is set up (#272): nothing is polled, the payload
 * says so, and the boot logs it once.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.GITEA_URL = 'http://gitea.test:3060';
process.env.GITEA_TOKEN = 'secret-test-token';

const { refreshGitea, runCycleRefreshes, startBackgroundRefresh, stopBackgroundRefresh, getRefreshHealth } =
  await import('./refresh.js');
const { getCached } = await import('./cache.js');

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

/** Run `fn` with GITEA_URL unset, then put it back. */
async function withoutGiteaUrl(fn) {
  const saved = process.env.GITEA_URL;
  delete process.env.GITEA_URL;
  try {
    return await fn();
  } finally {
    process.env.GITEA_URL = saved;
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

test('without GITEA_URL: answers { configured: false }, fetches nothing, logs nothing and is no cycle error', async () => {
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

test('without GITEA_URL: the boot logs "Gitea panel off" once, and no cycle logs it again', async (t) => {
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
    [['info', 'Gitea panel off: GITEA_URL is not set']]
  );
});

test('with GITEA_URL set, the boot does not log "Gitea panel off"', async (t) => {
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
