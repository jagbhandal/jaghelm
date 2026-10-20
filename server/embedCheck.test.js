/**
 * Embed check (#269): whether an app tab's own headers let the browser show it
 * inside JagHelm. The verdict follows the HTML spec's X-Frame-Options check and
 * CSP3's frame-ancestors matching; the header read is a real HTTP exchange with
 * a local server standing in for the app.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  frameVerdict,
  readFrameHeaders,
  createEmbedChecker,
  EMBED_CHECK_TIMEOUT_MS,
} from './embedCheck.js';

const PARENT = 'https://jaghelm.example';
const verdict = (headers, parent = PARENT, finalUrl = 'https://vault.example/') =>
  frameVerdict({ finalUrl, xfo: headers.xfo ?? null, csp: headers.csp ?? null }, parent);

describe('frameVerdict: X-Frame-Options', () => {
  test('DENY blocks, whatever the case', () => {
    assert.deepEqual(verdict({ xfo: 'DENY' }), { verdict: 'blocked', header: 'X-Frame-Options: DENY' });
    assert.equal(verdict({ xfo: 'deny' }).verdict, 'blocked');
  });

  test('SAMEORIGIN blocks a JagHelm on another origin', () => {
    assert.deepEqual(verdict({ xfo: 'SAMEORIGIN' }), {
      verdict: 'blocked',
      header: 'X-Frame-Options: SAMEORIGIN',
    });
  });

  test('SAMEORIGIN allows an app on JagHelm\'s own origin', () => {
    assert.equal(verdict({ xfo: 'SAMEORIGIN' }, 'https://vault.example').verdict, 'allowed');
  });

  test('two different values block (the spec treats the conflict as deny)', () => {
    assert.equal(verdict({ xfo: 'SAMEORIGIN, DENY' }, 'https://vault.example').verdict, 'blocked');
  });

  test('the same value twice is one value', () => {
    assert.equal(verdict({ xfo: 'SAMEORIGIN, sameorigin' }, 'https://vault.example').verdict, 'allowed');
  });

  test('ALLOW-FROM and other unknown values are ignored, as browsers do', () => {
    assert.equal(verdict({ xfo: 'ALLOW-FROM https://jaghelm.example' }).verdict, 'allowed');
    assert.equal(verdict({ xfo: 'ALLOWALL' }).verdict, 'allowed');
  });

  test('no header allows', () => {
    assert.deepEqual(verdict({}), { verdict: 'allowed' });
  });
});

describe('frameVerdict: CSP frame-ancestors', () => {
  test("'none' blocks", () => {
    assert.deepEqual(verdict({ csp: "default-src 'self'; frame-ancestors 'none'" }), {
      verdict: 'blocked',
      header: "Content-Security-Policy: frame-ancestors 'none'",
    });
  });

  test("'self' blocks another origin and allows the app's own", () => {
    assert.equal(verdict({ csp: "frame-ancestors 'self'" }).verdict, 'blocked');
    assert.equal(verdict({ csp: "frame-ancestors 'self'" }, 'https://vault.example').verdict, 'allowed');
  });

  test("JagHelm's origin listed allows it", () => {
    assert.equal(verdict({ csp: "frame-ancestors 'self' https://jaghelm.example" }).verdict, 'allowed');
    assert.equal(verdict({ csp: 'frame-ancestors jaghelm.example' }).verdict, 'allowed');
    assert.equal(verdict({ csp: 'frame-ancestors https://*.example' }).verdict, 'allowed');
    assert.equal(verdict({ csp: 'frame-ancestors https:' }).verdict, 'allowed');
    assert.equal(verdict({ csp: 'frame-ancestors *' }).verdict, 'allowed');
  });

  test('a scheme, host or port that differs blocks', () => {
    assert.equal(verdict({ csp: 'frame-ancestors http://jaghelm.example' }, 'https://jaghelm.example').verdict, 'allowed');
    assert.equal(verdict({ csp: 'frame-ancestors https://jaghelm.example' }, 'http://jaghelm.example').verdict, 'blocked');
    assert.equal(verdict({ csp: 'frame-ancestors https://other.example' }).verdict, 'blocked');
    assert.equal(verdict({ csp: 'frame-ancestors https://*.jaghelm.example' }).verdict, 'blocked');
    assert.equal(verdict({ csp: 'frame-ancestors https://jaghelm.example' }, 'https://jaghelm.example:8443').verdict, 'blocked');
    assert.equal(verdict({ csp: 'frame-ancestors https://jaghelm.example:8443' }, 'https://jaghelm.example:8443').verdict, 'allowed');
    assert.equal(verdict({ csp: 'frame-ancestors https://jaghelm.example:*' }, 'https://jaghelm.example:8443').verdict, 'allowed');
    assert.equal(verdict({ csp: 'frame-ancestors http://192.168.1.5:3099' }, 'http://192.168.1.5:3099').verdict, 'allowed');
  });

  test('frame-ancestors wins over X-Frame-Options', () => {
    assert.equal(verdict({ xfo: 'DENY', csp: 'frame-ancestors https://jaghelm.example' }).verdict, 'allowed');
  });

  test('every policy is enforced: one that blocks is enough', () => {
    const csp = "frame-ancestors https://jaghelm.example, frame-ancestors 'none'";
    assert.deepEqual(verdict({ csp }), {
      verdict: 'blocked',
      header: "Content-Security-Policy: frame-ancestors 'none'",
    });
  });

  test('a policy without frame-ancestors leaves X-Frame-Options in charge', () => {
    assert.equal(verdict({ xfo: 'DENY', csp: "default-src 'self'" }).verdict, 'blocked');
    assert.equal(verdict({ csp: "default-src 'none'" }).verdict, 'allowed');
  });

  test('an empty frame-ancestors blocks, as the spec says', () => {
    assert.equal(verdict({ csp: 'frame-ancestors' }).verdict, 'blocked');
  });
});

// A local stand-in for an app: answers with the headers a test asks for and
// records what each request carried.
function appServer(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    handler(req, res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
      resolve({ server, seen, base: `http://127.0.0.1:${port}`, port });
    });
  });
}

const servers = [];
after(() => {
  for (const s of servers) {
    s.closeAllConnections();
    s.close();
  }
});
async function startApp(handler) {
  const s = await appServer(handler);
  servers.push(s.server);
  return s;
}

describe('readFrameHeaders', () => {
  test('reads the two headers and sends no credential', async () => {
    const app = await startApp((req, res) => {
      res.writeHead(200, {
        'X-Frame-Options': 'SAMEORIGIN',
        'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self'",
        'Set-Cookie': 'session=abc',
      });
      res.end('<html>secret page</html>');
    });
    const r = await readFrameHeaders(`${app.base}/vault/`);
    assert.deepEqual(r, {
      ok: true,
      finalUrl: `${app.base}/vault/`,
      xfo: 'SAMEORIGIN',
      csp: "default-src 'self'; frame-ancestors 'self'",
    });
    assert.equal(app.seen.length, 1);
    assert.equal(app.seen[0].headers.cookie, undefined);
    assert.equal(app.seen[0].headers.authorization, undefined);
  });

  test('follows a redirect on the same host and reads the final answer', async () => {
    const app = await startApp((req, res) => {
      if (req.url === '/') {
        res.writeHead(302, { Location: '/login' });
        return res.end();
      }
      res.writeHead(200, { 'X-Frame-Options': 'DENY' });
      res.end('login');
    });
    const r = await readFrameHeaders(`${app.base}/`);
    assert.deepEqual(r, { ok: true, finalUrl: `${app.base}/login`, xfo: 'DENY', csp: null });
  });

  test('does not follow a redirect to another host', async () => {
    const other = await startApp((req, res) => {
      res.writeHead(200);
      res.end('elsewhere');
    });
    const app = await startApp((req, res) => {
      // localhost and 127.0.0.1 are different hosts to the check.
      res.writeHead(302, { Location: `http://localhost:${other.port}/` });
      res.end();
    });
    const r = await readFrameHeaders(`${app.base}/`);
    assert.deepEqual(r, { ok: false, reason: 'redirected to another host' });
    assert.equal(other.seen.length, 0);
  });

  test('gives up on a redirect loop', async () => {
    const app = await startApp((req, res) => {
      res.writeHead(302, { Location: '/again' });
      res.end();
    });
    const r = await readFrameHeaders(`${app.base}/`);
    assert.deepEqual(r, { ok: false, reason: 'too many redirects' });
    assert.ok(app.seen.length <= 6);
  });

  test('times out on an app that does not answer', async () => {
    const app = await startApp(() => {
      // never answers
    });
    const started = Date.now();
    const r = await readFrameHeaders(`${app.base}/`, { timeoutMs: 150 });
    assert.deepEqual(r, { ok: false, reason: 'timed out' });
    assert.ok(Date.now() - started < 2000);
    assert.ok(EMBED_CHECK_TIMEOUT_MS <= 5000, 'the default timeout is short');
  });

  test('an unreachable app, a URL with a password and a non-http URL are not checked', async () => {
    assert.deepEqual(await readFrameHeaders('http://127.0.0.1:1/'), { ok: false, reason: 'unreachable' });
    assert.deepEqual(await readFrameHeaders('http://jag:hunter2@127.0.0.1:1/'), {
      ok: false,
      reason: 'not an http(s) URL without credentials',
    });
    assert.deepEqual(await readFrameHeaders('file:///etc/passwd'), {
      ok: false,
      reason: 'not an http(s) URL without credentials',
    });
    assert.deepEqual(await readFrameHeaders('http://169.254.169.254/latest/meta-data/'), {
      ok: false,
      reason: 'refused',
    });
  });
});

describe('createEmbedChecker', () => {
  const tabs = (url) => [
    { id: 'dash', label: 'Dashboard', type: 'dashboard' },
    { id: 'vault', label: 'Vaultwarden', type: 'iframe', url },
  ];

  test('looks the URL up by tab id and caches the answer', async () => {
    const calls = [];
    let now = 1000;
    const checker = createEmbedChecker({
      readTabs: () => tabs('https://vault.example/'),
      readHeaders: async (url) => {
        calls.push(url);
        return { ok: true, finalUrl: url, xfo: 'DENY', csp: null };
      },
      now: () => now,
    });
    const a = await checker.check('vault');
    assert.equal(a.url, 'https://vault.example/');
    assert.equal(a.result.xfo, 'DENY');
    now += 60_000;
    await checker.check('vault');
    assert.deepEqual(calls, ['https://vault.example/']);
  });

  test('a tab id it does not know, or a tab that is not an app, gives null', async () => {
    const checker = createEmbedChecker({
      readTabs: () => tabs('https://vault.example/'),
      readHeaders: async () => assert.fail('nothing to fetch'),
    });
    assert.equal(await checker.check('dash'), null);
    assert.equal(await checker.check('nope'), null);
    assert.equal(await checker.check('__proto__'), null);
  });

  test('two checks at once share one request', async () => {
    let calls = 0;
    const checker = createEmbedChecker({
      readTabs: () => tabs('https://vault.example/'),
      readHeaders: async (url) => {
        calls++;
        await new Promise((r) => setTimeout(r, 20));
        return { ok: true, finalUrl: url, xfo: null, csp: null };
      },
    });
    await Promise.all([checker.check('vault'), checker.check('vault')]);
    assert.equal(calls, 1);
  });

  test('a changed URL, an expired answer or a fresh check after a few seconds asks again', async () => {
    const calls = [];
    let url = 'https://vault.example/';
    let now = 0;
    const checker = createEmbedChecker({
      readTabs: () => tabs(url),
      readHeaders: async (u) => {
        calls.push(u);
        return { ok: true, finalUrl: u, xfo: null, csp: null };
      },
      now: () => now,
    });
    await checker.check('vault');
    await checker.check('vault', { fresh: true }); // too soon: the cached answer
    assert.equal(calls.length, 1);
    now += 6_000;
    await checker.check('vault', { fresh: true });
    assert.equal(calls.length, 2);
    url = 'https://vault2.example/';
    await checker.check('vault');
    assert.deepEqual(calls.at(-1), 'https://vault2.example/');
    now += 10 * 60_000;
    await checker.check('vault');
    assert.equal(calls.length, 4);
  });

  test('a failed read is kept for a shorter time', async () => {
    let calls = 0;
    let now = 0;
    const checker = createEmbedChecker({
      readTabs: () => tabs('https://vault.example/'),
      readHeaders: async () => {
        calls++;
        return { ok: false, reason: 'unreachable' };
      },
      now: () => now,
    });
    await checker.check('vault');
    now += 30_000;
    await checker.check('vault');
    assert.equal(calls, 1);
    now += 40_000;
    await checker.check('vault');
    assert.equal(calls, 2);
  });

  test('past the outbound limit it reads nothing and caches nothing', async () => {
    let calls = 0;
    let allow = false;
    const checker = createEmbedChecker({
      readTabs: () => tabs('https://vault.example/'),
      readHeaders: async (url) => {
        calls++;
        return { ok: true, finalUrl: url, xfo: null, csp: null };
      },
      allowRead: () => allow,
    });
    assert.deepEqual((await checker.check('vault')).result, { ok: false, reason: 'too many checks' });
    assert.equal(calls, 0);
    allow = true;
    assert.equal((await checker.check('vault')).result.ok, true);
    assert.equal(calls, 1);
  });

  test('the default limit allows 30 reads a minute, all tabs together', async () => {
    const many = Array.from({ length: 31 }, (_, i) => ({ id: `t${i}`, type: 'iframe', url: `https://a${i}.example/` }));
    let calls = 0;
    const checker = createEmbedChecker({
      readTabs: () => many,
      readHeaders: async (url) => {
        calls++;
        return { ok: true, finalUrl: url, xfo: null, csp: null };
      },
    });
    for (const t of many.slice(0, 30)) assert.equal((await checker.check(t.id)).result.ok, true);
    assert.equal((await checker.check('t30')).result.reason, 'too many checks');
    assert.equal(calls, 30);
  });
});
