/**
 * #425: an endpoint placeholder takes the resolved credential, never the
 * `$secret:` reference it was resolved from.
 *
 * A custom integration whose endpoint puts the token in the URL
 * (`/api/stats?key={token}`) used to send the literal reference once the token
 * was stored as `$secret:…`, which is what a Settings save writes, because the
 * raw `token` was looked up ahead of the resolved `_token`. These tests drive
 * fetchIntegration against a stub upstream on 127.0.0.1 that records the URL of
 * every request it gets, with a real secrets store behind the references.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';

process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret

const { initSecrets, setSecret } = await import('../secrets.js');
const { initRegistry } = await import('./registry.js');
const { fetchIntegration, testIntegration } = await import('./handler.js');

initSecrets();
await initRegistry();
for (const v of ['SABNZBD_URL', 'SABNZBD_API_KEY']) delete process.env[v];

// Random, so a match in a URL or a log line can only be the value itself.
const hex = () => randomBytes(8).toString('hex');

/** A stub upstream: answers every request with `{ up: true }` and records its URL. */
function upstream(answer) {
  return new Promise((resolve) => {
    const urls = [];
    const srv = http.createServer((req, res) => {
      urls.push(req.url);
      if (answer) return answer(req, res);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ up: true, token: 'session-tok' }));
    });
    srv.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${srv.address().port}`, urls, close: () => srv.close() });
    });
  });
}

const up = await upstream();
after(() => up.close());

/** A custom integration's services.yaml entry, as the refresh loop hands it over. */
function custom(extra) {
  const key = `custom_${hex()}`;
  return {
    key,
    yaml: {
      url: up.url,
      auth: 'none',
      fields: [{ key: 'up', label: 'Up', path: 'up' }],
      _storageKey: key,
      ...extra,
    },
  };
}

/** Store `value` under the name a Settings save uses, and return its reference. */
function stored(key, field, value) {
  const name = `integration_${key}_${field}`;
  assert.equal(setSecret(name, value), true, 'the secrets store took the value');
  return `$secret:${name}`;
}

/** The JSON log lines `fn` writes, and what it returns. */
async function captureLogs(fn) {
  const lines = [];
  const orig = { out: process.stdout.write, err: process.stderr.write };
  const tap = (write) =>
    function (chunk, ...rest) {
      try {
        const obj = JSON.parse(String(chunk));
        if (obj?.module && obj.level) {
          lines.push(obj);
          return true;
        }
      } catch {
        // not a log line
      }
      return write.call(this, chunk, ...rest);
    };
  process.stdout.write = tap(orig.out);
  process.stderr.write = tap(orig.err);
  try {
    const result = await fn();
    return { result, lines };
  } finally {
    process.stdout.write = orig.out;
    process.stderr.write = orig.err;
  }
}

/** The URLs the upstream got while `fn` ran. */
async function requested(fn) {
  const from = up.urls.length;
  const out = await fn();
  return { ...out, urls: up.urls.slice(from) };
}

const UNRESOLVED = /Couldn't resolve the stored credential/;

// ── A $secret: token is sent resolved ────────────────────────────────────

test('a {token} endpoint with a $secret: token sends the resolved token', async () => {
  const value = `tok-${hex()}`;
  const { key, yaml } = custom({ endpoint: '/api/stats?key={token}' });
  yaml.token = stored(key, 'token', value);

  const { result, urls } = await requested(async () => ({ result: await fetchIntegration(key, yaml) }));

  assert.equal(result.error, null);
  assert.deepEqual(result.fields, { Up: 'true' });
  assert.deepEqual(urls, [`/api/stats?key=${value}`]);
});

test('{password}, {_token} and a {token} in the path take the resolved value too', async () => {
  for (const [endpoint, field] of [
    ['/status?pw={password}', 'password'],
    ['/status?key={_token}', 'token'],
    ['/api/{token}/status', 'token'],
  ]) {
    const value = `v-${hex()}`;
    const { key, yaml } = custom({ endpoint });
    yaml[field] = stored(key, field, value);

    const { result, urls } = await requested(async () => ({ result: await fetchIntegration(key, yaml) }));

    assert.equal(result.error, null, endpoint);
    assert.deepEqual(urls, [endpoint.replace(/\{_?\w+\}/, value)], endpoint);
  }
});

test('an extra endpoint with {token} sends the resolved token', async () => {
  const value = `tok-${hex()}`;
  const { key, yaml } = custom({
    endpoint: '/status',
    extraEndpoints: [{ key: 'more', endpoint: '/more?key={token}' }],
  });
  yaml.token = stored(key, 'token', value);

  const { result, urls } = await requested(async () => ({ result: await fetchIntegration(key, yaml) }));

  assert.equal(result.error, null);
  assert.deepEqual(urls.sort(), ['/more?key=' + value, '/status'].sort());
});

test('a resolved {token} still refuses a redirect to another origin', async () => {
  const other = await upstream();
  const from = await upstream((req, res) => {
    res.writeHead(302, { location: `${other.url}${req.url}` });
    res.end();
  });
  try {
    const value = `tok-${hex()}`;
    const { key, yaml } = custom({ url: from.url, endpoint: '/api/stats?key={token}' });
    yaml.token = stored(key, 'token', value);

    const result = await fetchIntegration(key, yaml);

    assert.deepEqual(from.urls, [`/api/stats?key=${value}`]);
    assert.match(result.error, /redirect/i);
    assert.deepEqual(other.urls, [], 'the other origin received the token');
  } finally {
    other.close();
    from.close();
  }
});

// ── A plaintext token works as before ────────────────────────────────────

test('a {token} endpoint with a plaintext token sends it as written', async () => {
  for (const endpoint of ['/api/stats?key={token}', '/api/{token}/status']) {
    const value = `plain-${hex()}`;
    const { key, yaml } = custom({ endpoint, token: value });

    const { result, urls } = await requested(async () => ({ result: await fetchIntegration(key, yaml) }));

    assert.equal(result.error, null, endpoint);
    assert.deepEqual(result.fields, { Up: 'true' });
    assert.deepEqual(urls, [endpoint.replace('{token}', value)], endpoint);
  }
});

test('a plaintext {username} and {password} are sent as written', async () => {
  const user = `u-${hex()}`;
  const pass = `p-${hex()}`;
  const { key, yaml } = custom({ endpoint: '/u/{username}?pw={password}', username: user, password: pass });

  const { result, urls } = await requested(async () => ({ result: await fetchIntegration(key, yaml) }));

  assert.equal(result.error, null);
  assert.deepEqual(urls, [`/u/${user}?pw=${pass}`]);
});

// ── An unresolvable reference never reaches the URL or the log ───────────

/**
 * Fetch `yaml` and check that no request went out, the error says a credential
 * couldn't be resolved, and neither the error nor any log line names `ref`.
 */
async function assertRefused(key, yaml, ref, { logged = 'fetch error' } = {}) {
  const name = ref.replace(/^\$secret:/, '');
  const { result, lines, urls } = await requested(() => captureLogs(() => fetchIntegration(key, yaml)));

  for (const url of urls) {
    assert.ok(!url.includes('secret') && !url.includes(name), `the reference reached the upstream: ${url}`);
  }
  const log = JSON.stringify(lines);
  assert.ok(!log.includes('$secret') && !log.includes(name), `the reference was logged: ${log}`);
  assert.ok(
    lines.some((l) => l.msg === logged && UNRESOLVED.test(JSON.stringify(l))),
    `no '${logged}' line says why: ${log}`
  );
  return { result, urls };
}

test('an unresolvable $secret: token is never sent or logged, and the error says why', async () => {
  for (const ref of [
    `$secret:hand_${hex()}`, // pragma: allowlist secret
    `$secret:integration_gone_${hex()}_token`, // pragma: allowlist secret
  ]) {
    const { key, yaml } = custom({ endpoint: '/api/stats?key={token}', token: ref });

    const { result, urls } = await assertRefused(key, yaml, ref);

    assert.deepEqual(urls, [], 'a request went out without the token');
    assert.match(result.error, UNRESOLVED);
    assert.match(result.error, /\{token\}/);
    assert.equal(result.authRejected, undefined);
  }
});

test('{password}, {_token} and a $secret:-looking {username} are refused the same way', async () => {
  for (const [endpoint, field] of [
    ['/status?pw={password}', 'password'],
    ['/status?key={_token}', 'token'],
    ['/u/{username}', 'username'],
  ]) {
    const ref = `$secret:missing_${hex()}`; // pragma: allowlist secret
    const { key, yaml } = custom({ endpoint, [field]: ref });

    const { result, urls } = await assertRefused(key, yaml, ref);

    assert.deepEqual(urls, [], endpoint);
    assert.match(result.error, UNRESOLVED, endpoint);
  }
});

test('an unresolvable token in an extra endpoint skips that request only', async () => {
  const ref = `$secret:missing_${hex()}`; // pragma: allowlist secret
  const { key, yaml } = custom({
    endpoint: '/status',
    token: ref,
    extraEndpoints: [{ key: 'more', endpoint: '/more?key={token}' }],
  });

  const { result, urls } = await assertRefused(key, yaml, ref, { logged: 'extra endpoint fetch failed' });

  assert.deepEqual(urls, ['/status']);
  assert.equal(result.error, null);
});

test('a session integration with an unresolvable {token} endpoint sends no login', async () => {
  const ref = `$secret:missing_${hex()}`; // pragma: allowlist secret
  const { key, yaml } = custom({
    auth: 'session',
    endpoint: '/data?key={token}',
    token: ref,
    username: 'u',
    password: 'p',
    session: { loginEndpoint: '/login', loginBody: { u: '{username}', p: '{password}' }, tokenPath: 'token', tokenHeader: 'X-Token' },
  });

  const { result, urls } = await assertRefused(key, yaml, ref);

  assert.deepEqual(urls, []);
  assert.match(result.error, UNRESOLVED);
});

test('query auth with an unresolvable $secret: token sends nothing', async () => {
  const ref = `$secret:missing_${hex()}`; // pragma: allowlist secret
  const { key, yaml } = custom({ auth: 'query', endpoint: '/status', token: ref });

  const { result, urls } = await assertRefused(key, yaml, ref);

  assert.deepEqual(urls, []);
  assert.match(result.error, UNRESOLVED);
});

test('query auth with a $secret: token sends the resolved one', async () => {
  const value = `tok-${hex()}`;
  const { key, yaml } = custom({ auth: 'query', endpoint: '/status' });
  yaml.token = stored(key, 'token', value);

  const { result, urls } = await requested(async () => ({ result: await fetchIntegration(key, yaml) }));

  assert.equal(result.error, null);
  assert.deepEqual(urls, [`/status?apikey=${value}`]);
});

test('a connection test never puts a $secret: reference typed as the token in the URL', async () => {
  const ref = `$secret:typed_${hex()}`; // pragma: allowlist secret
  const name = ref.replace(/^\$secret:/, '');

  // SABnzbd is a query-auth preset: its key goes in the URL.
  const { urls, result } = await requested(async () => ({
    result: await testIntegration('sabnzbd', { url: up.url, token: ref }),
  }));

  for (const url of urls) assert.ok(!url.includes(name), url);
  assert.equal(result.ok, false);
  assert.match(result.error, UNRESOLVED);
  assert.ok(!result.error.includes(name));
});
