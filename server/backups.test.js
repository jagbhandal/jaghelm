/**
 * GET /api/backups (#675): the marked backup jobs from the cron store (last
 * good run among the kept runs, never-seen as seen:false, a failure's words),
 * a host known to be up, and the B2 part passed through.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

const { backupsAnswer } = await import('./backups.js');
const { infrastructureRoutes } = await import('./routes/infrastructure.js');

const iso = (ms) => new Date(ms).toISOString();
const T = Date.parse('2026-10-24T12:00:00Z');
const H = 3_600_000;
const run = (status, ago, extra = {}) => ({ status, timestamp: iso(T - ago * H), ...extra });
const statuses = [
  {
    node: 'pve',
    jobs: [{ job: 'proxmox-backup', runs: [run('success', 7), run('success', 31)] }],
  },
  {
    node: 'nas',
    jobs: [
      {
        job: 'nas-b2-backup',
        runs: [run('failure', 2, { error: 'FamilyVault: sentinel missing\n\tnot synced' }), run('success', 26), run('failure', 50)],
      },
    ],
  },
  { node: 'docker-brain', jobs: [{ job: 'vm103-backup', runs: [run('failure', 5), run('failure', 29), run('failure', 53)] }] },
  { node: 'jagnet-pi-failover', jobs: [{ job: 'npm-sync', runs: [run('success', 1)] }] },
];
const config = { backupJobs: ['pve:proxmox-backup', 'nas:nas-b2-backup', 'docker-brain:vm103-backup', 'nas:never-ran', 'bad entry'] };
const services = { nodes: { pve: { reachable: true }, NAS: { reachable: false }, 'docker-brain': { reachable: true } } };
const b2 = { configured: false };

test('one row per marked job, by node then name; a job that is not marked is not here', () => {
  const { jobs } = backupsAnswer({ statuses, config, services, b2 });
  assert.deepEqual(
    jobs.map((j) => j.key),
    ['docker-brain:vm103-backup', 'nas:nas-b2-backup', 'nas:never-ran', 'pve:proxmox-backup']
  );
});

test('last good run is the newest success among the kept runs; a failure carries its words, cleaned and cut', () => {
  const by = Object.fromEntries(backupsAnswer({ statuses, config, services, b2 }).jobs.map((j) => [j.job, j]));
  assert.equal(by['proxmox-backup'].lastGood, T - 7 * H);
  assert.deepEqual(by['proxmox-backup'].last, { at: T - 7 * H, status: 'success' });
  assert.equal(by['nas-b2-backup'].lastGood, T - 26 * H, 'the success behind the newest failure');
  assert.equal(by['nas-b2-backup'].last.status, 'failure');
  assert.equal(by['nas-b2-backup'].last.error, 'FamilyVault: sentinel missing not synced');
  assert.equal(by['nas-b2-backup'].failedRuns, 2);
  assert.equal(by['vm103-backup'].lastGood, null, 'three failures: no good run known');
  assert.equal(by['vm103-backup'].failedRuns, 3);
  const long = backupsAnswer({
    statuses: [{ node: 'pve', jobs: [{ job: 'proxmox-backup', runs: [run('failure', 1, { error: 'x'.repeat(900) })] }] }],
    config: { backupJobs: ['pve:proxmox-backup'] },
    services,
    b2,
  }).jobs[0];
  assert.ok(long.last.error.length <= 160);
});

test('a marked job nothing has reported is seen:false with no times, never a success', () => {
  const j = backupsAnswer({ statuses, config, services, b2 }).jobs.find((x) => x.job === 'never-ran');
  assert.deepEqual([j.seen, j.last, j.lastGood, j.runs], [false, null, null, 0]);
});

test('hostUp is true only for a node the board has, reachable, matched without regard to case', () => {
  const by = Object.fromEntries(backupsAnswer({ statuses, config, services, b2 }).jobs.map((j) => [j.job, j.hostUp]));
  assert.deepEqual(by, { 'vm103-backup': true, 'nas-b2-backup': false, 'never-ran': false, 'proxmox-backup': true });
  const none = backupsAnswer({ statuses, config, services: null, b2 }).jobs;
  assert.ok(none.every((j) => j.hostUp === false), 'no board read: no host is known up');
});

test('no backupJobs, no jobs; a store entry that is not a run list does not throw', () => {
  assert.deepEqual(backupsAnswer({ statuses, config: {}, services, b2 }).jobs, []);
  assert.deepEqual(backupsAnswer({ statuses, config: null, services, b2 }).jobs, []);
  const odd = backupsAnswer({
    statuses: [{ node: 'pve', jobs: [{ job: 'proxmox-backup', runs: [{ status: 'success', timestamp: 'garbage' }] }] }],
    config: { backupJobs: ['pve:proxmox-backup'] },
    services,
    b2,
  });
  assert.equal(odd.jobs[0].seen, false);
});

test('the B2 part is passed through as it is', () => {
  const part = { configured: true, bucket: 'b', pending: true };
  assert.equal(backupsAnswer({ statuses, config, services, b2: part }).b2, part);
});

test('the route answers with an ETag and a 304 for the same answer', async () => {
  const app = express();
  app.use('/api', infrastructureRoutes);
  const first = await request(app).get('/api/backups');
  assert.equal(first.status, 200);
  assert.ok(Array.isArray(first.body.jobs));
  assert.deepEqual(first.body.b2, { configured: false });
  const again = await request(app).get('/api/backups').set('If-None-Match', first.headers.etag);
  assert.equal(again.status, 304);
});
