/**
 * #239: failing integrations back off, and a rejected login waits for a config
 * change. Every integration used to be fetched every cycle (30 s) however long
 * it had been failing, holding one of the six fetch slots for up to the 8 s
 * timeout, and a wrong password was a login attempt every 30 s forever.
 *
 * These tests drive the real refreshIntegrations against a stubbed fetch, with
 * the clock mocked: each "cycle" moves Date 30 s on and runs one refresh, as the
 * background loop would. Tests share module state and run in order; each uses
 * its own integration keys.
 */
import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import yaml from 'js-yaml';

process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret
for (const v of ['NPM_URL', 'NPM_USER', 'NPM_PASS']) delete process.env[v];

const { saveConfig, loadConfig, getConfig } = await import('./config.js');
const { initSecrets, setSecret } = await import('./secrets.js');
const { initRegistry, getPresetFull } = await import('./integrations/registry.js');
const { refreshIntegrations } = await import('./refresh.js');
const { getCached } = await import('./cache.js');
const { integrationRoutes } = await import('./routes/integrations.js');
const { PARKED_HINT } = await import('./integrations/backoff.js');

// A stored secret that fails to decrypt: each read of it logs an error, as every
// secret read does while DASH_SECRET is unset, so its log lines count the reads.
writeFileSync(
  join(process.env.JAGHELM_DATA_DIR, 'secrets.json'),
  JSON.stringify({ corrupt_pw: { iv: '00'.repeat(12), data: '00', tag: '00'.repeat(16) } })
);
initSecrets();
await initRegistry();

const S = 1000;
const CYCLE = 30 * S;
// Date moves only when a test moves it, and the backoff's monotonic clock
// (performance.now) moves with it.
mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
mock.method(performance, 'now', () => Date.now());
after(() => {
  mock.timers.reset();
  mock.restoreAll();
});

// ── Stubbed upstreams, by host ──
const calls = [];
const upstreams = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  calls.push({ host: u.hostname, path: u.pathname, method: init.method || 'GET' });
  const answer = upstreams[u.hostname];
  if (!answer) throw new Error(`no upstream for ${u.hostname}`);
  return answer(u, init);
};
after(() => {
  globalThis.fetch = realFetch;
});

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const custom = (host, extra = {}) => ({
  url: `http://${host}`,
  endpoint: '/status',
  auth: 'none',
  fields: [{ key: 'up', label: 'Up', path: 'up' }],
  ...extra,
});
const hostsCalled = (from) => calls.slice(from).map((c) => c.host);

// The Settings API, as the web app calls it. `save` sends what the form sends:
// a password only when one was typed (the form never fills in a stored one).
const app = express();
app.use(express.json());
app.use('/api/integrations', integrationRoutes);
const save = (body) => request(app).post('/api/integrations/save').send(body);

/** One background cycle: the clock moves on by `ms`, then the integrations refresh. */
async function cycle(ms = CYCLE) {
  mock.timers.tick(ms);
  const from = calls.length;
  const result = await refreshIntegrations();
  assert.ok(result, 'the refresh returned a payload');
  assert.equal(getCached('integrations'), result, 'and cached it');
  return { result, hosts: hostsCalled(from) };
}

test('a failing integration is retried after 30 s, 1, 2, 4, 8, then every 10 min; a success resets it', async () => {
  saveConfig({ integrations: { flaky: custom('flaky.example.test') } });
  let up = false;
  upstreams['flaky.example.test'] = async () => (up ? json({ up: 'yes' }) : json({}, 502));

  const start = Date.now();
  const attempts = [];
  let lastAttempt = null;
  for (let t = 0; t <= 2910; t += 30) {
    if (t === 2730) up = true; // back on its 9th attempt
    if (t === 2820) up = false; // and down again three cycles later
    const { result, hosts } = await cycle(t === 0 ? 0 : CYCLE);
    const entry = result.flaky;
    if (hosts.length > 0) {
      attempts.push(t);
      lastAttempt = entry;
    } else {
      assert.equal(
        entry,
        lastAttempt,
        `t=${t}s: not due, so the last attempt's entry is served again`
      );
    }

    if (t === 2130) {
      // The 8th failure in a row: the next attempt is 10 min away.
      assert.equal(entry._error, 'HTTP 502');
      assert.equal(entry._preset, 'flaky');
      assert.deepEqual(entry._status, {
        state: 'backing_off',
        since: start,
        failures: 8,
        nextAttemptAt: start + 2730 * S,
      });
    }
    if (t === 2790) {
      assert.equal(entry.Up, 'yes');
      assert.equal(entry._error, undefined);
      assert.deepEqual(entry._status, {
        state: 'ok',
        since: start + 2730 * S,
        failures: 0,
        nextAttemptAt: null,
      });
    }
  }
  assert.deepEqual(attempts, [
    0,
    30,
    90,
    210,
    450,
    930,
    1530,
    2130,
    2730, // 30 s, 1, 2, 4, 8, 10, 10, 10 min apart
    2760,
    2790,
    2820, // ok: every cycle; then the first failure
    2850,
    2910, // 30 s, then 1 min again
  ]);
});

test('a backed-off integration takes no fetch slot: only the due ones are fetched, and the payload keeps config order', async () => {
  const good = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'];
  const integrations = { dead: custom('dead.example.test') };
  for (const g of good) {
    integrations[g] = custom(`${g}.example.test`);
    upstreams[`${g}.example.test`] = async () => json({ up: 'yes' });
  }
  saveConfig({ integrations });
  upstreams['dead.example.test'] = async () => {
    throw new Error('connect ECONNREFUSED');
  };

  let r = await cycle();
  assert.equal(r.hosts.length, 7);
  r = await cycle(); // the second failure: next attempt in 1 min
  assert.equal(r.hosts.length, 7);
  r = await cycle();
  assert.deepEqual(
    r.hosts.sort(),
    good.map((g) => `${g}.example.test`).sort(),
    'the dead one is not fetched at all'
  );
  assert.deepEqual(Object.keys(r.result), ['dead', ...good]);
  assert.match(r.result.dead._error, /ECONNREFUSED/);
  assert.equal(r.result.dead._status.state, 'backing_off');
  for (const g of good) assert.equal(r.result[g]._status.state, 'ok');
});

test('a login refused twice in a row (401) is not retried until its config changes; a hand edit of services.yaml retries it in the next cycle', async () => {
  const basic = (password) =>
    custom('nas.example.test', { auth: 'basic', username: 'u', password });
  saveConfig({ integrations: { nas: basic('old') } });
  const good = `Basic ${Buffer.from('u:new').toString('base64')}`;
  upstreams['nas.example.test'] = async (u, init) =>
    new Headers(init.headers).get('authorization') === good ? json({ up: 'yes' }) : json({}, 401);

  const first = await cycle();
  assert.deepEqual(first.hosts, ['nas.example.test']);
  assert.equal(first.result.nas._error, 'HTTP 401', 'refused once: retried on its own, no hint');
  assert.deepEqual(first.result.nas._status, {
    state: 'backing_off',
    since: Date.now(),
    failures: 1,
    nextAttemptAt: Date.now() + 30 * S,
  });

  const second = await cycle();
  assert.deepEqual(second.hosts, ['nas.example.test'], 'one more login, 30 s on');
  const failed = second.result.nas;
  assert.equal(
    failed._error,
    `HTTP 401 (${PARKED_HINT})`,
    'written in services.yaml, and a save in Settings retries it as it does any other (#402)'
  );
  assert.deepEqual(failed._status, {
    state: 'auth_failed',
    since: Date.now(),
    failures: 2,
    nextAttemptAt: null,
  });

  // 40 cycles (20 min, twice the longest backoff): no login is sent.
  for (let i = 0; i < 40; i++) {
    const { result, hosts } = await cycle();
    assert.deepEqual(hosts, []);
    assert.equal(result.nas, failed);
  }

  // A change to another part of the config is not a change to this integration.
  saveConfig({
    nodes: { pve: { display_name: 'PVE' } },
    integrations: { nas: basic('old'), other: custom('other.example.test') },
  });
  upstreams['other.example.test'] = async () => json({ up: 'yes' });
  assert.deepEqual((await cycle()).hosts, ['other.example.test']);

  // The password fixed by hand in services.yaml, picked up as the file watcher does.
  const path = join(process.env.JAGHELM_DATA_DIR, 'services.yaml');
  writeFileSync(
    path,
    yaml.dump({ integrations: { nas: basic('new'), other: custom('other.example.test') } })
  );
  loadConfig();
  const fixed = await cycle(1); // a moment later, not a backoff period
  assert.ok(
    fixed.hosts.includes('nas.example.test'),
    'retried in the first cycle after the change'
  );
  assert.equal(fixed.result.nas.Up, 'yes');
  assert.equal(fixed.result.nas._status.state, 'ok');
});

test('a save in Settings retries an integration written by hand too, and leaves services.yaml as it was (#402)', async () => {
  // A custom integration with an API key header, written by hand: before #402
  // the save rebuilt it from the form as { url, enabled } and lost the rest.
  let keyWanted = 'new';
  upstreams['hand.example.test'] = async (u, init) =>
    new Headers(init.headers).get('x-api-key') === keyWanted ? json({ up: 'yes' }) : json({}, 401);
  setSecret('hand_key', 'old');
  const path = join(process.env.JAGHELM_DATA_DIR, 'services.yaml');
  const text = [
    '# Written by hand.',
    'integrations:',
    '  hand:',
    '    url: http://hand.example.test',
    '    endpoint: /status',
    '    auth: header',
    '    authHeader: X-Api-Key',
    '    token: $secret:hand_key', // pragma: allowlist secret
    '    fields: [{ key: up, label: Up, path: up }]',
    '',
  ].join('\n');
  writeFileSync(path, text);
  loadConfig();

  await cycle();
  const parked = (await cycle()).result.hand;
  assert.equal(parked._status.state, 'auth_failed');
  assert.equal(parked._error, `HTTP 401 (${PARKED_HINT})`);
  assert.deepEqual((await cycle()).hosts, [], 'parked');

  // The key is fixed on the app's side; the integration is saved from its
  // form in Settings with nothing changed (the token field left blank).
  keyWanted = 'old';
  const r = await save({
    type: 'hand',
    url: 'http://hand.example.test',
    enabled: true,
    target: '',
    username: '',
    editingKey: 'hand',
  });
  assert.equal(r.status, 200);
  assert.equal(readFileSync(path, 'utf8'), text, 'services.yaml is not rewritten');
  const fixed = await cycle(1);
  assert.deepEqual(fixed.hosts, ['hand.example.test'], 'retried at the next refresh');
  assert.equal(fixed.result.hand.Up, 'yes');
  assert.equal(fixed.result.hand._status.state, 'ok');
});

test('enabling an integration from its row retries it, even when it is disabled and enabled between two refreshes (#402)', async () => {
  let accepted = 'new';
  const basicFor = (pw) => `Basic ${Buffer.from(`u:${pw}`).toString('base64')}`;
  upstreams['toggle.example.test'] = async (u, init) =>
    new Headers(init.headers).get('authorization') === basicFor(accepted)
      ? json({ up: 'yes' })
      : json({}, 401);
  // `enabled: true` is written out, so disabling and enabling it again gives
  // back the same entry, and so the same fingerprint: only the retry the
  // toggle asks for gets it attempted.
  const entry = custom('toggle.example.test', { auth: 'basic', username: 'u', enabled: true });
  entry.password = 'old'; // pragma: allowlist secret
  saveConfig({ integrations: { tog: entry } });
  await cycle();
  assert.equal((await cycle()).result.tog._status.state, 'auth_failed');
  assert.deepEqual((await cycle()).hosts, [], 'parked');

  accepted = 'old'; // fixed on the app's side
  const toggle = (enabled) => request(app).patch('/api/integrations/tog').send({ enabled });
  assert.equal((await toggle(false)).status, 200);
  assert.equal((await toggle(true)).status, 200);
  assert.deepEqual(getConfig().integrations.tog, entry);
  const r = await cycle(1);
  assert.deepEqual(r.hosts, ['toggle.example.test'], 'retried at the next refresh');
  assert.equal(r.result.tog._status.state, 'ok');
});

test('a session login refused twice (403) waits too; a save in Settings retries it with the stored password, and so does a new secret', async () => {
  // Nginx Proxy Manager: POST /api/tokens, then GET /api/nginx/proxy-hosts.
  let secretWanted = 'new';
  let dataStatus = 200;
  const loginsSent = [];
  upstreams['npm.example.test'] = async (u, init) => {
    if (init.method === 'POST') {
      const { secret } = JSON.parse(init.body);
      loginsSent.push(secret);
      return secret === secretWanted ? json({ token: 'tok' }) : json({ error: 'nope' }, 403);
    }
    return dataStatus === 200
      ? json([{ enabled: true, meta: { nginx_online: true }, certificate_id: 1 }])
      : json({}, dataStatus);
  };
  const npm = { type: 'npm', url: 'http://npm.example.test', username: 'u' };

  // Added from the gallery with a password the app no longer takes.
  saveConfig({ integrations: {} });
  assert.equal((await save({ ...npm, password: 'old' })).status, 200);
  let r = await cycle();
  assert.equal(r.result.npm._status.state, 'backing_off');
  r = await cycle();
  assert.deepEqual(loginsSent, ['old', 'old']);
  assert.equal(r.result.npm._status.state, 'auth_failed');
  assert.equal(
    r.result.npm._error,
    `All session auth methods failed (${PARKED_HINT})`,
    'the hint says to save it in Settings'
  );
  assert.equal(r.result.npm._preset, 'npm');
  for (let i = 0; i < 25; i++) r = await cycle();
  assert.equal(loginsSent.length, 2, 'no login sent while the config is the same');

  // Saved again from the form, which leaves the password blank: the stored one
  // is still the one sent.
  assert.equal((await save(npm)).status, 200);
  r = await cycle(1);
  assert.deepEqual(
    loginsSent.slice(2),
    ['old'],
    'retried at the next refresh, with the stored password'
  );
  assert.equal(r.result.npm._status.state, 'backing_off', 'and it gets its two attempts again');
  r = await cycle();
  assert.equal(loginsSent.length, 4);
  assert.equal(r.result.npm._status.state, 'auth_failed');

  // Saved once more with nothing changed at all: services.yaml stays the same,
  // so only the save itself asks for the retry.
  const before = getConfig().integrations.npm;
  assert.equal((await save(npm)).status, 200);
  assert.deepEqual(getConfig().integrations.npm, before);
  r = await cycle(1);
  assert.equal(loginsSent.length, 5);
  assert.equal(loginsSent[4], 'old');
  r = await cycle();
  assert.equal(loginsSent.length, 6);
  assert.equal(r.result.npm._status.state, 'auth_failed');
  await cycle();
  assert.equal(loginsSent.length, 6);

  // Only the stored secret changes (services.yaml still names the same one).
  setSecret('integration_npm_password', 'new');
  r = await cycle(1);
  assert.equal(loginsSent.length, 7);
  assert.equal(r.result.npm._status.state, 'ok');
  assert.equal(r.result.npm.Online, '1');

  // Logins are refused from now on (the upstream changed): the cached session
  // still reads, then fails; the fresh login in that attempt is refused, and so
  // is the one 30 s later.
  secretWanted = 'newer';
  dataStatus = 401;
  r = await cycle();
  assert.equal(loginsSent.length, 8);
  assert.equal(r.result.npm._status.state, 'backing_off');
  r = await cycle();
  assert.equal(loginsSent.length, 9);
  assert.equal(r.result.npm._status.state, 'auth_failed');
});

test('a save in Settings while the integration is being fetched is not lost', async () => {
  let secretWanted = 'right';
  let saveDuringLogin = false;
  let logins = 0;
  upstreams['npm2.example.test'] = async (u, init) => {
    if (init.method === 'POST') {
      logins += 1;
      const { secret } = JSON.parse(init.body);
      if (saveDuringLogin) {
        // The user fixed the password on the app's side and saves in Settings,
        // unchanged, before this login's answer comes back.
        saveDuringLogin = false;
        secretWanted = secret;
        const res = await save(two);
        assert.equal(res.status, 200);
        return json({ error: 'nope' }, 403);
      }
      return secret === secretWanted ? json({ token: 'tok2' }) : json({ error: 'nope' }, 403);
    }
    return json([{ enabled: true, meta: { nginx_online: true }, certificate_id: 2 }]);
  };
  const two = { type: 'npm', instance: 'two', url: 'http://npm2.example.test', username: 'u' };

  // The password is stored, and the entry has none, as when a save left the
  // field blank: so the save during the login leaves services.yaml as it was.
  setSecret('integration_npm_two_password', 'wrong');
  saveConfig({ integrations: {} });
  assert.equal((await save(two)).status, 200);
  const entry = getConfig().integrations.npm_two;
  let r = await cycle();
  assert.equal(r.result.npm_two._status.state, 'backing_off');

  saveDuringLogin = true;
  r = await cycle();
  assert.equal(logins, 2);
  assert.deepEqual(getConfig().integrations.npm_two, entry, 'the save changed nothing');
  assert.equal(
    r.result.npm_two._status.state,
    'auth_failed',
    'the refused login in flight still counts'
  );

  r = await cycle(1);
  assert.equal(logins, 3, 'the save is honoured at the next refresh');
  assert.equal(r.result.npm_two._status.state, 'ok');
});

test('each integration is resolved once a cycle: the fetch reuses the config its fingerprint came from', async () => {
  saveConfig({
    integrations: {
      vault: custom('vault.example.test', {
        auth: 'basic',
        username: 'u',
        password: '$secret:corrupt_pw', // pragma: allowlist secret
      }),
    },
  });
  upstreams['vault.example.test'] = async () => json({}, 502);
  const secretReads = async () => {
    const orig = process.stderr.write;
    let n = 0;
    process.stderr.write = function (chunk, ...rest) {
      if (String(chunk).includes('"name":"corrupt_pw"')) {
        n += 1;
        return true;
      }
      return orig.call(this, chunk, ...rest);
    };
    try {
      const { hosts } = await cycle();
      return { reads: n, hosts };
    } finally {
      process.stderr.write = orig;
    }
  };
  assert.deepEqual(await secretReads(), { reads: 1, hosts: ['vault.example.test'] });
  assert.deepEqual(await secretReads(), { reads: 1, hosts: ['vault.example.test'] });
  assert.deepEqual(
    await secretReads(),
    { reads: 1, hosts: [] },
    'backing off: read once, for its fingerprint'
  );
});

test('#468: a fetch that throws keeps its preset and target in its entry, so a failed Proxmox read is still known for its node', async () => {
  saveConfig({
    integrations: {
      pmx: { preset: 'proxmox', url: 'http://pmx.example.test', target: 'pve:pve', instance: 'a' },
    },
  });
  // The fetch resolves the preset's config outside its own error handling: a
  // preset that throws there makes the fetch throw.
  const preset = getPresetFull('proxmox');
  Object.defineProperty(preset, 'boom', {
    enumerable: true,
    configurable: true,
    get() {
      throw new Error('the fetch threw');
    },
  });
  try {
    const { result, hosts } = await cycle();
    assert.deepEqual(hosts, [], 'nothing was fetched');
    const { _status, ...entry } = result.pmx;
    assert.deepEqual(entry, {
      _error: 'the fetch threw',
      _target: 'pve:pve',
      _instance: 'a',
      _preset: 'proxmox',
    });
    assert.equal(_status.state, 'backing_off');
  } finally {
    delete preset.boom;
  }
});
