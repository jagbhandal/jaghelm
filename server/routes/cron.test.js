/**
 * Cron routes: report validation, overdue decoration, session-authed DELETE.
 * Auth is frozen at module load, so DASH_PASS and the data dir are set before
 * importing the app.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-cron-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.DASH_PASS = 'test-pass-1234';
process.env.JAGHELM_CRON_SECRET = 'cron-s3cret';
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { app } = await import('../index.js');
const { stopBackgroundRefresh } = await import('../refresh.js');
const { createSession } = await import('../auth/sessions.js');

const token = createSession('admin');
const STORE = join(dataDir, 'cron-jobs.json');

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DASH_PASS;
});

const report = (body) =>
  request(app)
    .post('/api/cron/report')
    .send({ secret: 'cron-s3cret', status: 'success', ...body });
const getStatus = () => request(app).get('/api/cron/status').set('x-auth-token', token);
const findJob = (body, node, job) =>
  body.find((n) => n.node === node)?.jobs.find((j) => j.job === job);

test('report with numeric expected_every_seconds is stored and shown', async () => {
  const r = await report({ node: 'n1', job: 'num', expected_every_seconds: 86400 });
  assert.equal(r.status, 200);
  const j = findJob((await getStatus()).body, 'n1', 'num');
  assert.equal(j.expected_every_seconds, 86400);
  assert.equal(j.overdue, false);
});

test('report with digit-string expected_every_seconds is accepted as a number', async () => {
  const r = await report({ node: 'n1', job: 'str', expected_every_seconds: '86400' });
  assert.equal(r.status, 200);
  const j = findJob((await getStatus()).body, 'n1', 'str');
  assert.equal(j.expected_every_seconds, 86400);
});

test('report without expected_every_seconds still works', async () => {
  const r = await report({ node: 'n1', job: 'plain' });
  assert.equal(r.status, 200);
});

test('invalid expected_every_seconds → 400 and nothing recorded', async () => {
  for (const bad of ['24h', 59, 86400.5, true]) {
    const r = await report({ node: 'n-bad', job: 'bad', expected_every_seconds: bad });
    assert.equal(r.status, 400, `value ${JSON.stringify(bad)}`);
    assert.equal(r.body.error, 'expected_every_seconds must be an integer from 60 to 2678400');
  }
  assert.equal(findJob((await getStatus()).body, 'n-bad', 'bad'), undefined);
});

test('null expected_every_seconds is treated as absent', async () => {
  const r = await report({ node: 'n1', job: 'nul', expected_every_seconds: null });
  assert.equal(r.status, 200);
});

test('a job reported long ago with a 60 s interval is overdue', async () => {
  await report({ node: 'n-old', job: 'stale', expected_every_seconds: 60 });
  const store = JSON.parse(readFileSync(STORE, 'utf8'));
  store['n-old'].stale[0].timestamp = new Date(Date.now() - 3600_000).toISOString();
  writeFileSync(STORE, JSON.stringify(store));
  const j = findJob((await getStatus()).body, 'n-old', 'stale');
  assert.equal(j.overdue, true);
  assert.ok(j.seconds_since_report >= 3600);
});

test('DELETE without a session → 401', async () => {
  const r = await request(app).delete('/api/cron/jobs/n1/num');
  assert.equal(r.status, 401);
});

test('DELETE existing job → 204, then 404', async () => {
  await report({ node: 'n-del', job: 'gone' });
  const url = '/api/cron/jobs/n-del/gone';
  const a = await request(app).delete(url).set('x-auth-token', token);
  assert.equal(a.status, 204);
  const b = await request(app).delete(url).set('x-auth-token', token);
  assert.equal(b.status, 404);
  assert.equal(findJob((await getStatus()).body, 'n-del', 'gone'), undefined);
});

test('DELETE handles names with spaces, / and :', async () => {
  const node = 'pi 2';
  const job = 'nightly backup/b:c';
  await report({ node, job });
  const url = `/api/cron/jobs/${encodeURIComponent(node)}/${encodeURIComponent(job)}`;
  const r = await request(app).delete(url).set('x-auth-token', token);
  assert.equal(r.status, 204);
  assert.equal(findJob((await getStatus()).body, node, job), undefined);
});

for (const name of ['__proto__', 'constructor', 'prototype']) {
  for (const field of ['node', 'job']) {
    test(`report rejects reserved ${field} name ${name}`, async () => {
      const body = { node: 'n1', job: 'backup', [field]: name };
      const res = await report(body);
      assert.equal(res.status, 400);
      assert.match(res.body.error, /reserved name/);
      assert.equal(({}).polluted, undefined);
      assert.equal((await getStatus()).status, 200);
    });
  }
}
