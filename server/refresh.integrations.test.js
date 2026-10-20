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
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import yaml from 'js-yaml';

process.env.DASH_SECRET = 'test-secret-at-least-16-chars-long'; // pragma: allowlist secret
for (const v of ['NPM_URL', 'NPM_USER', 'NPM_PASS']) delete process.env[v];

const { saveConfig, loadConfig } = await import('./config.js');
const { initSecrets, setSecret } = await import('./secrets.js');
const { initRegistry } = await import('./integrations/registry.js');
const { refreshIntegrations } = await import('./refresh.js');
const { getCached } = await import('./cache.js');
const { integrationRoutes } = await import('./routes/integrations.js');

initSecrets();
await initRegistry();

const S = 1000;
const CYCLE = 30 * S;
mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
after(() => mock.timers.reset());

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

test('a login rejected with 401 is not retried until its config changes; a hand edit of services.yaml retries at once', async () => {
  const basic = (password) =>
    custom('nas.example.test', { auth: 'basic', username: 'u', password });
  saveConfig({ integrations: { nas: basic('old') } });
  const good = `Basic ${Buffer.from('u:new').toString('base64')}`;
  upstreams['nas.example.test'] = async (u, init) =>
    new Headers(init.headers).get('authorization') === good ? json({ up: 'yes' }) : json({}, 401);

  const first = await cycle();
  assert.deepEqual(first.hosts, ['nas.example.test']);
  const failed = first.result.nas;
  assert.equal(failed._error, 'HTTP 401');
  assert.deepEqual(failed._status, {
    state: 'auth_failed',
    since: Date.now(),
    failures: 1,
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

test('a session login rejected with 403 waits too; a new secret retries it, and so does a save in Settings', async () => {
  // Nginx Proxy Manager: POST /api/tokens, then GET /api/nginx/proxy-hosts.
  let secretWanted = 'new';
  let dataStatus = 200;
  upstreams['npm.example.test'] = async (u, init) => {
    if (init.method === 'POST') {
      return JSON.parse(init.body).secret === secretWanted
        ? json({ token: 'tok' })
        : json({ error: 'nope' }, 403);
    }
    return dataStatus === 200
      ? json([{ enabled: true, meta: { nginx_online: true }, certificate_id: 1 }])
      : json({}, dataStatus);
  };
  const app = express();
  app.use(express.json());
  app.use('/api/integrations', integrationRoutes);
  const save = (password) =>
    request(app)
      .post('/api/integrations/save')
      .send({ type: 'npm', url: 'http://npm.example.test', username: 'u', password });

  saveConfig({ integrations: {} });
  assert.equal((await save('old')).status, 200);
  const logins = () =>
    calls.filter((c) => c.host === 'npm.example.test' && c.method === 'POST').length;

  let r = await cycle();
  assert.equal(logins(), 1);
  assert.equal(r.result.npm._status.state, 'auth_failed');
  assert.equal(r.result.npm._preset, 'npm');
  for (let i = 0; i < 25; i++) r = await cycle();
  assert.equal(logins(), 1, 'no login sent while the config is the same');

  // Saved again unchanged: that is the way to say "try again now".
  assert.equal((await save('old')).status, 200);
  r = await cycle(1);
  assert.equal(logins(), 2);
  assert.equal(r.result.npm._status.state, 'auth_failed');
  await cycle();
  assert.equal(logins(), 2);

  // Only the stored secret changes (services.yaml still names the same $secret).
  setSecret('integration_npm_password', 'new');
  r = await cycle(1);
  assert.equal(logins(), 3);
  assert.equal(r.result.npm._status.state, 'ok');
  assert.equal(r.result.npm.Online, '1');

  // Logins are rejected from now on (the upstream changed): the cached session
  // still reads, then fails, and the next login is rejected again.
  secretWanted = 'newer';
  dataStatus = 401;
  r = await cycle();
  assert.equal(logins(), 4);
  assert.equal(r.result.npm._status.state, 'auth_failed');
});
