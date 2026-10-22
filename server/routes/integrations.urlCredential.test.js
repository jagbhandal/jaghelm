/**
 * #422: an integration's URL never carries a credential.
 *
 * A URL with a user name or password before the host (`user:pass@`), or a
 * secret query parameter (`?key=`, `?apikey=`, `?token=`), never worked: fetch
 * refuses userinfo, and the endpoint is appended after the query. It was
 * stored anyway, went back to the browser in the config, and was logged
 * (redacted) on every failure. Now the save and the connection test refuse
 * it with a message beside the URL field that says where the credential
 * goes, never the value; one already in services.yaml is masked in the config
 * read, and its refresh says where to move it without requesting it.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import yaml from 'js-yaml';

process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret
for (const v of ['JAGHELM_ADGUARD_URL', 'JAGHELM_ADGUARD_USER', 'JAGHELM_ADGUARD_PASS', 'SABNZBD_URL', 'SABNZBD_API_KEY']) {
  delete process.env[v];
}

const { loadConfig } = await import('../config.js');
const { initSecrets, setSecret } = await import('../secrets.js');
const { initRegistry } = await import('../integrations/registry.js');
const { refreshIntegrations } = await import('../refresh.js');
const { integrationRoutes } = await import('./integrations.js');
const { servicesRoutes } = await import('./services.js');
const { URL_CREDENTIAL } = await import('./fixtures/settingsForm.js');

initSecrets();
await initRegistry();

const DATA = process.env.JAGHELM_DATA_DIR;
const CONFIG_PATH = join(DATA, 'services.yaml');
const SECRETS_PATH = join(DATA, 'secrets.json');

const requested = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  requested.push(String(url));
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
};
after(() => {
  globalThis.fetch = realFetch;
});

let addr = 0;
const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use('/api/integrations', integrationRoutes);
app.use('/api/services', servicesRoutes);
const post = (path, body) =>
  request(app)
    .post(`/api/integrations/${path}`)
    .set('X-Forwarded-For', `10.1.${Math.floor(++addr / 250)}.${addr % 250}`)
    .send(body);

/** Everything the server logs while `fn` runs, and what it returns. */
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
    return { result: await fn(), logs: written.join('') };
  } finally {
    for (const r of restore) r();
  }
}

const STORED = [
  'integrations:',
  '  adguard:',
  '    preset: adguard',
  '    url: http://adguard.example.test:3000',
  '    username: admin',
  '    password: $secret:integration_adguard_password', // pragma: allowlist secret
  '',
].join('\n');
function stored() {
  setSecret('integration_adguard_password', 'stored-pw'); // pragma: allowlist secret
  writeFileSync(CONFIG_PATH, STORED);
  loadConfig();
}
const bytes = (path) => readFileSync(path);

// What the form sends for each, with the credential in the URL. The value is
// random, so a match anywhere can only be the value itself.
const SECRET = `s3cr3t${Math.random().toString(36).slice(2)}`;
const forms = [
  {
    what: 'user:pass@ for a basic-auth preset',
    body: { type: 'adguard', url: `http://admin:${SECRET}@adguard.example.test:3000`, username: 'admin', editingKey: 'adguard' },
    says: /user name or password.*Username and Password fields/,
  },
  {
    what: 'a token as the user, with no password',
    body: { type: 'adguard', url: `http://${SECRET}@adguard.example.test:3000`, editingKey: 'adguard' },
    says: /user name or password.*Username and Password fields/,
  },
  {
    what: '?key= on a custom integration',
    body: { type: '_custom', url: `http://custom.example.test/?key=${SECRET}`, create: true },
    says: /\(key=\).*API Token field.*services\.yaml/,
  },
  {
    what: '?apikey= on a query-auth preset',
    body: { type: 'sabnzbd', url: `http://sab.example.test/?apikey=${SECRET}`, create: true },
    says: /\(apikey=\).*API Key field/,
  },
  {
    what: '&token= after another parameter',
    body: { type: 'adguard', url: `adguard.example.test:3000/?a=1&token=${SECRET}`, editingKey: 'adguard' },
    says: /\(token=\).*Username and Password fields/,
  },
];

for (const { what, body, says } of forms) {
  for (const path of ['save', 'test']) {
    test(`${path}: a URL with ${what} is refused beside the URL field, never quoting it`, async () => {
      stored();
      const file = bytes(CONFIG_PATH);
      const secrets = bytes(SECRETS_PATH);
      const from = requested.length;

      const { result: res, logs } = await logsOf(() => post(path, body));

      assert.equal(res.status, 400);
      assert.equal(res.body.field, 'url');
      assert.match(res.body.error, says);
      // The message the web app's test shows beside the field (fixtures).
      if (what.startsWith('user:pass@')) {
        assert.deepEqual(res.body, { ...(path === 'test' && { ok: false }), ...URL_CREDENTIAL.refused.body });
      }
      if (path === 'test') assert.equal(res.body.ok, false);
      assert.ok(!JSON.stringify(res.body).includes(SECRET), 'the answer quotes the credential');
      assert.ok(!logs.includes(SECRET), 'a log line quotes the credential');
      assert.ok(!res.body.error.includes('admin'), 'the answer quotes the user name');
      // Nothing stored or requested.
      assert.ok(bytes(CONFIG_PATH).equals(file), 'services.yaml changed');
      assert.ok(bytes(SECRETS_PATH).equals(secrets), 'secrets.json changed');
      assert.deepEqual(requested.slice(from), []);
    });
  }
}

test('a plain URL saves and tests as before, a query or an @ in the path included', async () => {
  for (const url of [
    'http://adguard2.example.test:3000',
    'adguard2.example.test:3000',
    'http://adguard2.example.test/control?limit=10',
    'http://adguard2.example.test/u@x',
  ]) {
    stored();
    const body = { type: 'adguard', url, username: 'admin', editingKey: 'adguard' };
    const tested = await post('test', body);
    assert.equal(tested.status, 200, url);
    assert.equal(tested.body.ok, true, tested.body.error);
    const saved = await post('save', body);
    assert.equal(saved.status, 200, url);
    const entry = yaml.load(readFileSync(CONFIG_PATH, 'utf8')).integrations.adguard;
    assert.equal(entry.url, /^http/.test(url) ? url : `http://${url}`);
    assert.equal(entry.password, '$secret:integration_adguard_password'); // pragma: allowlist secret
  }
});

test('a URL already stored with a credential is masked in the config read, and its refresh says where to move it', async () => {
  const urls = {
    adguard: `http://admin:${SECRET}@adguard.example.test:3000`,
    sabnzbd: `http://sab.example.test/?apikey=${SECRET}`,
    mine: `http://mine.example.test/?token=${SECRET}`,
  };
  writeFileSync(
    CONFIG_PATH,
    [
      'integrations:',
      '  adguard:',
      '    preset: adguard',
      `    url: "${urls.adguard}"`,
      '    username: admin',
      '  sabnzbd:',
      '    preset: sabnzbd',
      `    url: "${urls.sabnzbd}"`,
      '  mine:',
      `    url: "${urls.mine}"`,
      '    endpoint: /api',
      '    fields: []',
      '',
    ].join('\n')
  );
  loadConfig();

  const read = await request(app).get('/api/services/config');
  assert.equal(read.status, 200);
  for (const key of Object.keys(urls)) {
    assert.deepEqual(read.body.integrations[key].url, { $stored: true }, key);
  }
  assert.ok(!read.text.includes(SECRET), 'the config read sends the credential');

  const from = requested.length;
  const { result, logs } = await logsOf(refreshIntegrations);
  assert.deepEqual(requested.slice(from), [], 'a URL with a credential was requested');
  assert.match(result.adguard._error, /carries a user name or password.*Username and Password fields/);
  assert.match(result.sabnzbd._error, /carries a credential in its query \(apikey=\).*API Key field/);
  assert.match(result.mine._error, /carries a credential in its query \(token=\).*API Token field/);
  for (const key of Object.keys(urls)) assert.match(result[key]._error, /Edit it in Settings/);
  assert.ok(!JSON.stringify(result).includes(SECRET), 'a refresh error quotes the credential');
  assert.ok(!logs.includes(SECRET), 'a log line quotes the credential');
});
