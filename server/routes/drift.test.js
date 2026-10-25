/**
 * Config drift reports (#674): POST /api/drift/report (secret, strict schema,
 * limits, per-host latest, persistence) and GET /api/drift (session auth, off
 * without the secret). Auth is frozen at module load, so the env is set first.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-drift-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.DASH_PASS = 'test-pass-1234';
process.env.JAGHELM_CRON_SECRET = 'cron-s3cret';
process.env.PROMETHEUS_URL = 'http://127.0.0.1:1';
process.env.KUMA_URL = 'http://127.0.0.1:1';

const { app } = await import('../index.js');
const { stopBackgroundRefresh } = await import('../refresh.js');
const { createSession } = await import('../auth/sessions.js');
const { DRIFT_LIMITS, validateReport, cleanText, staleHours } = await import('../driftReports.js');

const token = createSession('admin');
const STORE = join(dataDir, 'drift-reports.json');
after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DASH_PASS;
});

const now = () => new Date().toISOString();
const good = (extra = {}) => ({
  secret: 'cron-s3cret', // pragma: allowlist secret
  host: 'pi-1',
  checkedAt: now(),
  status: 'drift',
  items: [{ name: '/opt/stacks/x/compose.yaml', kind: 'DIFF', detail: 'x' }],
  ...extra,
});
const push = (body) => request(app).post('/api/drift/report').send(body);
const read = () => request(app).get('/api/drift').set('x-auth-token', token);

test('a good report is stored and read back with the server time', async () => {
  const r = await push(good());
  assert.equal(r.status, 200);
  const body = (await read()).body;
  assert.equal(body.configured, true);
  assert.ok(Number.isFinite(Date.parse(body.now)));
  assert.equal(body.reports.length, 1);
  assert.equal(body.reports[0].host, 'pi-1');
  assert.equal(body.reports[0].status, 'drift');
  assert.ok(Date.parse(body.reports[0].receivedAt) <= Date.parse(body.now));
});

test('persistence: it is in the file, and a second report replaces the first (latest per host)', async () => {
  await push(good({ host: 'pi-2', status: 'ok', items: [] }));
  await push(good({ host: 'pi-2', status: 'error', items: [{ name: 'a', kind: 'UNREAD' }] }));
  const file = JSON.parse(readFileSync(STORE, 'utf8'));
  assert.deepEqual(Object.keys(file).sort(), ['pi-1', 'pi-2']);
  assert.equal(file['pi-2'].status, 'error');
  assert.equal(file['pi-2'].items.length, 1);
  const hosts = (await read()).body.reports.map((r) => r.host);
  assert.deepEqual(hosts, ['pi-1', 'pi-2']);
});

test('no secret, a wrong secret, or a secret of another type: 401, nothing stored', async () => {
  for (const secret of [undefined, 'nope', '', 5, ['cron-s3cret']]) {
    const r = await push(good({ secret, host: 'intruder' }));
    assert.equal(r.status, 401);
  }
  assert.ok(!('intruder' in JSON.parse(readFileSync(STORE, 'utf8'))));
});

test('GET needs a session', async () => {
  assert.equal((await request(app).get('/api/drift')).status, 401);
});

test('strict schema: unknown fields, bad status, bad times and shapes are 400', async () => {
  const cases = [
    { extra: 1 },
    { status: 'fine' },
    { status: undefined },
    { host: '' },
    { host: 'a b' },
    { host: '__proto__' },
    { host: 5 },
    { checkedAt: 'yesterday' },
    { checkedAt: '2026-10-24' },
    { items: 'x' },
    { items: undefined },
    { items: ['x'] },
    { items: [{ name: 'a', kind: 'DIFF', extra: 1 }] },
    { items: [{ name: '', kind: 'DIFF' }] },
    { items: [{ name: 'a', kind: ' ' }] },
    { items: [{ name: 'a', kind: 'DIFF', detail: 5 }] },
  ];
  for (const c of cases) {
    const r = await push(good(c));
    assert.equal(r.status, 400, JSON.stringify(c).slice(0, 80));
  }
});

test('strings are sanitised: control characters and newlines never reach the store', async () => {
  await push(good({ host: 'pi-1', items: [{ name: 'a\nb\u001b[31m', kind: 'DIFF\t', detail: ' two   spaces\r\n ' }] }));
  const item = (await read()).body.reports.find((r) => r.host === 'pi-1').items[0];
  assert.equal(item.name, 'a b [31m');
  assert.equal(item.kind, 'DIFF');
  assert.equal(item.detail, 'two spaces');
});

test('a checkedAt in the future is clamped to the receipt time', async () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal((await push(good({ host: 'clock', status: 'ok', items: [], checkedAt: future }))).status, 200);
  const r = (await read()).body.reports.find((x) => x.host === 'clock');
  assert.ok(Date.parse(r.checkedAt) <= Date.parse(r.receivedAt) + 1000);
});

test('a report checked earlier than the stored one is ignored with stale:true', async () => {
  const t1 = new Date(Date.now() - 3_600_000).toISOString();
  const t0 = new Date(Date.now() - 7_200_000).toISOString();
  assert.deepEqual((await push(good({ host: 'order', status: 'drift', checkedAt: t1 }))).body, { ok: true });
  const late = await push(good({ host: 'order', status: 'ok', items: [], checkedAt: t0 }));
  assert.deepEqual(late.body, { ok: true, stale: true });
  const kept = (await read()).body.reports.find((x) => x.host === 'order');
  assert.equal(kept.status, 'drift');
  assert.equal(kept.checkedAt, t1);
});

test('a host whose last report is over 30 days old is pruned on read and on write', async () => {
  const old = new Date(Date.now() - 31 * 86_400_000).toISOString();
  const fresh = new Date(Date.now() - 29 * 86_400_000).toISOString();
  const file = JSON.parse(readFileSync(STORE, 'utf8'));
  file.gone = { checkedAt: old, receivedAt: old, status: 'ok', items: [] };
  file.edge = { checkedAt: fresh, receivedAt: fresh, status: 'ok', items: [] };
  writeFileSync(STORE, JSON.stringify(file));
  const hosts = (await read()).body.reports.map((r) => r.host);
  assert.ok(!hosts.includes('gone'));
  assert.ok(hosts.includes('edge'));
  assert.ok('gone' in JSON.parse(readFileSync(STORE, 'utf8'))); // reading writes nothing
  await push(good({ host: 'pi-1', status: 'ok', items: [] }));
  assert.ok(!('gone' in JSON.parse(readFileSync(STORE, 'utf8'))));
  assert.ok('edge' in JSON.parse(readFileSync(STORE, 'utf8')));
});

test('the pure pieces: validateReport defaults and cleanText and staleHours', () => {
  const v = validateReport({ host: 'a', checkedAt: '2026-10-24T06:00:00+00:00', status: 'ok', items: [] });
  assert.equal(v.ok, true);
  assert.equal(v.report.checkedAt, '2026-10-24T06:00:00.000Z');
  assert.equal(validateReport(null).ok, false);
  assert.equal(cleanText(' x\u007f'), 'x');
  assert.equal(cleanText('a\u202eb\u200bc\u2066d\ufeffe'), 'abcde');
  assert.equal(staleHours(undefined), 36);
  assert.equal(staleHours(0), 36);
  assert.equal(staleHours(721), 36);
  assert.equal(staleHours(1.5), 36);
  assert.equal(staleHours('48'), 36);
  assert.equal(staleHours(48), 48);
});

test('limits: too many items, long strings and too many hosts are 413; a body over 64 KB too', async () => {
  const item = { name: 'a', kind: 'DIFF' };
  assert.equal((await push(good({ items: Array(DRIFT_LIMITS.items + 1).fill(item) }))).status, 413);
  assert.equal((await push(good({ items: Array(DRIFT_LIMITS.items).fill(item) }))).status, 200);
  assert.equal((await push(good({ items: [{ ...item, name: 'n'.repeat(DRIFT_LIMITS.name + 1) }] }))).status, 413);
  assert.equal((await push(good({ items: [{ ...item, kind: 'k'.repeat(DRIFT_LIMITS.kind + 1) }] }))).status, 413);
  assert.equal((await push(good({ items: [{ ...item, detail: 'd'.repeat(DRIFT_LIMITS.detail + 1) }] }))).status, 413);
  assert.equal((await push(good({ host: 'h'.repeat(DRIFT_LIMITS.host + 1) }))).status, 413);
  // 200 items of the longest legal size is over 64 KB.
  const big = { name: 'n'.repeat(256), kind: 'k', detail: 'd'.repeat(500) };
  assert.equal((await push(good({ items: Array(DRIFT_LIMITS.items).fill(big) }))).status, 413);
  // Hosts: pi-1, pi-2 and "pi-1" again are known; new ones fill up to the cap, then 413.
  for (let i = 0; i < DRIFT_LIMITS.hosts; i++) {
    const r = await push(good({ host: `h${i}`, status: 'ok', items: [] }));
    if (r.status === 413) break;
    assert.equal(r.status, 200);
  }
  assert.equal((await push(good({ host: 'one-too-many', status: 'ok', items: [] }))).status, 413);
  assert.equal((await push(good({ host: 'pi-1', status: 'ok', items: [] }))).status, 200);
  const hosts = (await read()).body.reports;
  assert.equal(hosts.length, DRIFT_LIMITS.hosts);
});
