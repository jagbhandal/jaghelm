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

async function run(f, argv = [], extraEnv = {}) {
  const stdout = sink(), stderr = sink();
  const code = await runPollOnce({
    argv,
    env: { ARCANE_URL: f.url, ARCANE_API_KEY: KEY, ...extraEnv },
    stdout,
    stderr,
  });
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
    assert.equal(cont2.data[0].names[0], '/ctr-01'); // anonymized, slash kept as shape
    assert.equal(JSON.stringify(cont2).includes('gitea'), false);
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
    // vm-103 (first by key) has none, so the one row is vm-200's 'b', anonymized.
    const rows = JSON.parse(readFileSync(join(out, 'containers.json'), 'utf8')).data;
    assert.deepEqual(rows.map((c) => c.names[0]), ['/ctr-01']);
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
    // Ids are anonymized; the link fields and their shape stay (an empty link stays empty).
    assert.equal(jobs[0].metadata.trigger, 'scheduled');
    assert.match(jobs[0].metadata.domainActivityId, /^id-\d\d$/);
    assert.match(jobs[0].batchId, /^00000000-0000-4000-8000-\d{12}$/);
    assert.equal(jobs[1].metadata.domainActivityId, '');
    assert.equal(JSON.stringify(jobs).includes('0f3c1a2e'), false);
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

/** Fake Arcane for --vuln-digest: per env id, 'ok' (fixture results), 'denied' (403) or 'boom' (500). */
async function vulnFake(modes) {
  const seen = [];
  const srv = http.createServer((q, r) => {
    let raw = '';
    q.on('data', (c) => (raw += c));
    q.on('end', () => {
      seen.push(`${q.method} ${q.url}`);
      const send = (code, body) => {
        r.statusCode = code;
        r.setHeader('content-type', 'application/json');
        r.end(JSON.stringify(body));
      };
      if (q.url.startsWith('/api/environments?')) {
        return send(200, wrap(Object.keys(modes).map((id) => ({ id, name: `env-${id}`, status: 'online' }))));
      }
      const m = q.url.match(/^\/api\/environments\/([^/]+)\/(.+)$/);
      if (!m) return send(404, {});
      const [, id, rest] = m;
      if (rest.startsWith('containers')) return send(200, fx('containers.json'));
      if (modes[id] === 'denied') return send(403, { error: 'permission denied: vulnerabilities:read' });
      if (modes[id] === 'boom') return send(500, { error: `boom ${KEY}` });
      if (rest === 'images/vulnerabilities/summaries' && q.method === 'POST') {
        assert.ok(Array.isArray(JSON.parse(raw).imageIds));
        return send(200, fx('vulnerabilities-summaries.json'));
      }
      if (rest === 'vulnerabilities/overview') return send(200, fx('vulnerabilities-overview.json'));
      if (rest.startsWith('vulnerabilities/all?')) return send(200, fx('vulnerabilities-all.json'));
      return send(404, {});
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${srv.address().port}`, seen, close: () => srv.close() };
}

const ONLY_0 = { ARCANE_VULN_DIGEST_ENVS: 'env-0' };
const BOTH = { ARCANE_VULN_DIGEST_ENVS: 'env-0,env-2' };

test('--vuln-digest: baseline, then what would push, a preview; nothing sent, nothing kept', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'vulnonce-test-'));
  const prev = process.env.TMPDIR;
  process.env.TMPDIR = tmp;
  const f = await vulnFake({ 0: 'ok', 2: 'denied' });
  try {
    const { code, stdout, stderr } = await run(f, ['--vuln-digest'], ONLY_0);
    assert.equal(code, 0);
    const text = stdout.text;
    assert.match(text, /digest environments \(ARCANE_VULN_DIGEST_ENVS\): env-0/);
    assert.match(text, /--- vulnerability digest, pass 1 \(baseline\) ---/);
    assert.match(text, /--- vulnerability digest, pass 2 ---/);
    assert.match(text, /"outcome": "baseline"/);
    // Headroom against the cap: the critical/high fixable rows Arcane returned.
    assert.match(text, /"criticalHighFixable": 5,\s+"cap": 20000/);
    // Pass 2: the same results and the same scan problems as the baseline: nothing new.
    assert.equal(text.includes('would push'), false);
    assert.match(text, /"job": "arcane-vuln-digest"/);
    // env-2 is not listed: never read at all.
    assert.equal(f.seen.some((u) => u.includes('/environments/2/')), false);
    assert.match(text, /--- preview: env-0 if every current finding were new ---/);
    assert.match(text, /1 new critical, 4 new high \(fix available\) · 3 images · top: immich-server 1C 1H/);
    assert.match(text, /next scheduled digest: \d{4}-\d\d-\d\dT14:00:00\.000Z/);
    // Never any poller pass, never a scan, and the key is never printed.
    assert.equal(text.includes('--- pass 1'), false);
    assert.equal(f.seen.some((u) => /scan/.test(u)), false);
    assert.equal(text.includes(KEY) || stderr.text.includes(KEY), false);
    assert.deepEqual(readdirSync(tmp), []);
  } finally {
    f.close();
    if (prev === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = prev;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('--vuln-digest exits 1 when no environment could be read, or on a read error', async () => {
  for (const modes of [{ 0: 'denied', 2: 'denied' }, { 0: 'ok', 2: 'boom' }]) {
    const f = await vulnFake(modes);
    try {
      const { code, stdout, stderr } = await run(f, ['--vuln-digest'], BOTH);
      assert.equal(code, 1, JSON.stringify(modes));
      assert.match(stdout.text, /--- vulnerability digest, pass 2 ---/);
      assert.equal(stdout.text.includes(KEY) || stderr.text.includes(KEY), false);
    } finally {
      f.close();
    }
  }
});

test('--vuln-digest does not take --record', async () => {
  const stderr = sink();
  const code = await runPollOnce({
    argv: ['--vuln-digest', '--record', '/tmp/x'],
    env: { ARCANE_URL: 'http://127.0.0.1:9', ARCANE_API_KEY: KEY },
    stdout: sink(),
    stderr,
  });
  assert.equal(code, 2);
  assert.match(stderr.text, /--record does not apply to --vuln-digest/);
});

test('--vuln-digest: a listed environment without the grant is reported with what to grant', async () => {
  const f = await vulnFake({ 0: 'ok', 2: 'denied' });
  try {
    const { code, stdout } = await run(f, ['--vuln-digest'], BOTH);
    assert.equal(code, 0);
    assert.match(stdout.text, /"env": "env-2",\s+"outcome": "no-permission"/);
    assert.match(stdout.text, /lacks vulnerabilities:read \(a global grant in Arcane v2\.16\.1\)/);
  } finally {
    f.close();
  }
});

test('--vuln-digest with no ARCANE_VULN_DIGEST_ENVS says the digest is off and reads nothing', async () => {
  const f = await vulnFake({ 0: 'ok' });
  try {
    const { code, stderr } = await run(f, ['--vuln-digest']);
    assert.equal(code, 2);
    assert.match(stderr.text, /ARCANE_VULN_DIGEST_ENVS is empty/);
    assert.deepEqual(f.seen, []);
  } finally {
    f.close();
  }
});
