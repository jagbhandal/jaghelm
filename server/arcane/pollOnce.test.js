import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runPollOnce } from './pollOnce.js';

const KEY = 'zz-recognisable-fake-key-9431'; // pragma: allowlist secret
const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const wrap = (data) => ({ success: true, data });

const cont = (name) => ({ names: [`/${name}`], image: 'i', autoUpdateEnabled: false,
  updateInfo: { hasUpdate: true, currentVersion: '1', latestVersion: '2' } });

/** Fake Arcane: envs [{id,name,status}], per-id containers, history behaviour. */
async function fake({ envs, containers = {}, historyFail = new Set() }) {
  const seen = [];
  const srv = http.createServer((q, r) => {
    seen.push(q.url);
    const send = (code, body) => { r.statusCode = code; r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(body)); };
    const m = q.url.match(/^\/api\/environments\/([^/]+)\/(containers|activities|updater\/history)/);
    if (q.url.startsWith('/api/environments?')) return send(200, wrap(envs));
    if (q.url.startsWith('/api/app-version')) return send(200, fx('app-version.json'));
    if (!m) return send(404, {});
    if (m[2] === 'containers') return send(200, wrap(containers[m[1]] || []));
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
    const cont2 = JSON.parse(readFileSync(join(out, 'containers-has-update.json'), 'utf8'));
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
    assert.equal(JSON.parse(readFileSync(join(out, 'containers-has-update.json'), 'utf8')).data[0].names[0], '/b');
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
