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

test('network error carries the cause code, never the key', async () => {
  const c = createArcaneClient({
    baseUrl: 'https://m',
    apiKey: KEY,
    fetchImpl: async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error(`self-signed ${KEY}`), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }),
      });
    },
  });
  await assert.rejects(c.listEnvironments(), (e) => {
    assert.equal(e.message, 'Arcane request failed: fetch failed (DEPTH_ZERO_SELF_SIGNED_CERT)');
    assert.equal(e.message.includes(KEY), false);
    return true;
  });
  const plain = createArcaneClient({ baseUrl: 'https://m', apiKey: KEY, fetchImpl: async () => { throw new Error('boom'); } });
  await assert.rejects(plain.listEnvironments(), { message: 'Arcane request failed: boom' });
});

test('vulnerability reads: exact paths, POST body for summaries, key in the header only', async () => {
  const { calls, client } = mk(fx('vulnerabilities-summaries'));
  const sums = await client.vulnSummaries('a/b', ['sha256:aaa111', 'sha256:ccc333']);
  assert.equal(sums['sha256:fff666'].status, 'failed');
  assert.equal(calls[0].url, 'https://m:3552/api/environments/a%2Fb/images/vulnerabilities/summaries');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].opts.headers['X-API-Key'], KEY);
  assert.deepEqual(JSON.parse(calls[0].opts.body), { imageIds: ['sha256:aaa111', 'sha256:ccc333'] });
  assert.equal(calls[0].opts.body.includes(KEY), false);

  const page = mk(fx('vulnerabilities-all'));
  const got = await page.client.listVulnerabilities('0', { start: 200, limit: 100 });
  assert.equal(got.data.length, 5);
  assert.equal(got.totalItems, 5);
  assert.equal(
    page.calls[0].url,
    'https://m:3552/api/environments/0/vulnerabilities/all?severity=CRITICAL,HIGH&fixAvailable=true&start=200&limit=100'
  );
  assert.equal(page.calls[0].opts.method, 'GET');
  assert.equal(page.calls[0].opts.body, undefined);

  const ov = mk(fx('vulnerabilities-overview'));
  assert.equal((await ov.client.vulnOverview('0')).drivers.knownExploited, 1);
  assert.equal(ov.calls[0].url, 'https://m:3552/api/environments/0/vulnerabilities/overview');
});

test('vulnerability reads reject malformed payloads', async () => {
  const bad = async (body, call) =>
    assert.rejects(call(mk(body).client), (e) => e instanceof ArcaneError && e.status === null);
  await bad({ success: true, data: { summaries: [] } }, (c) => c.vulnSummaries('0', ['x']));
  await bad({ success: true, data: {} }, (c) => c.vulnSummaries('0', ['x']));
  await bad({ success: true, data: [] }, (c) => c.listVulnerabilities('0'));
  await bad({ success: true, data: [], pagination: { totalItems: -1 } }, (c) => c.listVulnerabilities('0'));
  await bad({ success: true, data: [], pagination: { totalItems: 1.5 } }, (c) => c.listVulnerabilities('0'));
  await bad({ success: false, data: [], pagination: { totalItems: 0 } }, (c) => c.listVulnerabilities('0'));
  await bad({ success: true, data: [1] }, (c) => c.vulnOverview('0'));
});

test('a missing grant is an ArcaneError with status 403 and the path without the query', async () => {
  const { client } = mk({ error: 'permission denied: vulnerabilities:read' }, { ok: false, status: 403 });
  await assert.rejects(client.listVulnerabilities('0', { start: 0, limit: 100 }), (e) => {
    assert.equal(e.status, 403);
    assert.equal(e.message, 'Arcane HTTP 403 for /api/environments/0/vulnerabilities/all');
    return true;
  });
  await assert.rejects(client.vulnSummaries('0', []), { status: 403 });
});
