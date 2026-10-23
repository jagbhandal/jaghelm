/**
 * What a job's and a backup's entity says beside its verdict (#578): its
 * schedule in words, the interval it is expected at, when it last reported,
 * and whether it is overdue, so the Overview's Jobs section and the
 * phone's list draw every job from the status alone, with no read of
 * /api/cron/status (spec §6.3: that endpoint goes in Phase 4).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NOW, cronNode, cronRun, entityOf, inputs, once } from '../testing/statusFixtures.js';

const HOUR = 3_600_000;

test('a job carries its schedule, its interval, when it last reported and that it is on time', () => {
  const run = cronRun('success', HOUR, { schedule: 'daily 3am', expected_every_seconds: 86_400 });
  const s = once(inputs({ cron: [cronNode('vm103', { backup: run })] }));
  const job = entityOf(s, 'jobs/vm103:backup');
  assert.equal(job.schedule, 'daily 3am');
  assert.equal(job.everySeconds, 86_400);
  assert.equal(job.lastRun, NOW - HOUR);
  assert.equal(job.overdue, false);
});

test('a schedule in words: a cron expression put in words, else the interval', () => {
  const s = once(
    inputs({
      cron: [
        cronNode('vm103', {
          prune: cronRun('success', HOUR, { schedule: '30 6 * * *' }),
          vzdump: cronRun('success', HOUR, { expected_every_seconds: 86_400 }),
        }),
      ],
    })
  );
  assert.equal(entityOf(s, 'jobs/vm103:prune').schedule, 'daily at 06:30');
  assert.equal(entityOf(s, 'jobs/vm103:vzdump').schedule, 'every 24 h');
});

test('an overdue job says so by the same rule as /api/cron/status, and a backup too', () => {
  const late = cronRun('success', 31 * HOUR, { expected_every_seconds: 86_400 });
  const failedLate = cronRun('failure', 31 * HOUR, {
    expected_every_seconds: 86_400,
    error: 'locked',
  });
  const s = once(
    inputs({
      cron: [cronNode('nas', { b2: failedLate }), cronNode('pi-2', { sync: late })],
      backupJobs: ['nas:b2'],
    })
  );
  assert.equal(entityOf(s, 'jobs/pi-2:sync').overdue, true);
  // A failed backup's word is Failed; it is still overdue.
  const backup = entityOf(s, 'backups/nas:b2');
  assert.equal(backup.word, 'Failed');
  assert.equal(backup.overdue, true);
  assert.equal(backup.lastRun, NOW - 31 * HOUR);
});

test('a run without a schedule, an interval or a readable time leaves those out', () => {
  const s = once(
    inputs({
      cron: [
        cronNode('pve', {
          bare: { status: 'success', timestamp: 'not a time' },
          blank: cronRun('success', HOUR, { schedule: '   ', expected_every_seconds: 'daily' }),
          none: null,
        }),
      ],
    })
  );
  const bare = entityOf(s, 'jobs/pve:bare');
  assert.equal('schedule' in bare, false);
  assert.equal('everySeconds' in bare, false);
  assert.equal('lastRun' in bare, false);
  assert.equal(bare.overdue, false);
  const blank = entityOf(s, 'jobs/pve:blank');
  assert.equal('schedule' in blank, false);
  assert.equal('everySeconds' in blank, false);
  assert.equal(blank.lastRun, NOW - HOUR);
  // A job with no run at all (its runs list empty): no signal, and none of them.
  const none = entityOf(s, 'jobs/pve:none');
  assert.equal(none.state, 'unknown');
  assert.equal('lastRun' in none, false);
  assert.equal(none.overdue, false);
});

test('a steady board keeps its job facts from cycle to cycle', () => {
  const run = cronRun('success', HOUR, { schedule: 'every 15 min' });
  const cycle = inputs({ cron: [cronNode('pi-2', { sync: run })] });
  const a = once(cycle);
  const b = once(cycle, { start: NOW + 30_000 });
  assert.deepEqual(entityOf(b, 'jobs/pi-2:sync'), entityOf(a, 'jobs/pi-2:sync'));
});
