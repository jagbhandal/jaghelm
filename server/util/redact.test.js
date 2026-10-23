import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, redactError, urlCredential } from './redact.js';

test('redacts known secret query params', () => {
  assert.ok(!redactSecrets('failed: https://h/api?apikey=SEKRET123').includes('SEKRET123'));
  assert.ok(!redactSecrets('https://h/api?token=abc').includes('abc'));
  assert.ok(!redactSecrets('https://h/api?api_key=xyz').includes('xyz'));
  assert.ok(!redactSecrets('https://h/?password=hunter2').includes('hunter2'));
  // Plex's token as a query parameter (#413).
  assert.ok(!redactSecrets('/status/sessions?X-Plex-Token=plexsecret').includes('plexsecret'));
});

test('strips the entire query string off URLs (catches unknown param names)', () => {
  const out = redactSecrets('connect ECONNREFUSED https://h:8006/?ticket=PVE:secretvalue');
  assert.ok(!out.includes('secretvalue'), out);
});

test('redacts URL userinfo passwords (user:pass@host)', () => {
  const out = redactSecrets("connect failed to https://admin:SUPERSECRET@host:9000/api");
  assert.ok(!out.includes('SUPERSECRET'), out);
  assert.ok(out.includes('admin'), out);           // username kept as a hint
  assert.ok(out.includes('[redacted]'), out);
});

test('redacts userinfo inside a realistic fetch error message', () => {
  const out = redactError(new Error('request to https://svc:t0k3n@10.0.0.5/v1 failed, ETIMEDOUT'));
  assert.ok(!out.includes('t0k3n'), out);
});

test('leaves non-secret text intact', () => {
  assert.equal(redactSecrets('HTTP 502 Bad Gateway'), 'HTTP 502 Bad Gateway');
});

test('redactError handles Error objects and null/undefined', () => {
  assert.ok(!redactError(new Error('boom https://h/x?token=abc')).includes('abc'));
  assert.equal(redactError(null), null);
  assert.equal(redactError(undefined), undefined);
});

test('redacts userinfo in a URL of any scheme, not only http(s) (#409)', () => {
  for (const url of [
    'ws://svc:t0k3n@10.0.0.5/socket', // pragma: allowlist secret
    'postgres://app:t0k3n@db:5432/jaghelm', // pragma: allowlist secret
    'redis://:t0k3n@cache:6379', // pragma: allowlist secret
  ]) {
    const out = redactSecrets(`connect failed: ${url}`);
    assert.ok(!out.includes('t0k3n'), out);
    assert.ok(out.includes(':[redacted]@'), out);
  }
});

test('a URL with a user and no password loses the user: it is often the token itself (#409)', () => {
  const out = redactSecrets('Request cannot be constructed from a URL that includes credentials: https://ghp_t0k3n@git.test/x'); // pragma: allowlist secret
  assert.ok(!out.includes('t0k3n'), out);
  assert.ok(out.includes('https://[redacted]@git.test/x'), out);
});

test('a password holding an @ is redacted whole, up to the last @ before the host (#409)', () => {
  const out = redactSecrets('to http://jag:hun@ter2@127.0.0.1:9/api failed'); // pragma: allowlist secret
  assert.equal(out, 'to http://jag:[redacted]@127.0.0.1:9/api failed');
});

test('an @ after the host (a path, a query, the text after the URL) is not userinfo (#409)', () => {
  for (const s of [
    'GET http://127.0.0.1:9/users/@me failed',
    'mail admin@example.test about http://127.0.0.1:9',
  ]) {
    assert.equal(redactSecrets(s), s);
  }
});

test('a password of digits then a raw #, / or ? (the URL parses as host:port) is redacted up to its @ (#419)', () => {
  // http://jag:1234#x@host parses as host jag, port 1234 and fragment x@host:
  // no userinfo as the parser reads it, but the text holds the password.
  for (const [url, password] of [
    ['http://jag:1234#x@host', '1234#x'], // pragma: allowlist secret
    ['http://jag:1234/x@host', '1234/x'], // pragma: allowlist secret
    ['http://jag:1234?x@host', '1234?x'], // pragma: allowlist secret
  ]) {
    for (const s of [url, `Invalid URL: ${url}/api/v1/query`, `promUrl=${url},`, `GET ${url}/x failed`]) {
      const out = redactSecrets(s);
      assert.ok(!out.includes(password), `${password}: ${out}`);
      assert.ok(!out.includes('1234'), `no part of it: ${out}`);
      assert.ok(out.includes('://[redacted]@host'), `the host is kept: ${out}`);
      assert.equal(redactSecrets(out), out, 'idempotent');
    }
  }
  assert.equal(redactSecrets('to http://jag:1234#x@host failed'), 'to http://[redacted]@host failed'); // pragma: allowlist secret
  assert.equal(redactSecrets('http://jag:1234/x@host/api'), 'http://[redacted]@host/api'); // pragma: allowlist secret
  // A password holding an @ as well goes whole, to the last @.
  assert.equal(redactSecrets('http://jag:1234#x@y@host'), 'http://[redacted]@host'); // pragma: allowlist secret
  // The same shape with any host:port: an @ in the fragment, or in the first
  // path segment, reads as a password. One further down the path does not.
  assert.equal(redactSecrets('http://127.0.0.1:9#a@b'), 'http://[redacted]@b');
  assert.equal(redactSecrets('GET http://127.0.0.1:9/users/@me failed'), 'GET http://127.0.0.1:9/users/@me failed');
  assert.equal(redactSecrets('GET http://127.0.0.1:9/users/x@me failed'), 'GET http://127.0.0.1:9/users/x@me failed');
});

test('redacting twice gives the same text (#409)', () => {
  const once = redactSecrets('http://jag:hunter2@127.0.0.1:9 and http://t0k3n@h.test'); // pragma: allowlist secret
  assert.equal(redactSecrets(once), once);
  assert.equal(once, 'http://jag:[redacted]@127.0.0.1:9 and http://[redacted]@h.test');
});

test('a password with a character that stops the URL parsing is still redacted (#409)', () => {
  // The URL parser ends the userinfo at a raw # / or ?, so these URLs do not
  // parse, and the text still names the password before the last @.
  for (const password of ['ab#hunter2', 'ab/hunter2', 'ab?hunter2', 'ab#c@hunter2', 'a\\b<c>{hunter2}|^~!$()*+,;=']) {
    const url = `http://jag:${password}@127.0.0.1:9`;
    for (const s of [url, `Invalid URL: ${url}/api/v1/query?query=up`, `promUrl=${url}/x,`]) {
      const out = redactSecrets(s);
      assert.ok(!out.includes('hunter2'), out);
      assert.ok(out.includes('@127.0.0.1:9'), `the host is kept: ${out}`);
      assert.equal(redactSecrets(out), out, 'idempotent');
    }
  }
  assert.equal(redactSecrets('http://jag:ab#hunter2@127.0.0.1:9'), 'http://[redacted]@127.0.0.1:9'); // pragma: allowlist secret
  // A password holding an @ parses: the userinfo rule keeps the user.
  assert.equal(redactSecrets('http://jag:ab@hunter2@127.0.0.1:9'), 'http://jag:[redacted]@127.0.0.1:9'); // pragma: allowlist secret
});

test('a URL that parses keeps an @ in its path or fragment, beside a broken one (#409)', () => {
  const out = redactSecrets('GET http://127.0.0.1:9/users/@me then http://jag:ab#hunter2@127.0.0.1:9'); // pragma: allowlist secret
  assert.equal(out, 'GET http://127.0.0.1:9/users/@me then http://[redacted]@127.0.0.1:9');
});

test('a password holding a colon is redacted from the first colon on (#409)', () => {
  assert.equal(redactSecrets('to http://jag:pa:hunter2@127.0.0.1:9 failed'), 'to http://jag:[redacted]@127.0.0.1:9 failed'); // pragma: allowlist secret
});

test('a secret param after an & is redacted in text with no ? or @ (#409)', () => {
  const out = redactSecrets('retry with &token=hunter2 next'); // pragma: allowlist secret
  assert.ok(!out.includes('hunter2'), out);
});

test('?key= is a secret query parameter too (#422)', () => {
  assert.ok(!redactSecrets('to /api/stats?key=SEKRET123 failed').includes('SEKRET123'));
  assert.ok(!redactSecrets('to /api/stats?a=1&key=SEKRET123 failed').includes('SEKRET123'));
  // Only the whole name: monkey= is not key=.
  assert.equal(redactSecrets('/api?monkey=1'), '/api?monkey=1');
});

test('urlCredential names the credential a URL carries, never its value (#422)', () => {
  for (const url of [
    'https://admin:hunter2@host:3000', // pragma: allowlist secret
    'https://t0k3n@host/api',
    'http://jag:hun#ter@host/api', // a raw # in the password: the parser refuses it
  ]) {
    assert.deepEqual(urlCredential(url), { userinfo: true }, url);
  }
  for (const [url, param] of [
    ['http://host/?apikey=k', 'apikey'],
    ['http://host/api?a=1&token=t', 'token'],
    ['http://host?key=k', 'key'],
    ['http://host/x?api_key=k', 'api_key'],
    ['http://host/x?X-Plex-Token=t', 'X-Plex-Token'],
  ]) {
    assert.deepEqual(urlCredential(url), { param }, url);
  }
  for (const url of [
    'http://host:3000',
    'host:3000',
    'http://host/u@x',
    'http://host/?limit=10&sort=name',
    'http://host?key=',
    'http://host?monkey=1',
    '',
    undefined,
    42,
  ]) {
    assert.equal(urlCredential(url), null, String(url));
  }
});
