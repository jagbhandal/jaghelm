/**
 * Backups end to end (#291): a cron job named in display-config.json's
 * `backupJobs` is a backup. It reaches the status model through the display
 * config the loop already reads each cycle (refresh.js updateStatus), is judged
 * by the backup rule (spec §6.1: failed last run → crit, overdue → warn) in the
 * Backups subsystem, and /api/status serves it. Every step is the real one: the
 * config saved through POST /api/display-config, the runs reported through
 * POST /api/cron/report as the PVE webhook and the backup scripts send them,
 * the loop's status step, and GET /api/status.
 *
 * Auth and the data dir are frozen at module load, so both are set before
 * importing the app (as routes/status.test.js does).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-backups-'));
process.env.JAGHELM_DATA_DIR = dataDir;
process.env.DASH_PASS = 'test-pass-1234';
process.env.JAGHELM_CRON_SECRET = 'cron-test-secret'; // pragma: allowlist secret
process.env.LOG_LEVEL = 'info'; // the log-once test reads the warn line
// The interval the config saves keep, so a save doesn't restart the loop.
writeFileSync(join(dataDir, 'display-config.json'), JSON.stringify({ refreshInterval: 30 }));

const { app } = await import('./index.js');
const { stopBackgroundRefresh, updateStatus } = await import('./refresh.js');
const { createSession } = await import('./auth/sessions.js');

const token = createSession('admin');
const DAY_MS = 86_400_000;

after(() => {
  stopBackgroundRefresh();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DASH_PASS;
  delete process.env.JAGHELM_CRON_SECRET;
});

/**
 * Saves the display config as Settings (and Jag's curl) does: the whole
 * object, over the version a read answered (If-Match, #547).
 */
async function saveConfig(extra) {
  const read = await request(app).get('/api/display-config').set('x-auth-token', token);
  const r = await request(app)
    .post('/api/display-config')
    .set('x-auth-token', token)
    .set('If-Match', read.headers.etag)
    .send({ refreshInterval: 30, ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.body));
}

/** One run, as a reporter sends it. */
async function report(body) {
  const r = await request(app)
    .post('/api/cron/report')
    .send({ secret: 'cron-test-secret', expected_every_seconds: 86400, ...body }); // pragma: allowlist secret
  assert.equal(r.status, 200, JSON.stringify(r.body));
}

/** The loop's status step at `now`, then what /api/status serves. */
async function cycle(now = Date.now()) {
  assert.ok(updateStatus([], now), 'the model built');
  const r = await request(app).get('/api/status').set('x-auth-token', token);
  assert.equal(r.status, 200);
  return r.body;
}

const entity = (status, id) => status.entities.find((e) => e.id === id);
const subsystem = (status, id) => status.subsystems.find((s) => s.id === id);

test('backups: a failed vzdump, marked as a backup, is crit in Backups, end to end (config → loop → /api/status)', async () => {
  await saveConfig({ backupJobs: ['pve:proxmox-backup', 'nas:nas-b2-backup'] });
  // The PVE webhook's failure body (jaghelm-backup-failed), a NAS backup that
  // worked, and a job nobody marked.
  await report({
    job: 'proxmox-backup',
    node: 'pve',
    status: 'failure',
    error: 'vzdump backup status for VM 103: error',
  });
  await report({ job: 'nas-b2-backup', node: 'nas', status: 'success' });
  await report({ job: 'image-prune', node: 'docker-brain', status: 'failure', error: 'exit 1' });

  const status = await cycle();
  const vzdump = entity(status, 'backups/pve:proxmox-backup');
  assert.deepEqual(
    [vzdump.kind, vzdump.subsystem, vzdump.state, vzdump.word, vzdump.reason],
    ['backup', 'backups', 'crit', 'Failed', 'Last backup failed: vzdump backup status for VM 103: error']
  );
  assert.equal(entity(status, 'jobs/pve:proxmox-backup'), undefined, 'not a job as well');
  assert.equal(entity(status, 'backups/nas:nas-b2-backup').state, 'ok');
  // A job no one marked keeps the job rule: a failed run is a warning.
  assert.deepEqual(
    [entity(status, 'jobs/docker-brain:image-prune').subsystem, entity(status, 'jobs/docker-brain:image-prune').state],
    ['jobs', 'warn']
  );
  assert.deepEqual(subsystem(status, 'backups'), {
    id: 'backups',
    name: 'Backups',
    state: 'crit',
    counts: { total: 2, ok: 1, warn: 0, crit: 1, unknown: 0, maintenance: 0 },
    detail: '1 / 2 OK',
    value: '1 / 2',
    sub: '1 failed',
  });
  assert.equal(subsystem(status, 'jobs').state, 'warn');
  assert.deepEqual(status.overall, { state: 'crit', sentence: '1 backup failed · 1 job failed' });
  assert.equal(status.issues[0].id, 'backups/pve:proxmox-backup', 'crit ranks first');
});

test('backups: a backup that stops reporting goes overdue: warn in Backups', async () => {
  await report({ job: 'proxmox-backup', node: 'pve', status: 'success' });
  await report({ job: 'nas-b2-backup', node: 'nas', status: 'success' });
  await report({ job: 'image-prune', node: 'docker-brain', status: 'success' });
  const fresh = await cycle();
  assert.equal(entity(fresh, 'backups/pve:proxmox-backup').state, 'ok');
  assert.equal(entity(fresh, 'backups/pve:proxmox-backup').reason, 'Last backup succeeded');
  assert.equal(subsystem(fresh, 'backups').state, 'ok');

  // Two days with no report: past 24 h plus its grace.
  const late = await cycle(Date.now() + 2 * DAY_MS);
  const vzdump = entity(late, 'backups/pve:proxmox-backup');
  assert.deepEqual([vzdump.state, vzdump.word], ['warn', 'Overdue']);
  assert.match(vzdump.reason, /^Overdue: no report on schedule/);
  assert.equal(subsystem(late, 'backups').state, 'warn');
  assert.match(late.overall.sentence, /2 backups overdue/);
});

test('backups: the list is read every cycle: a job taken off it is a job again, with no restart', async () => {
  await report({ job: 'proxmox-backup', node: 'pve', status: 'failure', error: 'exit 2' });
  assert.equal(entity(await cycle(), 'backups/pve:proxmox-backup').state, 'crit');

  await saveConfig({ backupJobs: ['nas:nas-b2-backup'] });
  const status = await cycle();
  assert.equal(entity(status, 'backups/pve:proxmox-backup'), undefined);
  assert.deepEqual(
    [entity(status, 'jobs/pve:proxmox-backup').state, entity(status, 'jobs/pve:proxmox-backup').reason],
    ['warn', 'Last run failed: exit 2']
  );

  // No backupJobs at all: every job is a job, and Backups is empty.
  await saveConfig({});
  const none = await cycle();
  assert.deepEqual(subsystem(none, 'backups').counts.total, 0);
  assert.equal(subsystem(none, 'backups').detail, 'None');
});

test('backups: bad backupJobs entries are dropped and logged once, not every cycle', async (t) => {
  const lines = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  t.mock.method(process.stderr, 'write', (chunk, ...rest) => {
    if (String(chunk).includes('backupJobs')) lines.push(String(chunk));
    else return realWrite(chunk, ...rest);
    return true;
  });
  // vm103-backup without its node, and the vzdump as an object.
  const saved = ['nas:nas-b2-backup', 'vm103-backup', { node: 'pve', job: 'proxmox-backup' }];
  await saveConfig({ backupJobs: saved });
  // The save keeps the list as written (a web save sends back what it read, so
  // refusing it would block every settings save); the loop drops what it can't use.
  const read = await request(app).get('/api/display-config').set('x-auth-token', token);
  assert.deepEqual(read.body.backupJobs, saved);
  for (let i = 0; i < 3; i++) {
    const status = await cycle();
    assert.equal(entity(status, 'backups/nas:nas-b2-backup').subsystem, 'backups', 'the good entry counts');
    assert.equal(entity(status, 'jobs/pve:proxmox-backup').subsystem, 'jobs', 'a dropped one stays a job');
  }
  assert.equal(lines.length, 1, 'one warning for three cycles');
  assert.match(lines[0], /vm103-backup/);
  assert.match(lines[0], /"level":"warn"/);
  t.mock.restoreAll();
});
