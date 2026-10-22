/**
 * #556: the secrets stored before origins existed are bound once, to the
 * entries that use them.
 *
 * A secret with no origins in secrets.json (written before #556) goes
 * nowhere. At boot each one is bound to the origins of every entry in
 * services.yaml that uses it (its keyed name, or a `$secret:` reference),
 * in one write, with one info line that counts them. One no entry uses is
 * bound to none, so a reference added later doesn't take it anywhere. When
 * services.yaml can't be used at boot, its first good load binds them.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret
for (const v of ['JAGHELM_ADGUARD_URL', 'JAGHELM_ADGUARD_USER', 'JAGHELM_ADGUARD_PASS', 'NPM_URL', 'NPM_USER', 'NPM_PASS']) {
  delete process.env[v];
}

const { loadConfig } = await import('../config.js');
const { initSecrets, setSecret, getSecretOrigins, unboundSecretNames } = await import('../secrets.js');
const { initRegistry } = await import('./registry.js');
const { refreshIntegrations, retryIntegrationNow } = await import('../refresh.js');
const { bindUnboundSecrets, bindSecretsAtBoot } = await import('./secretBinding.js');

initSecrets();
await initRegistry();

const DATA = process.env.JAGHELM_DATA_DIR;
const CONFIG_PATH = join(DATA, 'services.yaml');
const SECRETS_PATH = join(DATA, 'secrets.json');

const SP_KEY = `sp-${Math.random().toString(36).slice(2)}`;

const requests = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  requests.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers)) });
  return new Response(JSON.stringify({ summary: { up: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
};
after(() => {
  globalThis.fetch = realFetch;
});

const FILE = [
  'integrations:',
  '  statuspage:',
  '    url: "http://status.example.test"',
  '    endpoint: /api/summary',
  '    auth: header',
  '    authHeader: X-Api-Key',
  '    token: $secret:statuspage_key', // pragma: allowlist secret
  '  mirror:',
  '    url: "https://mirror.example.test"',
  '    endpoint: /api/summary',
  '    auth: header',
  '    authHeader: X-Api-Key',
  '    token: " $secret:statuspage_key"', // pragma: allowlist secret
  '  adguard_primary:',
  '    preset: adguard',
  '    instance: primary',
  '    enabled: false',
  '    url: http://adguard.example.test:3000',
  '    username: admin',
  '',
].join('\n');

/** secrets.json as a version before #556 left it: no origins anywhere. */
function legacyStore(names) {
  for (const [name, value] of Object.entries(names)) setSecret(name, value);
  const store = JSON.parse(readFileSync(SECRETS_PATH, 'utf8'));
  for (const name of Object.keys(names)) delete store[name].origins;
  writeFileSync(SECRETS_PATH, JSON.stringify(store));
  initSecrets();
}

function captureInfo(fn) {
  const lines = [];
  const out = process.stdout.write;
  process.stdout.write = function (chunk, ...rest) {
    lines.push(String(chunk));
    return out.call(this, chunk, ...rest);
  };
  try {
    return { result: fn(), lines: lines.filter((l) => l.includes('"module":"secrets"')) };
  } finally {
    process.stdout.write = out;
  }
}

test('existing secrets bind to the origins of the entries that use them, once, with one counting line', () => {
  legacyStore({
    statuspage_key: SP_KEY,
    integration_adguard_primary_password: 'ag', // pragma: allowlist secret
    leftover_key: 'nobody uses it', // pragma: allowlist secret
  });
  writeFileSync(CONFIG_PATH, FILE);
  loadConfig();
  assert.deepEqual(unboundSecretNames().sort(), ['integration_adguard_primary_password', 'leftover_key', 'statuspage_key']);

  const { result, lines } = captureInfo(() => bindUnboundSecrets());

  assert.equal(result, 3);
  // Two entries use statuspage_key: it goes to both. The keyed name binds to its
  // entry (disabled or not); the one nobody uses, to none.
  assert.deepEqual(getSecretOrigins('statuspage_key').sort(), ['http://status.example.test:80', 'https://mirror.example.test:443']);
  assert.deepEqual(getSecretOrigins('integration_adguard_primary_password'), ['http://adguard.example.test:3000']);
  assert.deepEqual(getSecretOrigins('leftover_key'), []);
  assert.equal(lines.length, 1, lines.join(''));
  const line = JSON.parse(lines[0]);
  assert.equal(line.level, 'info');
  assert.equal(line.secrets, 3);
  assert.equal(line.unused, 1);
  assert.ok(!lines[0].includes('example.test') && !lines[0].includes('statuspage_key'));

  // Bound once: nothing more to do, nothing written, nothing logged.
  const before = readFileSync(SECRETS_PATH);
  const again = captureInfo(() => bindUnboundSecrets());
  assert.equal(again.result, 0);
  assert.deepEqual(again.lines, []);
  assert.ok(readFileSync(SECRETS_PATH).equals(before));
});

test('an unbound secret is never sent; once bound it goes to its entry', async () => {
  legacyStore({ statuspage_key: SP_KEY });
  writeFileSync(CONFIG_PATH, FILE.replace(/ {2}mirror:[\s\S]*$/, ''));
  loadConfig();

  retryIntegrationNow('statuspage');
  let from = requests.length;
  let result = await refreshIntegrations();
  assert.deepEqual(requests.slice(from), []);
  assert.match(result.statuspage._error, /re-enter the credential for this address/);

  bindUnboundSecrets();
  retryIntegrationNow('statuspage');
  from = requests.length;
  result = await refreshIntegrations();
  assert.equal(result.statuspage._error, undefined);
  assert.deepEqual(
    requests.slice(from).map((r) => [r.url, r.headers['x-api-key']]),
    [['http://status.example.test/api/summary', SP_KEY]]
  );
});

test('a secret bound to no entry stays unbound when a reference to it is added later', async () => {
  legacyStore({ leftover_key: 'still secret' }); // pragma: allowlist secret
  writeFileSync(CONFIG_PATH, FILE);
  loadConfig();
  bindUnboundSecrets();
  assert.deepEqual(getSecretOrigins('leftover_key'), []);

  writeFileSync(
    CONFIG_PATH,
    FILE + ['  probe:', '    url: http://collector.example.test', '    endpoint: /x', '    auth: bearer', '    token: $secret:leftover_key', ''].join('\n') // pragma: allowlist secret
  );
  loadConfig();
  // A restart binds nothing more.
  assert.equal(bindUnboundSecrets(), 0);
  retryIntegrationNow('probe');
  const from = requests.length;
  await refreshIntegrations();
  assert.deepEqual(requests.slice(from).filter((r) => r.url.includes('collector')), []);
});

test('a services.yaml that cannot be used at boot binds nothing; its first good load does', () => {
  legacyStore({ statuspage_key: SP_KEY });
  writeFileSync(CONFIG_PATH, 'integrations:\n  statuspage: [unclosed\n');
  loadConfig();

  const listeners = [];
  const bound = bindSecretsAtBoot({ onChange: (fn) => listeners.push(fn) });
  assert.equal(bound, null);
  assert.deepEqual(unboundSecretNames(), ['statuspage_key']);
  assert.equal(listeners.length, 1);

  // Still broken: nothing yet.
  listeners[0]();
  assert.deepEqual(unboundSecretNames(), ['statuspage_key']);

  writeFileSync(CONFIG_PATH, FILE);
  loadConfig();
  listeners[0]();
  assert.deepEqual(unboundSecretNames(), []);
  assert.deepEqual(getSecretOrigins('statuspage_key').sort(), ['http://status.example.test:80', 'https://mirror.example.test:443']);

  // Once: a later load binds nothing more.
  legacyStore({ late_key: 'x' });
  listeners[0]();
  assert.deepEqual(unboundSecretNames().includes('late_key'), true);
});

test('at boot with a usable services.yaml it binds at once and waits for nothing', () => {
  legacyStore({ statuspage_key: SP_KEY });
  writeFileSync(CONFIG_PATH, FILE);
  loadConfig();
  const listeners = [];
  const unbound = unboundSecretNames().length;
  assert.ok(unbound >= 1);
  assert.equal(bindSecretsAtBoot({ onChange: (fn) => listeners.push(fn) }), unbound);
  assert.deepEqual(listeners, []);
  assert.deepEqual(unboundSecretNames(), []);
});
