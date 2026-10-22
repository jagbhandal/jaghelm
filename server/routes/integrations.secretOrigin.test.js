/**
 * #556: a stored credential goes only to the address it was entered for.
 *
 * A signed-in session could send any stored secret to any host: point an
 * entry that keeps its masked credential at another URL (the form, the
 * whole-config save), or name another entry's secret (`token:
 * $secret:<name>`) in the whole-config save. Now each stored secret carries
 * the origins it was entered for, and every request that carries one is
 * checked against them before it is sent: the next refresh sends nothing to
 * any other origin, and says to re-enter the credential for this address.
 * The form and the whole-config save refuse a masked credential whose
 * entry's URL moved to another origin.
 *
 * These drive the real routes and the real refresh against a stubbed fetch
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
const { initSecrets, setSecret, getSecretOrigins } = await import('../secrets.js');
const { initRegistry } = await import('../integrations/registry.js');
const { refreshIntegrations, retryIntegrationNow } = await import('../refresh.js');
const { integrationRoutes } = await import('./integrations.js');
const { servicesRoutes } = await import('./services.js');
const { secretsRoutes } = await import('./secrets.js');

initSecrets();
await initRegistry();

const DATA = process.env.JAGHELM_DATA_DIR;
const CONFIG_PATH = join(DATA, 'services.yaml');
const SECRETS_PATH = join(DATA, 'secrets.json');

// Random, so a match anywhere can only be the secret itself.
const SP_KEY = `sp-${Math.random().toString(36).slice(2)}`;
const AG_PASSWORD = `ag-${Math.random().toString(36).slice(2)}`;
const NPM_PASSWORD = `npm-${Math.random().toString(36).slice(2)}`;
const SAB_KEY = `sab-${Math.random().toString(36).slice(2)}`;
const SHARED = `shared-${Math.random().toString(36).slice(2)}`;
const ALL = [SP_KEY, AG_PASSWORD, NPM_PASSWORD, SAB_KEY, SHARED];

const STATUS = 'http://status.example.test:80';
const ADGUARD = 'http://adguard.example.test:3000';
const NPM = 'http://npm.example.test:80';
const SAB = 'http://sab.example.test:8080';

// ── A stubbed upstream per host, recording every request ──
const requests = [];
const upstreams = {
  'status.example.test': async () => json({ summary: { up: 3 } }),
  'other.example.test': async () => json({ summary: { up: 1 } }),
  'adguard.example.test': async () => json({ num_dns_queries: 10 }),
  'adguard2.example.test': async () => json({ num_dns_queries: 20 }),
  'npm.example.test': async (u, init) => (init.method === 'POST' ? json({ token: 'session-tok' }) : json([])),
  'sab.example.test': async () => json({ queue: { noofslots_total: 2 } }),
  'collector.example.test': async () => json({}),
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  requests.push({
    url: String(url),
    host: u.hostname,
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
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Every request since `from` that carried one of the secrets, as text. */
function carrying(from, secrets = ALL) {
  return requests.slice(from).filter((r) => {
    const auth = String(r.headers.authorization || '');
    const text = JSON.stringify(r) + Buffer.from(auth.replace(/^Basic /, ''), 'base64').toString();
    return secrets.some((s) => text.includes(s));
  });
}
const hostsSince = (from) => requests.slice(from).map((r) => r.host);

let addr = 0;
const app = express();
app.disable('etag');
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use('/api/integrations', integrationRoutes);
app.use('/api/services', servicesRoutes);
app.use('/api/secrets', secretsRoutes);
const post = (path, body) =>
  request(app)
    .post(`/api/integrations/${path}`)
    .set('X-Forwarded-For', `10.5.${Math.floor(++addr / 250)}.${addr % 250}`)
    .send(body);

/** The whole-config save, as Settings sends it: the read, changed by `edit`. */
async function wholeConfigSave(edit) {
  const read = await request(app).get('/api/services/config');
  assert.equal(read.status, 200);
  const body = structuredClone(read.body);
  edit(body);
  return request(app).post('/api/services/config').set('If-Match', read.headers.etag).send(body);
}

/** One refresh of every enabled integration, each one due now. */
async function refresh() {
  const entries = yaml.load(readFileSync(CONFIG_PATH, 'utf8'))?.integrations || {};
  for (const key of Object.keys(entries)) retryIntegrationNow(key);
  const result = await refreshIntegrations();
  assert.ok(result, 'the refresh returned a payload');
  return result;
}

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
  '  plainhook:',
  '    url: http://status.example.test',
  '    endpoint: /api/summary',
  '    auth: header',
  '    authHeader: X-Hook-Key',
  '    token: plaintext-by-hand', // pragma: allowlist secret
  '',
].join('\n');

/** services.yaml on disk as `text`, loaded as the watcher would. */
function handWritten(text) {
  writeFileSync(CONFIG_PATH, text);
  loadConfig();
}
function fixture(text = FILE) {
  setSecret('statuspage_key', SP_KEY, { origins: [STATUS] });
  setSecret('integration_adguard_primary_password', AG_PASSWORD, { origins: [ADGUARD] });
  handWritten(text);
}
const bytes = (path) => readFileSync(path);
const REENTER = /re-enter the credential for this address/;

// ── The whole-config save ────────────────────────────────────────────────

const PROBES = [
  [
    "a new entry naming another entry's secret",
    (c) => {
      c.integrations.probe = {
        url: 'http://collector.example.test',
        endpoint: '/collect',
        auth: 'header',
        authHeader: 'X-Api-Key',
        token: '$secret:statuspage_key', // pragma: allowlist secret
      };
    },
    'probe',
  ],
  [
    "an entry moved to another host, naming another entry's secret",
    (c) => {
      c.integrations.plainhook.url = 'http://collector.example.test';
      c.integrations.plainhook.token = '$secret:integration_adguard_primary_password'; // pragma: allowlist secret
    },
    'plainhook',
  ],
];

for (const [what, edit, key] of PROBES) {
  test(`whole-config save, ${what}: the next refresh sends nothing there and says to re-enter`, async () => {
    fixture();
    const saved = await wholeConfigSave(edit);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));

    const from = requests.length;
    const result = await refresh();

    assert.deepEqual(
      requests.slice(from).filter((r) => r.host === 'collector.example.test'),
      [],
      'a request reached the collector'
    );
    assert.match(result[key]._error, REENTER);
    for (const name of ['statuspage_key', 'integration_adguard_primary_password', ...ALL]) {
      assert.ok(!result[key]._error.includes(name), `the error names ${name}`);
    }
    // A fetch error, backing off: not a refused login, parked until the config changes.
    assert.equal(result[key]._status.state, 'backing_off');
    // The secret still goes where it was entered.
    assert.ok(carrying(from, [SP_KEY]).every((r) => r.host === 'status.example.test'));
    assert.ok(carrying(from, [AG_PASSWORD]).every((r) => r.host === 'adguard.example.test'));
  });
}

test('whole-config save: a masked credential whose entry moved to another origin is refused, naming it', async () => {
  for (const [key, field, url] of [
    ['statuspage', 'token', 'http://collector.example.test'],
    ['adguard_primary', 'password', 'https://adguard.example.test:3000'],
    // Typed into services.yaml by hand, out of the store: moved by the save, refused the same.
    ['plainhook', 'token', 'http://status.example.test:8080'],
  ]) {
    fixture();
    const file = bytes(CONFIG_PATH);
    for (const explicit of [false, true]) {
      const res = await wholeConfigSave((c) => {
        assert.deepEqual(c.integrations[key][field], { $stored: true });
        c.integrations[key].url = url;
        // The stored value named again instead of its marker is the same credential.
        if (explicit) c.integrations[key][field] = yaml.load(readFileSync(CONFIG_PATH, 'utf8')).integrations[key][field];
      });
      assert.equal(res.status, 400, `${key}: ${JSON.stringify(res.body)}`);
      assert.ok(res.body.error.includes(`integrations.${key}.${field}`), res.body.error);
      assert.match(res.body.error, new RegExp(`re-enter the ${field} for the new address`));
      assert.ok(bytes(CONFIG_PATH).equals(file), 'services.yaml changed');
    }
  }
});

// ── Every request stays on the origin of its own URL (the review's probes) ──

upstreams['status.example.test.collector.example.test'] = async () => json({ summary: { up: 9 } });
upstreams['npm.example.test.collector.example.test'] = async () => json([]);
const OFF_ORIGIN = /leads away from its URL/;

test('probe A: an endpoint changed to lead onto another host is not requested, so a hand-typed token stays', async () => {
  fixture();
  const saved = await wholeConfigSave((c) => {
    c.integrations.plainhook.endpoint = '.collector.example.test/api/summary';
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const from = requests.length;
  const result = await refresh();
  assert.ok(!hostsSince(from).some((h) => h.includes('collector')), JSON.stringify(hostsSince(from)));
  assert.match(result.plainhook._error, OFF_ORIGIN);
  assert.equal(result.plainhook._status.state, 'backing_off');
  // The others are unchanged.
  assert.equal(result.statuspage._error, undefined);
});

const HDR = [
  'integrations:',
  '  hdr:',
  '    url: http://status.example.test',
  '    endpoint: /api/summary',
  '    auth: none',
  '    extraHeaders: { X-Secret-Key: by-hand-header-cred }', // pragma: allowlist secret
  '    fields:',
  '      - { key: up, label: Up, path: summary.up }',
  '',
].join('\n');

test('probe B: a hand-typed header credential is not moved to a new origin by the form or the whole-config save', async () => {
  for (const path of ['test', 'save']) {
    handWritten(HDR);
    const file = bytes(CONFIG_PATH);
    const from = requests.length;
    const res = await post(path, { type: 'hdr', url: 'http://collector.example.test', target: '', username: '', editingKey: 'hdr' });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.error, /extraHeaders\.X-Secret-Key/);
    assert.ok(!res.body.error.includes('by-hand-header-cred'));
    assert.equal(res.body.field, undefined, 'no form field holds it');
    assert.deepEqual(requests.slice(from), []);
    assert.ok(bytes(CONFIG_PATH).equals(file));
  }
  const res = await wholeConfigSave((c) => {
    c.integrations.hdr.url = 'http://collector.example.test';
  });
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.match(res.body.error, /integrations\.hdr\.extraHeaders\.X-Secret-Key/);
  assert.match(res.body.error, /re-enter the X-Secret-Key for the new address/);
});

test('probe C: an entry on the same URL with an endpoint onto another host sends nothing, and no session token', async () => {
  setSecret('integration_npm_password', NPM_PASSWORD, { origins: [NPM] });
  handWritten(['integrations:', '  npm:', '    preset: npm', '    url: http://npm.example.test', '    username: admin', ''].join('\n'));
  await refresh(); // logs in at npm, caches the token
  const saved = await wholeConfigSave((c) => {
    c.integrations.x = { preset: 'npm', url: 'http://npm.example.test', endpoint: '.collector.example.test/x' };
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const from = requests.length;
  const result = await refresh();
  assert.ok(!hostsSince(from).some((h) => h.includes('collector')), JSON.stringify(hostsSince(from)));
  assert.match(result.x._error, OFF_ORIGIN);
  assert.ok(requests.slice(from).every((r) => r.host === 'npm.example.test'));
});

test("a session token is kept per entry: another entry on the same URL never reads with npm's", async () => {
  const npmUp = upstreams['npm.example.test'];
  upstreams['npm.example.test'] = async (u, init) => {
    if (init.method !== 'POST') return json([]);
    const { secret } = JSON.parse(init.body);
    return secret === NPM_PASSWORD ? json({ token: 'tok-of-npm' }) : json({ error: 'no' }, 401);
  };
  try {
    setSecret('integration_npm_password', NPM_PASSWORD, { origins: [NPM] });
    handWritten(['integrations:', '  npm:', '    preset: npm', '    url: http://npm.example.test', '    username: admin', ''].join('\n'));
    await refresh(); // npm logs in and caches its token
    handWritten(
      [
        'integrations:',
        '  npm:',
        '    preset: npm',
        '    url: http://npm.example.test',
        '    username: admin',
        // No credential of its own, its own read.
        '  y:',
        '    preset: npm',
        '    url: http://npm.example.test',
        '    endpoint: /api/y-data',
        '',
      ].join('\n')
    );
    const from = requests.length;
    const result = await refresh();
    const yReads = requests.slice(from).filter((r) => r.url.includes('/api/y-data'));
    assert.deepEqual(yReads, [], 'y read with a token it never got');
    assert.ok(result.y._error);
    assert.equal(result.npm._error, undefined);
  } finally {
    upstreams['npm.example.test'] = npmUp;
  }
});

test('whole-config save: the same origin, written another way, keeps the masked credential', async () => {
  fixture();
  const res = await wholeConfigSave((c) => {
    c.integrations.statuspage.url = 'http://STATUS.example.test:80/';
    c.integrations.adguard_primary.target = 'pi1:adguard';
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const from = requests.length;
  const result = await refresh();
  assert.equal(result.statuspage._error, undefined);
  assert.deepEqual(
    carrying(from, [SP_KEY]).map((r) => r.host),
    ['status.example.test']
  );
});

// ── The integration form: Save and Test ──────────────────────────────────

const STATUSPAGE_FORM = { type: 'statuspage', url: 'http://status.example.test', target: '', username: '', editingKey: 'statuspage' };
const ADGUARD_FORM = { type: 'adguard', url: 'http://adguard.example.test:3000', instance: 'primary', target: '', username: 'admin', editingKey: 'adguard_primary' };

for (const path of ['test', 'save']) {
  test(`form ${path}: a changed origin with the masked credential is a 400 naming it, and nothing is sent`, async () => {
    for (const [form, field] of [
      [{ ...STATUSPAGE_FORM, url: 'http://collector.example.test' }, 'token'],
      [{ ...ADGUARD_FORM, url: 'adguard.example.test:3001' }, 'password'],
      [{ ...ADGUARD_FORM, url: 'https://adguard.example.test:3000' }, 'password'],
    ]) {
      fixture();
      const file = bytes(CONFIG_PATH);
      const secrets = bytes(SECRETS_PATH);
      const from = requests.length;

      const res = await post(path, form);

      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.equal(res.body.field, field);
      assert.match(res.body.error, new RegExp(`re-enter the ${field} for the new address`));
      if (path === 'test') assert.equal(res.body.ok, false);
      assert.deepEqual(requests.slice(from), [], 'a request went out');
      assert.ok(bytes(CONFIG_PATH).equals(file), 'services.yaml changed');
      assert.ok(bytes(SECRETS_PATH).equals(secrets), 'secrets.json changed');
    }
  });
}

test('form: the same origin with the masked credential works as before', async () => {
  fixture();
  const from = requests.length;
  const tested = await post('test', { ...ADGUARD_FORM, url: 'http://adguard.example.test:3000/' });
  assert.deepEqual(tested.body, { ok: true });
  assert.deepEqual(
    requests.slice(from).map((r) => [r.url, r.headers.authorization]),
    [['http://adguard.example.test:3000/control/stats', `Basic ${Buffer.from(`admin:${AG_PASSWORD}`).toString('base64')}`]]
  );
  const saved = await post('save', { ...STATUSPAGE_FORM, target: 'pi1:status' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(getSecretOrigins('statuspage_key'), [STATUS]);
});

test('form: a credential typed for the new origin is tested and saved there, and goes only there', async () => {
  fixture();
  const typed = `typed-${Math.random().toString(36).slice(2)}`;
  const form = { ...ADGUARD_FORM, url: 'http://adguard2.example.test:3000', password: typed };

  let from = requests.length;
  const tested = await post('test', form);
  assert.deepEqual(tested.body, { ok: true });
  assert.deepEqual(hostsSince(from), ['adguard2.example.test']);

  const saved = await post('save', form);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(getSecretOrigins('integration_adguard_primary_password'), ['http://adguard2.example.test:3000']);

  from = requests.length;
  const result = await refresh();
  assert.equal(result.adguard_primary._error, undefined);
  assert.deepEqual(carrying(from, [typed]).map((r) => r.host), ['adguard2.example.test']);
  assert.deepEqual(carrying(from, [AG_PASSWORD]), []);
});

// ── A shared secret ──────────────────────────────────────────────────────

test('a shared secret works for both entries on one origin; a second origin needs re-entry, then both work', async () => {
  setSecret('shared_key', SHARED, { origins: [STATUS] });
  const entry = (name, url) => [
    `  ${name}:`,
    `    url: ${url}`,
    '    endpoint: /api/summary',
    '    auth: header',
    '    authHeader: X-Api-Key',
    '    token: $secret:shared_key', // pragma: allowlist secret
  ];
  const file = (url2) =>
    ['integrations:', ...entry('one', 'http://status.example.test'), ...entry('two', url2), ''].join('\n');

  handWritten(file('http://status.example.test'));
  let from = requests.length;
  let result = await refresh();
  assert.equal(result.one._error, undefined);
  assert.equal(result.two._error, undefined);
  assert.equal(carrying(from, [SHARED]).length, 2);

  // `two` moved to another host by hand: refused there, `one` unchanged.
  handWritten(file('http://other.example.test'));
  from = requests.length;
  result = await refresh();
  assert.equal(result.one._error, undefined);
  assert.match(result.two._error, REENTER);
  assert.deepEqual(hostsSince(from), ['status.example.test']);

  // Re-entered in `two`'s form for its address: both work.
  const saved = await post('save', { type: 'two', url: 'http://other.example.test', target: '', username: '', token: SHARED, editingKey: 'two' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  from = requests.length;
  result = await refresh();
  assert.equal(result.one._error, undefined);
  assert.equal(result.two._error, undefined);
  assert.deepEqual(carrying(from, [SHARED]).map((r) => r.host).sort(), ['other.example.test', 'status.example.test']);
});

test('re-entering the same value for a new origin adds it; a new value goes only to its own', async () => {
  // `mirror` shares adguard_primary's keyed secret, on the same origin.
  fixture(
    FILE +
      [
        '  mirror:',
        '    url: http://adguard.example.test:3000',
        '    endpoint: /control/stats',
        '    auth: basic',
        '    username: admin',
        '    password: $secret:integration_adguard_primary_password', // pragma: allowlist secret
        '',
      ].join('\n')
  );
  // adguard_primary moves, its password typed again as it was.
  let saved = await post('save', { ...ADGUARD_FORM, url: 'http://adguard2.example.test:3000', password: AG_PASSWORD });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  let from = requests.length;
  let result = await refresh();
  assert.equal(result.adguard_primary._error, undefined);
  assert.equal(result.mirror._error, undefined);
  assert.deepEqual(carrying(from, [AG_PASSWORD]).map((r) => r.host).sort(), ['adguard.example.test', 'adguard2.example.test']);

  // A new password: it goes only where it was typed.
  const fresh = `fresh-${Math.random().toString(36).slice(2)}`;
  saved = await post('save', { ...ADGUARD_FORM, url: 'http://adguard2.example.test:3000', password: fresh });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  from = requests.length;
  result = await refresh();
  assert.equal(result.adguard_primary._error, undefined);
  assert.match(result.mirror._error, REENTER);
  assert.deepEqual(carrying(from, [fresh]).map((r) => r.host), ['adguard2.example.test']);
});

// ── Redirects and session logins ─────────────────────────────────────────

test('a redirect to another origin does not carry the credential', async () => {
  fixture();
  setSecret('integration_sabnzbd_token', SAB_KEY, { origins: [SAB] });
  handWritten(
    FILE +
      ['  sabnzbd:', '    preset: sabnzbd', '    url: http://sab.example.test:8080', ''].join('\n')
  );
  const statusUp = upstreams['status.example.test'];
  const sabUp = upstreams['sab.example.test'];
  const away = () => new Response(null, { status: 302, headers: { location: 'http://collector.example.test/x' } });
  upstreams['status.example.test'] = async () => away();
  upstreams['sab.example.test'] = async () => away();
  try {
    const from = requests.length;
    const result = await refresh();
    // The header credential: the hop is followed without it.
    const hop = requests.slice(from).filter((r) => r.host === 'collector.example.test');
    assert.ok(hop.length >= 1, 'the header-auth redirect is followed');
    assert.deepEqual(carrying(from).filter((r) => r.host === 'collector.example.test'), []);
    for (const r of hop) {
      assert.equal(r.headers['x-api-key'], undefined);
      assert.equal(r.headers['x-hook-key'], undefined);
    }
    // The key in the URL: not followed at all.
    assert.ok(!hop.some((r) => r.url.includes('apikey')));
    assert.match(result.sabnzbd._error, /not following a redirect to another origin/);
  } finally {
    upstreams['status.example.test'] = statusUp;
    upstreams['sab.example.test'] = sabUp;
  }
});

test('a session login to another origin is refused: nothing is sent, and it is not parked as a refused login', async () => {
  setSecret('integration_npm_password', NPM_PASSWORD, { origins: [NPM] });
  setSecret('npm_pw', NPM_PASSWORD, { origins: [NPM] });
  handWritten(
    [
      'integrations:',
      '  npm:',
      '    preset: npm',
      '    url: http://collector.example.test',
      '    username: admin',
      // A custom session whose login endpoint joins onto another host.
      '  sess:',
      '    url: http://npm.example.test',
      '    endpoint: /api/nginx/proxy-hosts',
      '    auth: session',
      '    username: admin',
      '    password: $secret:npm_pw', // pragma: allowlist secret
      '    session:',
      '      loginEndpoint: .collector.example.test/login',
      '      loginBody: { identity: "{username}", secret: "{password}" }',
      '      tokenPath: token',
      '      tokenHeader: Authorization',
      '',
    ].join('\n')
  );
  for (let i = 0; i < 3; i++) {
    const from = requests.length;
    const result = await refresh();
    assert.deepEqual(requests.slice(from), [], 'a request went out');
    // npm's password was entered for its old address; sess's login leaves its URL's origin.
    for (const [key, said] of [['npm', REENTER], ['sess', /leads away from its URL/]]) {
      assert.match(result[key]._error, said);
      assert.equal(result[key]._status.state, 'backing_off');
    }
  }
});

// ── Origins stay in the store ────────────────────────────────────────────

test('the origins a secret is bound to are never in an API answer or a log line', async () => {
  const HIDDEN = 'only-in-the-store';
  setSecret('statuspage_key', SP_KEY, { origins: [`http://${HIDDEN}.example.test:8080`] });
  setSecret('integration_adguard_primary_password', AG_PASSWORD, { origins: [`https://${HIDDEN}.example.test:443`] });
  handWritten(FILE);
  assert.ok(readFileSync(SECRETS_PATH, 'utf8').includes(HIDDEN), 'the store holds them');

  const lines = [];
  const out = process.stdout.write;
  const err = process.stderr.write;
  process.stdout.write = function (chunk, ...rest) {
    lines.push(String(chunk));
    return out.call(this, chunk, ...rest);
  };
  process.stderr.write = function (chunk, ...rest) {
    lines.push(String(chunk));
    return err.call(this, chunk, ...rest);
  };
  const answers = [];
  try {
    answers.push(JSON.stringify(await refresh()));
    answers.push(JSON.stringify((await request(app).get('/api/secrets/keys')).body));
    answers.push(JSON.stringify((await request(app).get('/api/services/config')).body));
    answers.push(JSON.stringify((await post('test', STATUSPAGE_FORM)).body));
    answers.push(JSON.stringify((await post('test', { ...ADGUARD_FORM, url: 'http://collector.example.test' })).body));
    answers.push(JSON.stringify((await post('save', { ...STATUSPAGE_FORM, target: 'x' })).body));
    answers.push(JSON.stringify((await wholeConfigSave((c) => { c.integrations.statuspage.url = 'http://other.example.test'; })).body));
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
  assert.match(answers[0], REENTER, 'the refresh was refused');
  for (const a of answers) assert.ok(!a.includes(HIDDEN), `an answer carries an origin: ${a}`);
  assert.ok(lines.length > 0);
  for (const l of lines) assert.ok(!l.includes(HIDDEN), `a log line carries an origin: ${l}`);
});

test('a secret stored through the API is bound to the address given with it, else to none', async () => {
  const put = (key, body) => request(app).put(`/api/secrets/${key}`).send(body);
  assert.equal((await put('api_bound', { value: 'v', url: 'https://API.example.test/x' })).status, 200);
  assert.deepEqual(getSecretOrigins('api_bound'), ['https://api.example.test:443']);
  assert.equal((await put('api_unbound', { value: 'v' })).status, 200);
  assert.deepEqual(getSecretOrigins('api_unbound'), []);
  // A new value replaces the origins it had.
  assert.equal((await put('api_bound', { value: 'w' })).status, 200);
  assert.deepEqual(getSecretOrigins('api_bound'), []);
  const bad = await put('api_bad', { value: 'v', url: 'ftp://files.example.test' });
  assert.equal(bad.status, 400);
  assert.equal(getSecretOrigins('api_bad'), null);
});
