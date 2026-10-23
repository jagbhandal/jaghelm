/**
 * The form can never name a stored secret (#427's review).
 *
 * The resolver reads a `$secret:` reference in an entry's username, password
 * and token. A save or test whose username was `$secret:<another
 * integration's secret>`, with the URL pointed elsewhere, sent that secret
 * there: the test at once, the save at the next refresh (a basic-auth header,
 * a session login's body). Now every value the form puts into the entry is
 * refused when it is, or holds, a reference, unless it is the value already
 * stored in that field of the same entry, and a typed password or token never
 * is one. These drive the real save, test and refresh against a stubbed fetch
 * that records every request.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import yaml from 'js-yaml';

process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret
for (const v of ['JAGHELM_ADGUARD_URL', 'JAGHELM_ADGUARD_USER', 'JAGHELM_ADGUARD_PASS', 'NPM_URL', 'NPM_USER', 'NPM_PASS', 'CF_API_TOKEN', 'CF_ACCOUNT_ID']) {
  delete process.env[v];
}

const { loadConfig } = await import('../config.js');
const { initSecrets, setSecret } = await import('../secrets.js');
const { initRegistry } = await import('../integrations/registry.js');
const { refreshIntegrations } = await import('../refresh.js');
const { integrationRoutes } = await import('./integrations.js');

initSecrets();
await initRegistry();

const DATA = process.env.JAGHELM_DATA_DIR;
const CONFIG_PATH = join(DATA, 'services.yaml');
const SECRETS_PATH = join(DATA, 'secrets.json');

// Random, so a match anywhere can only be the secret itself.
const SP_SECRET = `sp-${Math.random().toString(36).slice(2)}`;
const AG_SECRET = `ag-${Math.random().toString(36).slice(2)}`;
const USER_SECRET = `user-${Math.random().toString(36).slice(2)}`;

const requests = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  requests.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers)), body: init.body ?? null });
  return new Response(JSON.stringify({ token: 'tok' }), { status: 200, headers: { 'content-type': 'application/json' } });
};
after(() => {
  globalThis.fetch = realFetch;
});
const leaked = (from) =>
  requests.slice(from).filter((r) => {
    const text = JSON.stringify(r) + Buffer.from(String(r.headers.authorization || '').slice(6), 'base64');
    return [SP_SECRET, AG_SECRET, USER_SECRET].some((s) => text.includes(s));
  });

let addr = 0;
const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use('/api/integrations', integrationRoutes);
const post = (path, body) =>
  request(app)
    .post(`/api/integrations/${path}`)
    .set('X-Forwarded-For', `10.2.${Math.floor(++addr / 250)}.${addr % 250}`)
    .send(body);

const FILE = [
  'integrations:',
  '  statuspage:',
  '    url: "http://status.example.test"',
  '    endpoint: /api/summary',
  '    auth: header',
  '    authHeader: X-Api-Key',
  '    token: $secret:statuspage_key', // pragma: allowlist secret
  '  adguard_primary:',
  '    preset: adguard',
  '    instance: primary',
  '    url: http://adguard.example.test:3000',
  '    username: $secret:adguard_user', // pragma: allowlist secret
  '    password: $secret:integration_adguard_primary_password', // pragma: allowlist secret
  '  npm:',
  '    preset: npm',
  '    url: http://npm.example.test',
  '    username: admin',
  '  cloudflare:',
  '    preset: cloudflare',
  '    url: https://api.cloudflare.com',
  '    account_id: abc123',
  '',
].join('\n');
function stored() {
  // Each for the address it was entered for (#556).
  setSecret('statuspage_key', SP_SECRET, { origins: ['http://status.example.test:80'] });
  setSecret('integration_adguard_primary_password', AG_SECRET, { origins: ['http://adguard.example.test:3000'] });
  setSecret('adguard_user', USER_SECRET, { origins: ['http://adguard.example.test:3000'] });
  writeFileSync(CONFIG_PATH, FILE);
  loadConfig();
}
const bytes = (path) => readFileSync(path);

// Each form names a stored secret it doesn't hold, with the URL pointed at
// another host: [what, form, field].
const ADGUARD = {
  type: 'adguard',
  url: 'http://elsewhere.example.test',
  instance: 'primary',
  target: '',
  editingKey: 'adguard_primary',
};
const NAMES = [
  // The review's probe: basic auth sent `Basic <statuspage's key>:<adguard's password>`.
  ['basic auth: a username naming another integration\'s secret', { ...ADGUARD, username: '$secret:statuspage_key' }, 'username'], // pragma: allowlist secret
  // ... and a session login sent it as the login's identity.
  ['session auth: a username naming another integration\'s secret', { type: 'npm', url: 'http://elsewhere.example.test', target: '', username: '$secret:statuspage_key', editingKey: 'npm' }, 'username'], // pragma: allowlist secret
  ['a new integration\'s username naming a secret', { type: 'npm', url: 'http://elsewhere.example.test', instance: 'two', target: '', username: '$secret:adguard_user', create: true }, 'username'], // pragma: allowlist secret
  ['a typed password that is a reference', { ...ADGUARD, username: 'admin', password: '$secret:statuspage_key' }, 'password'], // pragma: allowlist secret
  ['a typed token that is a reference', { type: 'statuspage', url: 'http://elsewhere.example.test', target: '', username: '', token: ' $secret:statuspage_key', editingKey: 'statuspage' }, 'token'], // pragma: allowlist secret
  ['a URL param naming a secret', { type: 'cloudflare', url: 'https://api.cloudflare.com', target: '', username: '', params: { account_id: '$secret:statuspage_key' }, editingKey: 'cloudflare' }, 'account_id'], // pragma: allowlist secret
  ['a target naming a secret', { ...ADGUARD, username: '$secret:adguard_user', target: '$secret:statuspage_key' }, 'target'], // pragma: allowlist secret
  ['custom fields holding a reference', { type: 'statuspage', url: 'http://status.example.test', target: '', username: '', fields: [{ key: 'k', label: 'K', path: '$secret:statuspage_key' }], editingKey: 'statuspage' }, 'fields'], // pragma: allowlist secret
  ['a URL that is a reference', { type: 'statuspage', url: '$secret:statuspage_key', target: '', username: '', editingKey: 'statuspage' }, 'url'], // pragma: allowlist secret
];

for (const [what, form, field] of NAMES) {
  for (const path of ['test', 'save']) {
    test(`${path}: ${what} is refused, naming the field, and nothing is sent or stored`, async () => {
      stored();
      const file = bytes(CONFIG_PATH);
      const secrets = bytes(SECRETS_PATH);
      const from = requests.length;

      const res = await post(path, form);

      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.equal(res.body.field, field);
      assert.match(res.body.error, /can't be a stored-secret reference \(\$secret:…\); type the value itself/);
      assert.ok(!res.body.error.includes('statuspage_key') && !res.body.error.includes('adguard_user'));
      if (path === 'test') assert.equal(res.body.ok, false);
      assert.deepEqual(requests.slice(from), [], 'a request went out');
      assert.ok(bytes(CONFIG_PATH).equals(file), 'services.yaml changed');
      assert.ok(bytes(SECRETS_PATH).equals(secrets), 'secrets.json changed');

      // And the next refresh sends no secret anywhere it wasn't sent before.
      const refreshed = requests.length;
      await refreshIntegrations();
      assert.ok(!requests.slice(refreshed).some((r) => r.url.includes('elsewhere')));
    });
  }
}

test('an untouched stored reference still round-trips: the save keeps it, the test resolves it', async () => {
  stored();
  const file = bytes(CONFIG_PATH);
  // adguard_primary's username is `$secret:adguard_user`, written by hand: the
  // form shows it and sends it back as it is.
  const form = { ...ADGUARD, url: 'http://adguard.example.test:3000', username: '$secret:adguard_user' }; // pragma: allowlist secret

  const from = requests.length;
  const tested = await post('test', form);
  assert.deepEqual(tested.body, { ok: true });
  const sent = requests.slice(from);
  assert.deepEqual(
    sent.map((r) => [r.url, r.headers.authorization]),
    [['http://adguard.example.test:3000/control/stats', `Basic ${Buffer.from(`${USER_SECRET}:${AG_SECRET}`).toString('base64')}`]]
  );

  const saved = await post('save', form);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.ok(bytes(CONFIG_PATH).equals(file), 'an unchanged save rewrote services.yaml');

  // Changing another field keeps it too.
  const retargeted = await post('save', { ...form, target: 'pi1:adguard' });
  assert.equal(retargeted.status, 200);
  const entry = yaml.load(readFileSync(CONFIG_PATH, 'utf8')).integrations.adguard_primary;
  assert.equal(entry.username, '$secret:adguard_user'); // pragma: allowlist secret
  assert.equal(entry.target, 'pi1:adguard');
});

test('a reference stored in one field is refused in another, and on another entry', async () => {
  stored();
  const from = requests.length;
  // The username's own reference, moved into the target.
  const moved = await post('test', { ...ADGUARD, url: 'http://adguard.example.test:3000', username: '$secret:adguard_user', target: '$secret:adguard_user' }); // pragma: allowlist secret
  assert.equal(moved.status, 400);
  assert.equal(moved.body.field, 'target');
  // adguard_primary's reference, sent for npm.
  const crossed = await post('test', { type: 'npm', url: 'http://npm.example.test', target: '', username: '$secret:adguard_user', editingKey: 'npm' }); // pragma: allowlist secret
  assert.equal(crossed.status, 400);
  assert.equal(crossed.body.field, 'username');
  assert.deepEqual(requests.slice(from), []);
  assert.deepEqual(leaked(from), []);
});
