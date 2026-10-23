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
 *
 * #428: header, bearer, basic, query and session auth refuse the same way when
 * a credential they send is a `$secret:` reference whose secret is missing or
 * won't decrypt: nothing is sent, and it is not a refused login.
 *
 * #429: a credential filled into an endpoint is URL-encoded, so one with `&`,
 * `#`, `/`, `?`, a space or `@` reaches the upstream as it is, on the
 * integration's own origin. A preset's other placeholders go in as written.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret

// A stored secret that won't decrypt, as after DASH_SECRET changed (#428).
const BROKEN = 'integration_broken_password';
writeFileSync(
  join(process.env.JAGHELM_DATA_DIR, 'secrets.json'),
  JSON.stringify({ [BROKEN]: { iv: '00'.repeat(12), data: '00', tag: '00'.repeat(16), origins: [] } })
);

const { initSecrets, setSecret } = await import('../secrets.js');
const { initRegistry, listPresets, getPresetFull } = await import('./registry.js');
const { fetchIntegration, testIntegration } = await import('./handler.js');
const { resolveIntegrationConfig } = await import('./lib/config.js');
const { originOf } = await import('./lib/origin.js');
const { hideUrlCredential } = await import('./lib/http.js');

initSecrets();
await initRegistry();
for (const v of ['SABNZBD_URL', 'SABNZBD_API_KEY', 'JAGHELM_ADGUARD_USER', 'JAGHELM_ADGUARD_PASS']) delete process.env[v];

// Random, so a match in a URL or a log line can only be the value itself.
const hex = () => randomBytes(8).toString('hex');

/**
 * A stub upstream: answers every request with `{ up: true }` and records its
 * URL, its Authorization header in `auths` and its Host header in `hosts`.
 */
function upstream(answer) {
  return new Promise((resolve) => {
    const urls = [];
    const auths = [];
    const hosts = [];
    const srv = http.createServer((req, res) => {
      urls.push(req.url);
      auths.push(req.headers.authorization);
      hosts.push(req.headers.host);
      if (answer) return answer(req, res);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ up: true, token: 'session-tok' }));
    });
    srv.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${srv.address().port}`, urls, auths, hosts, close: () => srv.close() });
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

/**
 * Store `value` under the name a Settings save uses, for the origin of `url`
 * (the upstream's by default, #556), and return its reference.
 */
function stored(key, field, value, url = up.url) {
  const name = `integration_${key}_${field}`;
  assert.equal(setSecret(name, value, { origins: [originOf(url)] }), true, 'the secrets store took the value');
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

const UNRESOLVED = /Couldn't read the stored credential/;

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
    yaml.token = stored(key, 'token', value, from.url);

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
 * couldn't be read, and neither the error nor any log line names `ref`.
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
  // Typed into the form: the test resolves it as the save would store it
  // (#427), under the entry's keyed name, so it resolves to the reference.
  const key = `sabnzbd_${hex()}`;
  const keyed = `integration_${key}_token`;

  // SABnzbd is a query-auth preset: its key goes in the URL.
  const { urls, result } = await requested(async () => ({
    result: await testIntegration(
      'sabnzbd',
      { url: up.url, token: `$secret:${keyed}`, _storageKey: key },
      { secrets: new Map([[keyed, ref]]) }
    ),
  }));

  assert.deepEqual(urls, [], 'the test sent a request without the key');
  assert.equal(result.ok, false);
  assert.match(result.error, UNRESOLVED);
  assert.ok(!result.error.includes(name));
});

// ── A $secret: username resolves like a password or token ────────────────

test('a {username} endpoint with a $secret: username sends the resolved username', async () => {
  const user = `u-${hex()}`;
  const { key, yaml } = custom({ endpoint: '/u/{username}' });
  yaml.username = stored(key, 'username', user);

  const { result, urls } = await requested(async () => ({ result: await fetchIntegration(key, yaml) }));

  assert.equal(result.error, null);
  assert.deepEqual(urls, [`/u/${user}`]);
});

test('basic auth with a $secret: username sends the resolved username', async () => {
  const user = `u-${hex()}`;
  const pass = `p-${hex()}`;
  const { key, yaml } = custom({ auth: 'basic', endpoint: '/status' });
  yaml.username = stored(key, 'username', user);
  yaml.password = stored(key, 'password', pass);

  const from = up.auths.length;
  const result = await fetchIntegration(key, yaml);

  assert.equal(result.error, null);
  assert.deepEqual(up.auths.slice(from), [`Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`]);
});

test("a preset's $secret: username resolves too, and its .env username still wins", () => {
  const user = `u-${hex()}`;
  const storageKey = `adguard_${hex()}`;
  const yaml = { url: 'http://adguard.test', username: stored(`ref_${storageKey}`, 'username', user), _storageKey: storageKey };

  assert.equal(resolveIntegrationConfig('adguard', yaml)._username, user);

  process.env.JAGHELM_ADGUARD_USER = 'env-user';
  try {
    assert.equal(resolveIntegrationConfig('adguard', yaml)._username, 'env-user');
  } finally {
    delete process.env.JAGHELM_ADGUARD_USER;
  }
});

// ── A filled-in credential never shows in an error or a log line ─────────

test('a filled-in token never shows in the error or the log when the URL is bad', async () => {
  for (const [endpoint, auth, shown] of [
    ['/api/{token}/status', 'none', 'Invalid URL: http://127.0.0.1:99999/api/{token}/status'],
    ['/api/stats?key={token}', 'none', null],
    ['/status', 'query', null],
  ]) {
    for (const how of ['$secret:', 'plaintext']) {
      const value = `tok${hex()}`;
      const { key, yaml } = custom({ url: 'http://127.0.0.1:99999', endpoint, auth });
      yaml.token = how === 'plaintext' ? value : stored(key, 'token', value);

      const { result, lines } = await captureLogs(() => fetchIntegration(key, yaml));

      const what = `${endpoint} (${auth}, ${how})`;
      assert.match(result.error, /^Invalid URL: http:\/\/127\.0\.0\.1:99999\//, what);
      if (shown) assert.equal(result.error, shown, what);
      assert.ok(!result.error.includes(value), `${what}: the token is in the error: ${result.error}`);
      const log = JSON.stringify(lines);
      assert.ok(lines.some((l) => l.msg === 'fetch error'), `${what}: no fetch error line`);
      assert.ok(!log.includes(value), `${what}: the token was logged: ${log}`);
    }
  }
});

test("a filled-in token never shows in an extra endpoint's or a session read's error", async () => {
  // An endpoint starting with ':' makes `${url}${endpoint}` an invalid URL whose
  // error quotes it, while the main read or the login still works.
  const value = `tok${hex()}`;
  const extra = custom({ endpoint: '/status', extraEndpoints: [{ key: 'more', endpoint: ':1/more/{token}' }] });
  extra.yaml.token = stored(extra.key, 'token', value);
  const session = custom({
    auth: 'session',
    endpoint: ':1/data/{token}',
    username: 'u',
    password: 'p',
    session: { loginEndpoint: '/login', loginBody: { u: '{username}', p: '{password}' }, tokenPath: 'token', tokenHeader: 'X-Token' },
  });
  session.yaml.token = stored(session.key, 'token', value);

  const { lines, result } = await captureLogs(async () => {
    const extraResult = await fetchIntegration(extra.key, extra.yaml);
    assert.equal(extraResult.error, null);
    return fetchIntegration(session.key, session.yaml);
  });

  const log = JSON.stringify(lines);
  assert.ok(lines.some((l) => l.msg === 'extra endpoint fetch failed' && /\{token\}/.test(l.reason)), log);
  assert.ok(lines.some((l) => l.msg === 'session auth failed' && /\{token\}/.test(l.error)), log);
  assert.ok(result.error, 'the session read failed');
  assert.ok(!log.includes(value), `the token was logged: ${log}`);
  assert.ok(!result.error.includes(value), result.error);
});

test('hideUrlCredential swaps every form of the URL for the shown one, and keeps bare origins', () => {
  const url = 'http://Host.test:8080/api/SECRET1/x?key=SECRET2';
  const shown = 'http://Host.test:8080/api/{token}/x?key={password}';
  assert.equal(hideUrlCredential(`Invalid URL: ${url}`, url, shown), `Invalid URL: ${shown}`);
  assert.equal(
    hideUrlCredential('failed http://host.test:8080/api/SECRET1/next and http://host.test:8080/api/SECRET1/x', url, shown),
    `failed ${shown} and ${shown}`
  );
  assert.equal(
    hideUrlCredential('redirected http://host.test:8080 → http://other.test', url, shown),
    'redirected http://host.test:8080 → http://other.test'
  );
  // `$&` in the shown URL is text, not a replacement pattern.
  assert.equal(hideUrlCredential(`x ${url.toLowerCase()}`, url, '/a$&b'), 'x /a$&b');
  // No shownUrl: everything after the origin is withheld.
  assert.equal(hideUrlCredential(`Invalid URL: ${url}`, url, undefined), 'Invalid URL: http://host.test:8080/[redacted]');
  assert.equal(
    hideUrlCredential('Invalid URL: http://h:99999/api/SECRET1', 'http://h:99999/api/SECRET1', undefined),
    'Invalid URL: [a URL that carries a credential]'
  );
});

// ── #428: every auth mode refuses a stored credential it can't read ──────

const CANT_READ = /^Couldn't read the stored credential for /;
const SESSION = {
  loginEndpoint: '/login',
  loginBody: { u: '{username}', p: '{password}' },
  tokenPath: 'token',
  tokenHeader: 'X-Token',
};

/** Unset the `.env` variables of `type`'s preset, so its stored credentials are the ones read. */
function withoutEnv(type) {
  for (const name of Object.values(getPresetFull(type)?.envKeys || {})) delete process.env[name];
}

/**
 * Fetch an integration whose `field` is the reference `ref` and check that
 * nothing went out and the error says a stored credential couldn't be read,
 * without naming the reference or calling it a refused login, which would
 * park it (#239). Returns the error.
 */
async function assertUnreadable(type, yaml, ref) {
  const name = ref.replace(/^\$secret:/, '');
  const { result, lines, urls } = await requested(() => captureLogs(() => fetchIntegration(type, yaml)));

  assert.deepEqual(urls, [], `${type}: a request went out`);
  assert.match(result.error, CANT_READ, type);
  assert.ok(!result.error.includes(name) && !result.error.includes('$secret'), result.error);
  assert.doesNotMatch(result.error, /refused|Login returned|auth\w* (?:methods )?failed|HTTP \d/i, result.error);
  assert.equal(result.authRejected, undefined, `${type}: counted as a refused login`);
  // The integration's own lines: the store logs a secret that won't decrypt
  // by name, as it always has, which is the server's log, not the card's.
  const own = lines.filter((l) => l.module === 'integrations');
  assert.ok(own.some((l) => l.msg === 'fetch error' && CANT_READ.test(l.error)), JSON.stringify(own));
  assert.ok(!JSON.stringify(own).includes(name), JSON.stringify(own));
  return result.error;
}

// Each auth mode, the rest of the entry it needs, and the credential it sends.
for (const [mode, entry, field] of [
  ['header', { auth: 'header', authHeader: 'X-Api-Key' }, 'token'],
  ['bearer', { auth: 'bearer' }, 'token'],
  ['basic', { auth: 'basic', username: 'u' }, 'password'],
  ['basic', { auth: 'basic', password: 'p' }, 'username'],
  ['query', { auth: 'query' }, 'token'],
  ['session', { auth: 'session', username: 'u', session: SESSION }, 'password'],
  ['session', { auth: 'session', password: 'p', session: SESSION }, 'username'],
]) {
  test(`${mode} auth sends nothing when its stored ${field} is missing or won't decrypt (#428)`, async () => {
    for (const name of [`integration_gone_${hex()}_${field}`, BROKEN]) {
      const ref = `$secret:${name}`;
      const { key, yaml } = custom({ endpoint: '/status', ...entry, [field]: ref });

      await assertUnreadable(key, yaml, ref);
    }
  });
}

test('a preset with an unreadable stored password or token sends nothing, and says to enter it again in Settings (#428)', async () => {
  for (const [type, field] of [
    ['npm', 'password'], // session login
    ['adguard', 'password'], // basic auth
    ['sonarr', 'token'], // header
    ['sabnzbd', 'token'], // query
  ]) {
    withoutEnv(type);
    const key = `${type}_${hex()}`;
    const ref = `$secret:integration_${key}_${field}`;
    const yaml = { url: up.url, username: 'u', [field]: ref, _storageKey: key };

    const error = await assertUnreadable(type, yaml, ref);

    assert.match(error, new RegExp(`enter the ${field} again in Settings and save$`), type);
  }
});

test("a custom integration's unreadable password or username points at services.yaml, its token at Settings (#428)", async () => {
  for (const [entry, field, fix] of [
    [{ auth: 'basic', username: 'u' }, 'password', /check this integration's entry in services\.yaml$/],
    [{ auth: 'session', password: 'p', session: SESSION }, 'username', /check this integration's entry in services\.yaml$/],
    [{ auth: 'header' }, 'token', /enter the token again in Settings and save$/],
  ]) {
    const ref = `$secret:gone_${hex()}`; // pragma: allowlist secret
    const { key, yaml } = custom({ endpoint: '/status', ...entry, [field]: ref });

    assert.match(await assertUnreadable(key, yaml, ref), fix, `${entry.auth} ${field}`);
  }
});

test('a stored credential that reads sends as before in every auth mode (#428)', async () => {
  const user = `u-${hex()}`;
  const pass = `p-${hex()}`;
  const basic = custom({ auth: 'basic', endpoint: '/status' });
  basic.yaml.username = user;
  basic.yaml.password = stored(basic.key, 'password', pass);
  const header = custom({ auth: 'header', authHeader: 'Authorization', endpoint: '/status' });
  header.yaml.token = stored(header.key, 'token', pass);
  const session = custom({ auth: 'session', endpoint: '/data', username: user, session: SESSION });
  session.yaml.password = stored(session.key, 'password', pass);

  const from = up.auths.length;
  const { urls } = await requested(async () => {
    for (const { key, yaml } of [basic, header, session]) {
      assert.equal((await fetchIntegration(key, yaml)).error, null, key);
    }
    return {};
  });

  assert.deepEqual(urls, ['/status', '/status', '/login', '/data']);
  assert.deepEqual(up.auths.slice(from, from + 2), [`Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`, pass]);
});

// ── #429: a credential filled into an endpoint is URL-encoded ────────────

// Every character the card names, and the escapes' own `%` and `+`.
const AWKWARD = 'a&b=c#d/e?f g@h+i%25j';

test('a credential with &, #, /, ?, a space and @ reaches the upstream as it is, on its own origin (#429)', async () => {
  const query = (param) => (u) => u.searchParams.get(param);
  const segment = (n) => (u) => decodeURIComponent(u.pathname.split('/')[n]);
  for (const [endpoint, field, read] of [
    ['/api/stats?key={token}', 'token', query('key')],
    ['/api/{token}/status', 'token', segment(2)],
    ['/s?k={_token}&x=1', 'token', query('k')],
    ['/s?pw={password}', 'password', query('pw')],
    ['/u/{username}/s', 'username', segment(2)],
  ]) {
    for (const how of ['plaintext', '$secret:']) {
      const value = `${AWKWARD}-${hex()}`;
      const { key, yaml } = custom({ endpoint });
      yaml[field] = how === 'plaintext' ? value : stored(key, field, value);
      const what = `${endpoint} (${how})`;

      const from = up.hosts.length;
      const { result, urls } = await requested(async () => ({ result: await fetchIntegration(key, yaml) }));

      assert.equal(result.error, null, what);
      assert.equal(urls.length, 1, what);
      assert.deepEqual(up.hosts.slice(from), [new URL(up.url).host], `${what}: the request left its origin`);
      assert.equal(read(new URL(urls[0], up.url)), value, `${what}: ${urls[0]}`);
    }
  }
});

test("a credential written right after the host can't move the request to another origin (#429, #556)", async () => {
  // Written unencoded, `@127.0.0.1:<port>` after the URL would make the
  // URL's own host and port the user name and password, and the request go to
  // the other upstream.
  const other = await upstream();
  try {
    const value = `@${new URL(other.url).host}`;
    for (const how of ['plaintext', '$secret:']) {
      const { key, yaml } = custom({ endpoint: '{token}/status' });
      yaml.token = how === 'plaintext' ? value : stored(key, 'token', value);

      const { result, urls } = await requested(async () => ({ result: await fetchIntegration(key, yaml) }));

      assert.deepEqual(other.urls, [], `${how}: the other origin got the request`);
      assert.deepEqual(urls, [], how);
      assert.ok(result.error, how);
      assert.ok(!result.error.includes(value), `${how}: the token is in the error: ${result.error}`);
    }
  } finally {
    other.close();
  }
});

test("a preset's own placeholder goes in as written, not encoded (#429)", async () => {
  // `:` and `@` are characters encodeURIComponent changes and a path keeps.
  const presets = listPresets()
    .map(({ type }) => [type, getPresetFull(type).endpoint])
    .filter(([, endpoint]) => /\{(?!_?(?:token|password|username)\})\w+\}/.test(endpoint));
  assert.deepEqual(presets.map(([type]) => type).sort(), ['cloudflare', 'nextdns'], 'the presets with one');

  for (const [type, endpoint] of presets) {
    withoutEnv(type);
    const key = `${type}_${hex()}`;
    const value = `id:${hex()}@x`;
    const params = Object.fromEntries([...endpoint.matchAll(/\{(\w+)\}/g)].map(([, name]) => [name, value]));

    const { result, urls } = await requested(async () => ({
      result: await fetchIntegration(type, { url: up.url, token: 'tok', ...params, _storageKey: key }),
    }));

    assert.equal(result.error, null, type);
    assert.deepEqual(urls, [endpoint.replace(/\{\w+\}/g, value)], type);
  }
});
