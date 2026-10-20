/**
 * #413: the config read never carries a credential, and the config write puts
 * each stored one back.
 *
 * GET /api/services/config used to answer with services.yaml as it is, so a
 * password or token written by hand as plain text, or a `$secret:` reference,
 * went to the browser. Now each credential that is set comes back as the
 * marker { "$stored": true }. Settings' Nodes and Services tabs post the whole
 * config back with those markers in it, so POST /api/services/config puts the
 * stored value back in each marker's place: a marker is never written, and a
 * credential is never lost or moved to another place.
 *
 * These drive the real route against the real config module and file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import yaml from 'js-yaml';

const { loadConfig, getConfig } = await import('../config.js');
const { servicesRoutes } = await import('./services.js');
const { initRegistry, listPresets } = await import('../integrations/registry.js');

// The route masks what a preset's endpoint fills in, so it needs the presets.
await initRegistry();

const CONFIG_PATH = join(process.env.JAGHELM_DATA_DIR, 'services.yaml');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api/services', servicesRoutes);
const read = () => request(app).get('/api/services/config');
const write = (body) => request(app).post('/api/services/config').send(body);

const STORED = Object.freeze({ $stored: true });
const fileText = () => readFileSync(CONFIG_PATH, 'utf8');
/** Put `text` on disk and load it, as the config watcher does after a hand edit. */
function handEdit(text) {
  writeFileSync(CONFIG_PATH, text);
  loadConfig();
}
/** Everything the server logs while `fn` runs. */
async function logsOf(fn) {
  const written = [];
  const restore = [process.stdout, process.stderr].map((stream) => {
    const orig = stream.write;
    stream.write = function (chunk, ...rest) {
      written.push(String(chunk));
      return orig.call(this, chunk, ...rest);
    };
    return () => {
      stream.write = orig;
    };
  });
  try {
    const result = await fn();
    return { result, logs: written.join('') };
  } finally {
    for (const r of restore) r();
  }
}

// Written by hand: comments, quoting and flow style that JagHelm's own writer
// would not produce, so any rewrite of the file shows. Every kind of
// credential services.yaml can hold is in it.
const HAND_WRITTEN = [
  '# Written by hand, not by JagHelm.',
  'nodes:',
  '  pi1:',
  '    display_name: "Gateway"',
  '    visible: true',
  '    hide: [prometheus, cadvisor]',
  '  nas:',
  '    display_name: NAS',
  'services:',
  '  adguard: { monitor: "AdGuard (DNS)" }',
  'integrations:',
  '  # A status page with a plaintext key, and one in a header too.',
  '  statuspage:',
  '    url: "http://status.example.test"',
  '    endpoint: /api/summary',
  '    auth: header',
  '    authHeader: X-Api-Key',
  '    token: plain-token-7f3a', // pragma: allowlist secret
  '    extraHeaders:',
  '      Authorization: "Bearer header-secret-91c2"', // pragma: allowlist secret
  '      Accept: application/json',
  '    fields:',
  '      - { key: up, label: Up, path: summary.up }',
  '  npm:',
  '    url: http://npm.example.test',
  '    username: admin',
  "    password: 'hunter2-plaintext'", // pragma: allowlist secret
  '  adguard_primary:',
  '    preset: adguard',
  '    instance: primary',
  '    url: http://adguard.example.test:3000',
  '    username: admin',
  '    password: $secret:integration_adguard_primary_password', // pragma: allowlist secret
  '    target: "pi1:adguard"',
  '  # A custom session login with the credentials written into its body.',
  '  loginapp:',
  '    url: http://login.example.test',
  '    endpoint: /api/stats',
  '    auth: session',
  '    session:',
  '      loginEndpoint: /api/login',
  '      loginBody: { user: jag, pass: session-secret-55d1 }', // pragma: allowlist secret
  '      tokenPath: token',
  '      tokenHeader: Authorization',
  '  open:',
  '    url: http://open.example.test',
  "    password: ''",
  '    token: null',
  '',
].join('\n');

/** Every credential (or reference to one) in HAND_WRITTEN. */
const CREDENTIALS = [
  'plain-token-7f3a',
  'header-secret-91c2',
  'hunter2-plaintext',
  '$secret:',
  'integration_adguard_primary_password',
  'session-secret-55d1',
];
function assertNoCredential(text, what) {
  for (const c of CREDENTIALS) assert.ok(!text.includes(c), `${what} carries ${c}`);
}

/** What GET answers for HAND_WRITTEN. */
const ANSWER = {
  nodes: {
    pi1: { display_name: 'Gateway', visible: true, hide: ['prometheus', 'cadvisor'] },
    nas: { display_name: 'NAS' },
  },
  services: { adguard: { monitor: 'AdGuard (DNS)' } },
  integrations: {
    statuspage: {
      url: 'http://status.example.test',
      endpoint: '/api/summary',
      auth: 'header',
      authHeader: 'X-Api-Key',
      token: STORED,
      extraHeaders: { Authorization: STORED, Accept: STORED },
      fields: [{ key: 'up', label: 'Up', path: 'summary.up' }],
    },
    npm: { url: 'http://npm.example.test', username: 'admin', password: STORED },
    adguard_primary: {
      preset: 'adguard',
      instance: 'primary',
      url: 'http://adguard.example.test:3000',
      username: 'admin',
      password: STORED,
      target: 'pi1:adguard',
    },
    loginapp: {
      url: 'http://login.example.test',
      endpoint: '/api/stats',
      auth: 'session',
      session: {
        loginEndpoint: '/api/login',
        loginBody: STORED,
        tokenPath: 'token',
        tokenHeader: 'Authorization',
      },
    },
    open: { url: 'http://open.example.test', password: '', token: null },
  },
};

test('GET /config: no credential, plaintext or $secret:, is in the answer', async () => {
  handEdit(HAND_WRITTEN);
  const r = await read();
  assert.equal(r.status, 200);
  assertNoCredential(r.text, 'the answer');
});

test('GET /config: each stored credential is { "$stored": true }; the rest is as stored', async () => {
  handEdit(HAND_WRITTEN);
  const r = await read();
  // A password or token that is empty or null stays as it is: the marker
  // always means a value is stored.
  assert.deepEqual(r.body, ANSWER);
  // The config in memory still has the credentials: the answer is a copy.
  assert.equal(getConfig().integrations.npm.password, 'hunter2-plaintext'); // pragma: allowlist secret
});

test('GET then POST unchanged: services.yaml stays byte-for-byte as it was', async () => {
  handEdit(HAND_WRITTEN);
  const before = statSync(CONFIG_PATH).mtimeMs;
  const r = await read();
  const saved = await write(r.body);
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(saved.body, { ok: true });
  assert.equal(fileText(), HAND_WRITTEN);
  assert.equal(statSync(CONFIG_PATH).mtimeMs, before, 'the file was written');
});

test('GET, edit one node as the Nodes tab does, POST: every credential is kept', async () => {
  handEdit(HAND_WRITTEN);
  const cfg = (await read()).body;
  // NodesTab.updateNode: the whole config, with one field of one node changed.
  const edited = { ...cfg, nodes: { ...cfg.nodes, pi1: { ...cfg.nodes.pi1, visible: false } } };
  const saved = await write(edited);
  assert.equal(saved.status, 200, saved.text);

  const onDisk = yaml.load(fileText());
  const want = yaml.load(HAND_WRITTEN);
  want.nodes.pi1.visible = false;
  assert.deepEqual(onDisk, want);
  assert.deepEqual(getConfig(), want);
  assert.ok(!fileText().includes('$stored'), 'a marker was written');
});

test('GET, hide a container as the Services tab does, POST: every credential is kept', async () => {
  handEdit(HAND_WRITTEN);
  const cfg = (await read()).body;
  const node = cfg.nodes.nas;
  const edited = { ...cfg, nodes: { ...cfg.nodes, nas: { ...node, hide: ['watchtower'] } } };
  assert.equal((await write(edited)).status, 200);

  const want = yaml.load(HAND_WRITTEN);
  want.nodes.nas.hide = ['watchtower'];
  assert.deepEqual(yaml.load(fileText()), want);
});

test('POST: a marker where nothing is stored is refused (409) and nothing is written', async (t) => {
  const cases = {
    'a new integration': (c) => {
      c.integrations.newapp = { url: 'http://new.example.test', password: STORED };
      return 'integrations.newapp.password';
    },
    'an empty password': (c) => {
      c.integrations.open.password = STORED;
      return 'integrations.open.password';
    },
    'a null token': (c) => {
      c.integrations.open.token = STORED;
      return 'integrations.open.token';
    },
    "another entry's marker copied to an entry without one": (c) => {
      c.integrations.adguard_primary.token = c.integrations.npm.password;
      return 'integrations.adguard_primary.token';
    },
    'an entry renamed with its marker': (c) => {
      c.integrations.npm2 = c.integrations.npm;
      delete c.integrations.npm;
      return 'integrations.npm2.password';
    },
    'a header that is not stored': (c) => {
      c.integrations.statuspage.extraHeaders.Cookie = STORED;
      return 'integrations.statuspage.extraHeaders.Cookie';
    },
  };
  for (const [name, edit] of Object.entries(cases)) {
    await t.test(name, async () => {
      handEdit(HAND_WRITTEN);
      const cfg = (await read()).body;
      const path = edit(cfg);
      const r = await write(cfg);
      assert.equal(r.status, 409, r.text);
      assert.ok(r.body.error.includes(path), r.body.error);
      assert.equal(fileText(), HAND_WRITTEN);
    });
  }
});

test('POST: a marker in place of anything but a credential is refused (400)', async (t) => {
  const cases = {
    'a node name': (c) => (c.nodes.pi1.display_name = STORED),
    'an integration URL': (c) => (c.integrations.npm.url = STORED),
    'a username': (c) => (c.integrations.npm.username = STORED),
    'a whole entry': (c) => (c.integrations.npm = STORED),
    'the whole header map': (c) => (c.integrations.statuspage.extraHeaders = STORED),
    'a service override': (c) => (c.services.adguard = STORED),
  };
  for (const [name, edit] of Object.entries(cases)) {
    await t.test(name, async () => {
      handEdit(HAND_WRITTEN);
      const cfg = (await read()).body;
      edit(cfg);
      const r = await write(cfg);
      assert.equal(r.status, 400, r.text);
      assert.equal(fileText(), HAND_WRITTEN);
    });
  }
});

test('POST: an object with "$stored" that is not the marker is refused (400)', async (t) => {
  for (const bad of [{ $stored: true, value: 'x' }, { $stored: 'true' }, { $stored: false }, {
    $stored: 1,
  }]) {
    await t.test(JSON.stringify(bad), async () => {
      handEdit(HAND_WRITTEN);
      const cfg = (await read()).body;
      cfg.integrations.npm.password = bad;
      const r = await write(cfg);
      assert.equal(r.status, 400, r.text);
      assert.equal(fileText(), HAND_WRITTEN);
    });
  }
});

test('POST: a credential sent as a value still replaces the stored one', async () => {
  handEdit(HAND_WRITTEN);
  const cfg = (await read()).body;
  cfg.integrations.npm.password = 'typed-in-new'; // pragma: allowlist secret
  delete cfg.integrations.statuspage.extraHeaders.Accept;
  assert.equal((await write(cfg)).status, 200);

  const onDisk = yaml.load(fileText()).integrations;
  assert.equal(onDisk.npm.password, 'typed-in-new'); // pragma: allowlist secret
  assert.deepEqual(onDisk.statuspage.extraHeaders, { Authorization: 'Bearer header-secret-91c2' }); // pragma: allowlist secret
  assert.equal(onDisk.adguard_primary.password, '$secret:integration_adguard_primary_password'); // pragma: allowlist secret
  assert.deepEqual((await read()).body.integrations.npm.password, STORED);
});

test('POST never answers or logs a credential, whether it saves or refuses', async () => {
  handEdit(HAND_WRITTEN);
  const { result: answers, logs } = await logsOf(async () => {
    const cfg = (await read()).body;
    const out = [];
    out.push(await write(cfg));
    out.push(await write({ ...cfg, nodes: { ...cfg.nodes, nas: { display_name: 'Disks' } } }));
    const stale = structuredClone(cfg);
    stale.integrations.open.password = STORED;
    out.push(await write(stale));
    const misplaced = structuredClone(cfg);
    misplaced.integrations.npm.url = STORED;
    out.push(await write(misplaced));
    out.push(await write({ ...cfg, services: [1, 2, 3] }));
    return out;
  });
  assert.deepEqual(
    answers.map((r) => r.status),
    [200, 200, 409, 400, 400]
  );
  for (const r of answers) assertNoCredential(r.text, `the ${r.status} answer`);
  assertNoCredential(logs, 'the log');
});

// ── Since the review: endpoints, placeholders, other names, arrays ───────

// Every other place a credential can live: a key in an endpoint's query, a
// value an endpoint fills in through a placeholder (the entry's own or its
// preset's), a credential under another name, a fallback session's login body,
// and entries in arrays.
const MORE = [
  'nodes:',
  '  pi1: { display_name: Gateway, visible: true }',
  'integrations:',
  '  plex:',
  '    url: http://plex.example.test:32400',
  '    endpoint: /status/sessions?X-Plex-Token=plex-secret-a1', // pragma: allowlist secret
  '  stats:',
  '    url: http://stats.example.test',
  '    endpoint: /api/stats?apikey=query-secret-b2', // pragma: allowlist secret
  '    extraEndpoints:',
  '      - { key: one, endpoint: "/one?token=extra-secret-c3" }', // pragma: allowlist secret
  '      - { key: two, endpoint: /two }',
  '  sites:',
  '    url: http://sites.example.test',
  '    endpoint: /sites/{site_code}/summary',
  '    site_code: placeholder-secret-d4', // pragma: allowlist secret
  '  nextdns:',
  '    url: https://api.nextdns.io',
  '    profile_id: preset-placeholder-e5', // pragma: allowlist secret
  '  cloudflare_two:',
  '    preset: cloudflare',
  '    url: https://api.cloudflare.com',
  '    account_id: acc-visible',
  '  named:',
  '    url: http://named.example.test',
  '    apiKey: name-secret-f6', // pragma: allowlist secret
  '    client_secret: name-secret-g7', // pragma: allowlist secret
  '    cookie: name-secret-h8', // pragma: allowlist secret
  '    key: name-secret-i9', // pragma: allowlist secret
  '    fields: [{ key: up, label: Up, path: a.up }]',
  '  photos:',
  '    url: http://photos.example.test',
  '    auth: session',
  '    authFallback: alt',
  '    alt: { loginEndpoint: /login2, loginBody: "user=root&secret=fallback-secret-j0" }', // pragma: allowlist secret
  'custom_integrations:',
  '  - { name: a, url: "http://a.example.test", token: array-secret-a }', // pragma: allowlist secret
  '  - { name: b, url: "http://b.example.test", token: array-secret-b }', // pragma: allowlist secret
  '',
].join('\n');
const MORE_SECRETS = [
  'plex-secret-a1',
  'query-secret-b2',
  'extra-secret-c3',
  'placeholder-secret-d4',
  'preset-placeholder-e5',
  'name-secret-f6',
  'name-secret-g7',
  'name-secret-h8',
  'name-secret-i9',
  'fallback-secret-j0',
  'array-secret-a',
  'array-secret-b',
];

test('GET /config: an endpoint key, a placeholder value, other names and a fallback login are masked', async () => {
  handEdit(MORE);
  const r = await read();
  for (const c of MORE_SECRETS) assert.ok(!r.text.includes(c), `the answer carries ${c}`);
  const i = r.body.integrations;
  assert.deepEqual(i.plex.endpoint, STORED);
  assert.deepEqual(i.stats.endpoint, STORED);
  assert.deepEqual(i.stats.extraEndpoints, [
    { key: 'one', endpoint: STORED },
    { key: 'two', endpoint: '/two' },
  ]);
  assert.equal(i.sites.endpoint, '/sites/{site_code}/summary');
  assert.deepEqual(i.sites.site_code, STORED);
  // nextdns's preset endpoint fills in profile_id.
  assert.deepEqual(i.nextdns.profile_id, STORED);
  // Cloudflare's account_id is a URL parameter the form shows and saves.
  assert.equal(i.cloudflare_two.account_id, 'acc-visible');
  for (const k of ['apiKey', 'client_secret', 'cookie', 'key']) assert.deepEqual(i.named[k], STORED, k);
  assert.deepEqual(i.named.fields, [{ key: 'up', label: 'Up', path: 'a.up' }]);
  assert.deepEqual(i.photos.alt.loginBody, STORED);
  assert.deepEqual(r.body.custom_integrations.map((e) => [e.name, e.token]), [
    ['a', STORED],
    ['b', STORED],
  ]);
});

test('GET, edit one node, POST: every one of those credentials is kept', async () => {
  handEdit(MORE);
  const cfg = (await read()).body;
  const edited = { ...cfg, nodes: { ...cfg.nodes, pi1: { ...cfg.nodes.pi1, visible: false } } };
  assert.equal((await write(edited)).status, 200);
  const want = yaml.load(MORE);
  want.nodes.pi1.visible = false;
  assert.deepEqual(yaml.load(fileText()), want);
  assert.ok(!fileText().includes('$stored'), 'a marker was written');
});

test('GET, reorder the arrays, POST: each element keeps its own credential', async () => {
  handEdit(MORE);
  const cfg = (await read()).body;
  cfg.custom_integrations.reverse();
  cfg.integrations.stats.extraEndpoints.reverse();
  assert.equal((await write(cfg)).status, 200);
  const onDisk = yaml.load(fileText());
  assert.deepEqual(onDisk.custom_integrations.map((e) => [e.name, e.token]), [
    ['b', 'array-secret-b'], // pragma: allowlist secret
    ['a', 'array-secret-a'], // pragma: allowlist secret
  ]);
  assert.deepEqual(onDisk.integrations.stats.extraEndpoints, [
    { key: 'two', endpoint: '/two' },
    { key: 'one', endpoint: '/one?token=extra-secret-c3' }, // pragma: allowlist secret
  ]);

  // An element whose name changed has nothing stored under it.
  handEdit(MORE);
  const renamed = (await read()).body;
  renamed.custom_integrations[0].name = 'c';
  const r = await write(renamed);
  assert.equal(r.status, 409, r.text);
  assert.equal(fileText(), MORE);
});

test("no preset's URL parameter is masked, so the integration form never gets a marker", async () => {
  const presets = listPresets().filter((p) => p.urlParams?.length);
  assert.ok(presets.length > 0, 'no preset has a URL parameter');
  for (const p of presets) {
    const entry = { preset: p.type, url: 'http://x.example.test' };
    for (const { key } of p.urlParams) entry[key] = 'value';
    handEdit(yaml.dump({ integrations: { [`${p.type}_check`]: entry, [p.type]: entry } }));
    const r = await read();
    assert.deepEqual(r.body.integrations[`${p.type}_check`], entry, p.type);
    assert.deepEqual(r.body.integrations[p.type], entry, p.type);
  }
});
