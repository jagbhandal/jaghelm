/**
 * Which cron jobs are backups (#291): `backupJobs` in display-config.json, a
 * list of "node:job" keys. Deterministic: a job is a backup only when the
 * config names it. Bad entries are dropped, and logged once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createBackupJobsReader, resolveBackupJobs } from './backupJobs.js';

function recorder() {
  const lines = [];
  const logger = {
    warn: (fields, msg) => lines.push({ fields, msg }),
    info() {},
    debug() {},
    error() {},
  };
  return { lines, logger };
}

test('backupJobs: no key, null or an empty list is no backups, and nothing to drop', () => {
  for (const raw of [undefined, null, []]) {
    assert.deepEqual(resolveBackupJobs(raw), { jobs: [], dropped: [] }, String(raw));
  }
});

test('backupJobs: "node:job" entries are kept, in order, once each', () => {
  assert.deepEqual(
    resolveBackupJobs(['pve:proxmox-backup', 'nas:nas-b2-backup', 'pve:proxmox-backup']),
    { jobs: ['pve:proxmox-backup', 'nas:nas-b2-backup'], dropped: [] }
  );
  // A job name may hold a colon: the node is what comes before the first one.
  assert.deepEqual(resolveBackupJobs(['nas:b2:photos']).jobs, ['nas:b2:photos']);
});

test('backupJobs: bad entries are dropped, the good ones kept', () => {
  const bad = [
    42,
    null,
    { node: 'pve', job: 'proxmox-backup' },
    ['pve', 'proxmox-backup'],
    'proxmox-backup', // no node
    ':proxmox-backup', // empty node
    'pve:', // empty job
    ' pve:proxmox-backup', // spaces around it
    'pve:proxmox-backup ',
    '',
    `pve:${'x'.repeat(600)}`, // longer than any job the cron route accepts
  ];
  assert.deepEqual(resolveBackupJobs(['pve:proxmox-backup', ...bad]), {
    jobs: ['pve:proxmox-backup'],
    dropped: bad,
  });
});

test('backupJobs: a value that is not a list is dropped whole', () => {
  for (const raw of ['pve:proxmox-backup', { 'pve:proxmox-backup': true }, 1, true]) {
    assert.deepEqual(resolveBackupJobs(raw), { jobs: [], dropped: [raw] }, JSON.stringify(raw));
  }
});

test('backupJobs: bad entries are logged once, not every cycle; a new mistake logs again', () => {
  const { lines, logger } = recorder();
  const read = createBackupJobsReader({ logger });
  const config = { backupJobs: ['pve:proxmox-backup', 'vm103-backup', 7] };

  for (let cycle = 0; cycle < 5; cycle++) {
    assert.deepEqual(read(config), ['pve:proxmox-backup']);
  }
  assert.equal(lines.length, 1, 'one line for five cycles');
  assert.match(lines[0].msg, /backupJobs/);
  assert.match(lines[0].msg, /node:job/);
  assert.deepEqual(lines[0].fields.dropped, ['"vm103-backup"', '7']);

  // The same mistakes in a re-read file: nothing new to say.
  read({ backupJobs: ['vm103-backup', 7, 'pve:proxmox-backup'] });
  assert.equal(lines.length, 1);
  // A different mistake logs again.
  read({ backupJobs: ['pve proxmox-backup'] });
  assert.equal(lines.length, 2);
  // Fixed, then broken again the same way: it logs again.
  assert.deepEqual(read({ backupJobs: ['pve:proxmox-backup'] }), ['pve:proxmox-backup']);
  read({ backupJobs: ['pve proxmox-backup'] });
  assert.equal(lines.length, 3);
});

test('backupJobs: no config, or no key, reads as none and logs nothing', () => {
  const { lines, logger } = recorder();
  const read = createBackupJobsReader({ logger });
  assert.deepEqual(read(null), []);
  assert.deepEqual(read({}), []);
  assert.deepEqual(read({ backupJobs: null }), []);
  assert.equal(lines.length, 0);
});

test('backupJobs: a long list of bad entries logs a bounded line', () => {
  const { lines, logger } = recorder();
  const read = createBackupJobsReader({ logger });
  read({ backupJobs: Array.from({ length: 50 }, (_, i) => `bad-${i}-${'y'.repeat(300)}`) });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].fields.count, 50);
  assert.equal(lines[0].fields.dropped.length, 10, 'the first 10');
  for (const d of lines[0].fields.dropped) assert.ok(d.length <= 100, 'each cut to 100 characters');
});
