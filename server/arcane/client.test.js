import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createArcaneClient, ArcaneError } from './client.js';

const KEY = 'arc_testkey'; // pragma: allowlist secret
const fx = (n) => readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8');

function mk(body, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok,
      status,
      json: async () => {
        if (typeof body === 'string') return JSON.parse(body);
        return body;
      },
    };
  };
  return { calls, client: createArcaneClient({ baseUrl: 'https://m:3552/', apiKey: KEY, fetchImpl }) };
}

test('sends X-API-Key, never Authorization', async () => {
  const { calls, client } = mk(fx('environments'));
  await client.listEnvironments();
  assert.equal(calls[0].opts.headers['X-API-Key'], KEY);
  assert.equal(calls[0].opts.headers.Authorization, undefined);
  assert.equal(calls[0].opts.trusted, true);
});

test('builds exact paths with encoded env id', async () => {
  const { calls, client } = mk(fx('environments'));
  await client.listEnvironments();
  await client.listContainers('a/b');
  await client.listActivities('0', 'auto_update');
  await client.listActivities('0', 'system_prune', 5);
  await client.updaterHistory('0');
  const urls = calls.map((c) => c.url);
  assert.deepEqual(urls, [
    'https://m:3552/api/environments?limit=-1',
    'https://m:3552/api/environments/a%2Fb/containers?limit=-1',
    'https://m:3552/api/environments/0/activities?type=auto_update&order=desc&limit=20',
    'https://m:3552/api/environments/0/activities?type=system_prune&order=desc&limit=5',
    'https://m:3552/api/environments/0/updater/history?limit=200',
  ]);
});

test('unwraps envelope; app-version unenveloped returned as-is', async () => {
  const envs = await mk(fx('environments')).client.listEnvironments();
  assert.equal(envs.length, 4);
  const v = await mk(fx('app-version')).client.appVersion();
  assert.equal(v.newestVersion, '2.17.0');
  const wrapped = await mk({ success: true, data: { currentVersion: '1' } }).client.appVersion();
  assert.equal(wrapped.currentVersion, '1');
  const { calls, client } = mk(fx('app-version'));
  await client.appVersion();
  assert.equal(calls[0].url, 'https://m:3552/api/app-version');
});

test('fixtures parse through the client', async () => {
  assert.equal((await mk(fx('containers')).client.listContainers('0')).length, 5);
  assert.equal((await mk(fx('activities-auto_update')).client.listActivities('0', 'auto_update')).length, 3);
  assert.equal((await mk(fx('activities-system_prune')).client.listActivities('0', 'system_prune')).length, 2);
  assert.equal((await mk(fx('updater-history')).client.updaterHistory('0')).length, 3);
});

test('non-2xx throws ArcaneError with status', async () => {
  const { client } = mk('{}', { ok: false, status: 403 });
  await assert.rejects(client.listEnvironments(), (e) => e instanceof ArcaneError && e.status === 403);
});

test('invalid JSON and non-array data throw with status null', async () => {
  const bad = {
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('x');
    },
  };
  const c = createArcaneClient({ baseUrl: 'https://m', apiKey: KEY, fetchImpl: async () => bad });
  await assert.rejects(c.listEnvironments(), (e) => e instanceof ArcaneError && e.status === null);
  const { client } = mk({ success: true, data: { nope: 1 } });
  await assert.rejects(client.listEnvironments(), (e) => e instanceof ArcaneError && e.status === null);
});

test('network error wrapped, key not in message', async () => {
  const c = createArcaneClient({
    baseUrl: 'https://m',
    apiKey: KEY,
    fetchImpl: async () => {
      throw new Error('boom');
    },
  });
  await assert.rejects(c.listEnvironments(), (e) => e instanceof ArcaneError && e.status === null && !e.message.includes(KEY));
});

test('activities are read page by page (job_run)', async () => {
  const { calls, client } = mk(fx('activities-job_run'));
  assert.equal((await client.listActivities('0', 'job_run', 50)).length, 4);
  await client.listActivities('0', 'job_run', 50, 100);
  assert.deepEqual(
    calls.map((c) => c.url),
    [
      'https://m:3552/api/environments/0/activities?type=job_run&order=desc&limit=50',
      'https://m:3552/api/environments/0/activities?type=job_run&order=desc&limit=50&start=100',
    ]
  );
});
