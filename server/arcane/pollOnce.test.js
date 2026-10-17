import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runPollOnce, main } from './pollOnce.js';

const KEY = 'zz-recognisable-fake-key-9431'; // pragma: allowlist secret
const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const wrap = (data) => ({ success: true, data });

const cont = (name) => ({ names: [`/${name}`], image: 'i', autoUpdateEnabled: false,
  updateInfo: { hasUpdate: true, currentVersion: '1', latestVersion: '2' } });

/** Fake Arcane: envs [{id,name,status}], per-id containers, history behaviour. */
async function fake({ envs, containers = {}, historyFail = new Set(), fail = [] }) {
  const seen = [];
  const srv = http.createServer((q, r) => {
    seen.push(q.url);
    const send = (code, body) => { r.statusCode = code; r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(body)); };
    if (fail.some((prefix) => q.url.startsWith(prefix))) return send(500, { error: `boom ${KEY}` });
    const m = q.url.match(/^\/api\/environments\/([^/]+)\/(containers|activities|updater\/history)/);
    if (q.url.startsWith('/api/environments?')) return send(200, wrap(envs));
    if (q.url.startsWith('/api/app-version')) return send(200, fx('app-version.json'));
    if (!m) return send(404, {});
    if (m[2] === 'containers') return send(200, wrap(containers[m[1]] || []));
    if (m[2] === 'activities' && q.url.includes('type=job_run')) {
      return send(200, wrap(m[1] === '2' ? fx('activities-job_run.json').data : []));
    }
    if (m[2] === 'updater/history') {
      if (historyFail.has(m[1])) return send(500, { error: `boom ${KEY}` });
      return send(200, wrap(m[1] === '2' ? fx('updater-history.json').data : []));
    }
    return send(200, wrap([]));
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${srv.address().port}`, seen, close: () => srv.close() };
}

function sink() { let s = ''; return { write: (x) => { s += x; }, get text() { return s; } }; }

async function run(f, argv = []) {
  const stdout = sink(), stderr = sink();
  const code = await runPollOnce({ argv, env: { ARCANE_URL: f.url, ARCANE_API_KEY: KEY }, stdout, stderr });
  return { code, stdout, stderr };
}

const ENVS = [
  { id: '0', name: 'vm-103', status: 'online' },
  { id: '2', name: 'vm-200', status: 'online' },
];

test('two passes print health and held-back, push nothing, remove the temp dir', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pollonce-test-'));
  const prev = process.env.TMPDIR;
  process.env.TMPDIR = tmp;
  const f = await fake({ envs: ENVS, containers: { 0: [cont('immich')] } });
  try {
    const { code, stdout } = await run(f);
    assert.equal(code, 0);
    assert.match(stdout.text, /--- pass 1 \(baseline\)/);
    assert.match(stdout.text, /--- pass 2/);
    assert.match(stdout.text, /"vm-103": "up"/);
    assert.match(stdout.text, /"name": "immich"/);
    assert.equal(stdout.text.includes('would push'), false);
    assert.deepEqual(readdirSync(tmp), []);
  } finally {
    f.close();
    if (prev === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = prev;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('--record writes history from the populated env, not the first empty one; key never printed', async () => {
  const out = mkdtempSync(join(tmpdir(), 'pollonce-rec-'));
  const f = await fake({ envs: ENVS, containers: { 2: [cont('gitea')] } });
  try {
    const { code, stdout, stderr } = await run(f, ['--record', out]);
    assert.equal(code, 0);
    const hist = JSON.parse(readFileSync(join(out, 'updater-history.json'), 'utf8'));
    assert.ok(hist.data.length > 0);
    const cont2 = JSON.parse(readFileSync(join(out, 'containers.json'), 'utf8'));
    assert.equal(cont2.data[0].names[0], '/gitea');
    assert.equal(stdout.text.includes(KEY) || stderr.text.includes(KEY), false);
  } finally {
    f.close();
    rmSync(out, { recursive: true, force: true });
  }
});

test('record picks by envKey order, not API order; empty everywhere falls back to first key', async () => {
  const out = mkdtempSync(join(tmpdir(), 'pollonce-rec-'));
  const f = await fake({ envs: [ENVS[1], ENVS[0]], containers: { 2: [cont('b')], 0: [] } });
  try {
    await run(f, ['--record', out]);
    assert.equal(JSON.parse(readFileSync(join(out, 'containers.json'), 'utf8')).data[0].names[0], '/b');
    assert.equal(existsSync(join(out, 'activities-auto_update.json')), true);
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'activities-auto_update.json'), 'utf8')).data, []);
  } finally {
    f.close();
    rmSync(out, { recursive: true, force: true });
  }
});

test('a 500 on one env history is reported without the key and does not abort', async () => {
  const out = mkdtempSync(join(tmpdir(), 'pollonce-rec-'));
  const f = await fake({ envs: ENVS, historyFail: new Set(['0']) });
  try {
    const { code, stdout, stderr } = await run(f, ['--record', out]);
    assert.equal(code, 0);
    assert.match(stderr.text, /updater-history not recorded for vm-103/);
    assert.equal(existsSync(join(out, 'updater-history.json')), true);
    assert.equal(stdout.text.includes(KEY) || stderr.text.includes(KEY), false);
  } finally {
    f.close();
    rmSync(out, { recursive: true, force: true });
  }
});

test('--record writes a job_run fixture with the link fields', async () => {
  const out = mkdtempSync(join(tmpdir(), 'pollonce-rec-'));
  const f = await fake({ envs: ENVS });
  try {
    const { code } = await run(f, ['--record', out]);
    assert.equal(code, 0);
    const jobs = JSON.parse(readFileSync(join(out, 'activities-job_run.json'), 'utf8')).data;
    assert.equal(jobs.length, 4);
    assert.deepEqual(jobs[0].metadata, { trigger: 'scheduled', domainActivityId: 'act-sp-2' });
    assert.equal(jobs[0].batchId, '0f3c1a2e-5b6d-4e7f-8a9b-0000000000a2');
    assert.ok(f.seen.some((u) => u.includes('type=job_run')));
  } finally {
    f.close();
    rmSync(out, { recursive: true, force: true });
  }
});

test('exit code 1 when a pass reported read errors; output is still printed', async () => {
  for (const fail of [['/api/environments/0/containers'], ['/api/environments?']]) {
    const f = await fake({ envs: ENVS, fail });
    try {
      const { code, stdout, stderr } = await run(f);
      assert.equal(code, 1, fail[0]);
      assert.match(stdout.text, /--- pass 2/);
      assert.match(stdout.text, /"errors": \[\n\s+"/);
      assert.equal(stdout.text.includes(KEY) || stderr.text.includes(KEY), false);
      assert.equal(/\n\s+at /.test(stderr.text), false, 'no stack trace');
    } finally {
      f.close();
    }
  }
});

test('the script entry turns a rejection into its message and exit code 2', async () => {
  const stderr = sink();
  const err = new Error('unexpected failure');
  const code = await main({ argv: [], stderr, run: async () => { throw err; } });
  assert.equal(code, 2);
  assert.equal(stderr.text, 'arcane-poll-once: unexpected failure\n');
  assert.equal(await main({ argv: [], stderr, run: async () => 0 }), 0);
});
