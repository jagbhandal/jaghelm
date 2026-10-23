/**
 * #427: the Test button tests what Save would store, as a refresh fetches it.
 *
 * The connection test used to build its own request from a few form fields:
 * a custom integration's endpoint was never sent, so it requested
 * `<url>undefined`, and a preset was tested at its testEndpoint with the form's
 * credentials only. Now the form is merged into the stored entry by the save's
 * own merge, and fetched through resolveIntegrationConfig and fetchIntegration
 * as the refresh loop fetches an entry, without writing anything.
 *
 * These drive the real routes and the real refresh against a stubbed fetch
 * that records every request (URL, method, headers, body), with the request
 * bodies the web app sends (fixtures/settingsForm.js).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret
for (const v of [
  'JAGHELM_ADGUARD_URL',
  'JAGHELM_ADGUARD_USER',
  'JAGHELM_ADGUARD_PASS',
  'SABNZBD_URL',
  'SABNZBD_API_KEY',
  'NPM_URL',
  'NPM_USER',
  'NPM_PASS',
]) {
  delete process.env[v];
}

const { loadConfig } = await import('../config.js');
const { initSecrets, setSecret, getSecret } = await import('../secrets.js');
const { initRegistry } = await import('../integrations/registry.js');
const { refreshIntegrations } = await import('../refresh.js');
const { integrationRoutes } = await import('./integrations.js');
const { STATUSPAGE, ADGUARD_PRIMARY } = await import('./fixtures/settingsForm.js');

initSecrets();
await initRegistry();

const DATA = process.env.JAGHELM_DATA_DIR;
const CONFIG_PATH = join(DATA, 'services.yaml');
const SECRETS_PATH = join(DATA, 'secrets.json');

// ── A stubbed upstream per host, recording every request ──
const requests = [];
const upstreams = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  requests.push({
    url: String(url),
    method: init.method || 'GET',
    headers: Object.fromEntries(new Headers(init.headers)),
    body: init.body ?? null,
  });
  const answer = upstreams[u.hostname];
  if (!answer) throw new Error(`no upstream for ${u.hostname}`);
  return answer(u, init);
};
after(() => {
  globalThis.fetch = realFetch;
});
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The requests `fn` made, and what it returned. */
async function recorded(fn) {
  const from = requests.length;
  const result = await fn();
  // Extra endpoints go out in parallel: compare them in a fixed order.
  const made = requests.slice(from).sort((a, b) => (a.url + a.method).localeCompare(b.url + b.method));
  return { result, made };
}

// The test route is rate-limited per address (10 a minute): each request
// comes from its own.
let addr = 0;
const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use('/api/integrations', integrationRoutes);
const post = (path, body) =>
  request(app)
    .post(`/api/integrations/${path}`)
    .set('X-Forwarded-For', `10.0.${Math.floor(++addr / 250)}.${addr % 250}`)
    .send(body);
const testForm = (body) => post('test', body);
const save = (body) => post('save', body);

/** services.yaml on disk as `text`, loaded as the watcher would. */
function handWritten(text) {
  writeFileSync(CONFIG_PATH, text);
  loadConfig();
}
const bytes = (path) => readFileSync(path);

/** One refresh of every enabled integration, as the background loop runs it. */
async function refresh() {
  const result = await refreshIntegrations();
  assert.ok(result, 'the refresh returned a payload');
  return result;
}

// STATUSPAGE (a custom integration written by hand, header auth) and
// ADGUARD_PRIMARY (a preset with an instance name, basic auth), with their
// credentials in the secret store as a hand edit and a Settings save left them.
const STATUSPAGE_KEY = 'sp-key-value'; // pragma: allowlist secret
const ADGUARD_PASSWORD = 'stored-adguard-pw'; // pragma: allowlist secret
const FILE = [
  'integrations:',
  '  statuspage:',
  '    url: "http://status.example.test"',
  '    endpoint: /api/summary',
  '    auth: header',
  '    authHeader: X-Api-Key',
  '    token: $secret:statuspage_key', // pragma: allowlist secret
  '    fields:',
  '      - { key: up, label: Up, path: summary.up }',
  '  adguard_primary:',
  '    preset: adguard',
  '    instance: primary',
  '    url: http://adguard.example.test:3000',
  '    username: admin',
  '    password: $secret:integration_adguard_primary_password', // pragma: allowlist secret
  '    target: "pi1:adguard"',
  '',
].join('\n');

function fixtureFile() {
  // Each for the address it was entered for (#556).
  setSecret('statuspage_key', STATUSPAGE_KEY, { origins: ['http://status.example.test:80'] });
  setSecret('integration_adguard_primary_password', ADGUARD_PASSWORD, { origins: ['http://adguard.example.test:3000'] });
  handWritten(FILE);
}

upstreams['status.example.test'] = async () => json({ summary: { up: 3 } });
upstreams['status2.example.test'] = async () => json({ summary: { up: 1 } });
upstreams['adguard.example.test'] = async () => json({ num_dns_queries: 10 });
upstreams['adguard-new.example.test'] = async () => json({ num_dns_queries: 10 });

test('testing a custom integration requests <url><endpoint>, never undefined', async () => {
  fixtureFile();

  const { result, made } = await recorded(() => testForm(STATUSPAGE.saveUnchanged));

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });
  assert.deepEqual(
    made.map((r) => [r.method, r.url, r.headers['x-api-key']]),
    [['GET', 'http://status.example.test/api/summary', STATUSPAGE_KEY]]
  );
  assert.ok(!made.some((r) => r.url.includes('undefined')));

  // A URL changed in the form and not saved: its endpoint is the stored one.
  // The stored key goes only where it was entered (#556): it is typed again.
  const moved = await recorded(() =>
    testForm({ ...STATUSPAGE.saveUnchanged, url: 'status2.example.test', token: STATUSPAGE_KEY })
  );
  assert.deepEqual(moved.result.body, { ok: true });
  assert.deepEqual(
    moved.made.map((r) => [r.method, r.url, r.headers['x-api-key']]),
    [['GET', 'http://status2.example.test/api/summary', STATUSPAGE_KEY]]
  );
});

test('the test and the refresh build the same request for the same config', async () => {
  // Every auth path: header (custom), basic (preset), query (preset), session (preset).
  setSecret('integration_sabnzbd_token', 'sab-key', { origins: ['http://sab.example.test:8080'] }); // pragma: allowlist secret
  setSecret('integration_npm_password', 'npm-pw', { origins: ['http://npm.example.test:80'] }); // pragma: allowlist secret
  upstreams['sab.example.test'] = async () => json({ queue: { noofslots_total: 2 } });
  upstreams['npm.example.test'] = async (u, init) =>
    init.method === 'POST' ? json({ token: `tok-${Math.random()}` }) : json([]);
  const cases = [
    { key: STATUSPAGE.key, form: STATUSPAGE.saveUnchanged },
    { key: ADGUARD_PRIMARY.key, form: ADGUARD_PRIMARY.saveUnchanged },
    {
      key: 'sabnzbd',
      line: [
        '  sabnzbd:',
        '    preset: sabnzbd',
        '    url: http://sab.example.test:8080',
        '    token: $secret:integration_sabnzbd_token', // pragma: allowlist secret
      ],
      form: { type: 'sabnzbd', url: 'http://sab.example.test:8080', target: '', username: '', editingKey: 'sabnzbd' },
    },
    {
      key: 'npm',
      line: [
        '  npm:',
        '    preset: npm',
        '    url: http://npm.example.test',
        '    username: admin',
        '    password: $secret:integration_npm_password', // pragma: allowlist secret
      ],
      form: { type: 'npm', url: 'http://npm.example.test', target: '', username: 'admin', editingKey: 'npm' },
    },
  ];

  for (const { key, line, form } of cases) {
    fixtureFile();
    // Only this integration is enabled, so the refresh fetches it alone.
    const lines = FILE.split('\n').map((l) =>
      /^ {2}\w/.test(l) && l.trim() !== `${key}:` ? `${l}\n    enabled: false` : l
    );
    handWritten([...lines.slice(0, -1), ...(line || []), ''].join('\n'));

    const tested = await recorded(() => testForm(form));
    assert.deepEqual(tested.result.body, { ok: true }, key);
    const refreshed = await recorded(refresh);
    assert.equal(refreshed.result[key]._error, undefined, `${key}: ${refreshed.result[key]._error}`);

    assert.ok(tested.made.length > 0, key);
    // A session login's token differs per login; the read carries it.
    const same = (made) =>
      made.map((r) => ({ ...r, headers: { ...r.headers, authorization: r.headers.authorization?.replace(/tok-[\d.]+/, 'tok') } }));
    assert.deepEqual(same(tested.made), same(refreshed.made), key);
  }
});

test('unsaved form values are tested, and nothing is saved', async () => {
  fixtureFile();
  const file = bytes(CONFIG_PATH);
  const secrets = bytes(SECRETS_PATH);
  const typed = 'typed-not-saved'; // pragma: allowlist secret
  const form = {
    ...ADGUARD_PRIMARY.saveUnchanged,
    url: 'http://adguard-new.example.test:3000',
    password: typed,
  };

  const tested = await recorded(() => testForm(form));

  assert.deepEqual(tested.result.body, { ok: true });
  // The typed password, not the stored one, at the typed URL.
  const basic = (pw) => `Basic ${Buffer.from(`admin:${pw}`).toString('base64')}`;
  assert.deepEqual(
    tested.made.map((r) => [r.url, r.headers.authorization]),
    [['http://adguard-new.example.test:3000/control/stats', basic(typed)]]
  );
  // Nothing written: services.yaml and secrets.json byte-for-byte, the stored
  // password as it was.
  assert.ok(bytes(CONFIG_PATH).equals(file), 'services.yaml changed');
  assert.ok(bytes(SECRETS_PATH).equals(secrets), 'secrets.json changed');
  assert.equal(getSecret('integration_adguard_primary_password'), ADGUARD_PASSWORD);
  const before = await recorded(refresh);
  assert.deepEqual(
    before.made.filter((r) => r.url.includes('adguard')).map((r) => [r.url, r.headers.authorization]),
    [['http://adguard.example.test:3000/control/stats', basic(ADGUARD_PASSWORD)]]
  );

  // Saved, the refresh sends what the test sent.
  assert.equal((await save(form)).status, 200);
  loadConfig();
  const saved = await recorded(refresh);
  assert.deepEqual(
    saved.made.filter((r) => r.url.includes('adguard')),
    tested.made
  );
});

test('stored credentials resolve as the save will leave them: moved with a renamed entry, none for a new one', async () => {
  fixtureFile();
  // Left under the keys by deletes before #415: a preset resolves these
  // names ahead of the entry's own reference.
  setSecret('integration_adguard_renamed_password', 'stale-renamed'); // pragma: allowlist secret
  setSecret('integration_adguard_fresh_password', 'stale-fresh'); // pragma: allowlist secret
  const file = bytes(CONFIG_PATH);
  const secrets = bytes(SECRETS_PATH);
  const basic = (pw) => `Basic ${Buffer.from(`admin:${pw}`).toString('base64')}`;

  // A new instance name moves the entry, and its stored password with it.
  const renamed = await recorded(() =>
    testForm({ ...ADGUARD_PRIMARY.saveUnchanged, instance: 'renamed' })
  );
  assert.deepEqual(renamed.result.body, { ok: true });
  assert.deepEqual(renamed.made.map((r) => r.headers.authorization), [basic(ADGUARD_PASSWORD)]);

  // A new integration starts with no credential but the one typed.
  const fresh = await recorded(() =>
    testForm({
      type: 'adguard',
      url: 'http://adguard.example.test:3000',
      instance: 'fresh',
      target: '',
      username: 'admin',
      enabled: true,
      create: true,
    })
  );
  assert.deepEqual(fresh.result.body, { ok: true });
  assert.equal(fresh.made.length, 1);
  assert.notEqual(fresh.made[0].headers.authorization, basic('stale-fresh'));

  assert.ok(bytes(CONFIG_PATH).equals(file), 'services.yaml changed');
  assert.ok(bytes(SECRETS_PATH).equals(secrets), 'secrets.json changed');
});

test('a session login is made afresh for a test, and its token is not kept', async () => {
  fixtureFile();
  let accepted = 'npm-right'; // pragma: allowlist secret
  const logins = [];
  upstreams['npm2.example.test'] = async (u, init) => {
    if (init.method !== 'POST') return json([]);
    const { secret } = JSON.parse(init.body);
    logins.push(secret);
    return secret === accepted ? json({ token: `tok-${secret}` }) : json({ error: 'no' }, 401);
  };
  setSecret('integration_npm2_password', accepted, { origins: ['http://npm2.example.test:80'] }); // pragma: allowlist secret
  handWritten(
    [
      'integrations:',
      '  npm2:',
      '    preset: npm',
      '    url: http://npm2.example.test',
      '    username: admin',
      '    password: $secret:integration_npm2_password', // pragma: allowlist secret
      '',
    ].join('\n')
  );
  const form = { type: 'npm', url: 'http://npm2.example.test', target: '', username: 'admin', editingKey: 'npm2' };

  await refresh(); // logs in and caches the session's token
  assert.deepEqual(logins, [accepted]);

  // A wrong password typed into the form: tested with a login of its own, not
  // passed on the cached token.
  const wrong = await testForm({ ...form, password: 'npm-wrong' }); // pragma: allowlist secret
  assert.equal(wrong.body.ok, false);
  // It says why: the last login's reason.
  assert.equal(wrong.body.error, 'All session auth methods failed: Login returned HTTP 401');
  assert.deepEqual(logins, [accepted, 'npm-wrong']);

  // A right one is not kept: the refresh still reads on the token it cached.
  accepted = 'npm-new'; // pragma: allowlist secret
  assert.equal((await testForm({ ...form, password: 'npm-new' })).body.ok, true); // pragma: allowlist secret
  const { made } = await recorded(refresh);
  assert.deepEqual(logins, ['npm-right', 'npm-wrong', 'npm-new']);
  assert.deepEqual(
    made.map((r) => [r.method, r.headers.authorization]),
    [['GET', 'Bearer tok-npm-right']]
  );
});

test('a test is refused where its save would be, before anything is requested', async () => {
  fixtureFile();
  const cases = [
    // The entry the form edits is gone.
    [{ ...STATUSPAGE.saveUnchanged, editingKey: 'gone' }, 409, undefined],
    // A new integration from the form under a key another one holds.
    [{ type: 'adguard', url: 'http://a.example.test', instance: 'primary', create: true }, 409, 'instance'],
    // An unsupported preset.
    [{ type: 'qbittorrent', url: 'http://qb.example.test' }, 400, undefined],
  ];
  for (const [form, status, field] of cases) {
    const { result, made } = await recorded(() => testForm(form));
    assert.equal(result.status, status, JSON.stringify(form));
    assert.equal(result.body.ok, false);
    assert.equal(result.body.field, field);
    assert.deepEqual(made, []);
  }
});

test('a custom integration with no endpoint says so, and requests nothing', async () => {
  fixtureFile();
  const { result, made } = await recorded(() =>
    testForm({ type: '_custom', url: 'http://status.example.test', target: '', username: '', create: true })
  );
  assert.equal(result.body.ok, false);
  assert.match(result.body.error, /no endpoint to test.*services\.yaml/);
  assert.deepEqual(made, []);
});

test('a reply that is not JSON says so, and never quotes it, in the test and on the card', async () => {
  fixtureFile();
  const BODY = `<!DOCTYPE html><html>internal-page-${Math.random().toString(36).slice(2)}`;
  upstreams['html.example.test'] = async () =>
    new Response(BODY, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  // Moved to another address, so the key is typed again (#556).
  const form = { ...STATUSPAGE.saveUnchanged, url: 'http://html.example.test', token: STATUSPAGE_KEY };
  const said = 'The reply is not JSON (text/html)';

  const tested = await testForm(form);
  assert.deepEqual(tested.body, { ok: false, error: said });

  assert.equal((await save(form)).status, 200);
  loadConfig();
  const card = (await refresh()).statuspage._error;
  assert.equal(card, said);
  assert.ok(!JSON.stringify([tested.body, card]).includes('internal-page'));
});
