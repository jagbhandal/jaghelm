/*
 * The Jobs section's rows and words (#578), from the status model: every
 * state, word, reason and job fact is the server's own model's (the demo's
 * boards, the old Scheduled Jobs panel's fixture), never written here by hand.
 */
import { describe, it, expect } from 'vitest';
import { jobGroups, jobRows, jobsCount, lastRunAgo } from './jobsView.js';
import {
  cronEntryOf,
  lastReportAgo,
  overdueLine,
  runDuration,
  runsOf,
  spanWords,
} from './detail/jobRuns.js';
import { spanText } from '../../server/status/rules.js';
import { cronNode, cronRun, inputs, once } from '../../server/testing/statusFixtures.js';
import { demoBoard } from '../testing/statusFixtures.js';

const NOW = Date.parse('2026-10-20T09:00:00Z');
const HOUR = 3_600_000;

describe('the rows (#578)', () => {
  it('every job and backup the model has, by node then name, each as the model judges it', () => {
    const { status } = demoBoard({ scenario: 'incident', now: NOW });
    const rows = jobRows({ status, at: NOW });
    expect(rows.map((r) => [r.id, r.level, r.word])).toEqual([
      ['jobs/apps:db-dump', 'ok', 'OK'],
      ['jobs/apps:image-prune', 'ok', 'OK'],
      ['backups/storage:nightly-backup', 'crit', 'Failed'],
      ['jobs/storage:scrub-check', 'ok', 'OK'],
    ]);
    const [dump, , backup] = rows;
    // Well: the schedule in words; failing: the model's reason, never the schedule.
    expect(dump.detail).toBe('every 6 h');
    expect(dump.meta).toBe('1 h ago');
    expect(dump.node).toBe('apps');
    expect(backup.detail).toBe('Last backup failed: repository is locked by another process');
    expect(backup.meta).toBe('7 h ago');
    expect(rows.every((r) => r.muted)).toBe(true);
  });

  it('with a stale status, every row is no signal, its words kept; a hidden one is left out', () => {
    const { status } = demoBoard({ scenario: 'incident', now: NOW });
    const rows = jobRows({
      status,
      freshness: { stale: true },
      at: NOW,
      hidden: (e) => e.id === 'jobs/apps:db-dump',
    });
    expect(rows.map((r) => r.id)).not.toContain('jobs/apps:db-dump');
    expect(rows.every((r) => r.state === 'unknown')).toBe(true);
    expect(rows.find((r) => r.kind === 'backup').word).toBe('Failed');
  });

  it('groups jobs then backups, each counted by the model; a filter keeps its own', () => {
    const { status } = demoBoard({ scenario: 'incident', now: NOW });
    const rows = jobRows({ status, at: NOW });
    const all = jobGroups(rows, { status });
    expect(all.map((g) => [g.key, g.title, g.count, g.rows.length])).toEqual([
      ['jobs', 'Jobs', '3 / 3 OK', 3],
      ['backups', 'Backups', '0 / 1 OK', 1],
    ]);
    expect(jobGroups(rows, { status, filter: 'backups' }).map((g) => g.key)).toEqual(['backups']);
    expect(jobGroups(rows, { status, filter: 'jobs' }).map((g) => g.key)).toEqual(['jobs']);
    expect(jobGroups([], { status })).toEqual([]);
  });

  it('counts them, the failing ones by their words, worst first', () => {
    const status = once(
      inputs({
        cron: [
          cronNode('nas', { b2: cronRun('failure', HOUR, { error: 'locked' }) }),
          cronNode('pi-2', {
            sync: cronRun('success', 31 * HOUR, { expected_every_seconds: 86_400 }),
            vault: cronRun('success', HOUR),
          }),
        ],
        backupJobs: ['nas:b2'],
      })
    );
    const rows = jobRows({ status });
    expect(jobsCount(rows)).toBe('3 scheduled · 1 failed · 1 overdue');
    expect(jobsCount(rows.filter((r) => r.level === 'ok'))).toBe('1 scheduled · all OK');
    expect(jobsCount(rows, { stale: true, note: 'No signal · last known 3 min ago' })).toBe(
      '3 scheduled · No signal · last known 3 min ago'
    );
  });
});

describe('a job’s detail (#578)', () => {
  it('says a span as the model’s reasons do', () => {
    for (const s of [0, 59, 600, 3_600, 7_199, 7_200, 86_400, 111_600, 172_800, 604_800])
      expect(spanWords(s)).toBe(spanText(s));
  });

  const overdue = once(
    inputs({
      cron: [
        cronNode('vm-103', {
          'vm103-backup': cronRun('success', 31 * HOUR, { expected_every_seconds: 86_400 }),
        }),
      ],
    })
  ).entities.find((e) => e.id === 'jobs/vm-103:vm103-backup');

  it('the overdue line, by the model’s overdue flag and the status’s clock', () => {
    const at = overdue.lastRun + 31 * HOUR;
    expect(overdueLine(overdue, at)).toBe('Last report 31 h ago · expected every 24 h');
    expect(overdueLine({ ...overdue, everySeconds: undefined }, at)).toBe('Last report 31 h ago');
    expect(overdueLine({ ...overdue, overdue: false }, at)).toBeNull();
    expect(overdueLine(overdue, null)).toBeNull();
    // The detail's words, and a row's shorter ones.
    expect(lastReportAgo(overdue, at)).toBe('31 h ago');
    expect(lastReportAgo(overdue, overdue.lastRun + 45_000)).toBe('45 s ago');
    expect(lastReportAgo(overdue, overdue.lastRun + 12 * 60_000)).toBe('12 min ago');
    expect(lastRunAgo(overdue, at)).toBe('1 d ago');
    expect(lastRunAgo(overdue, overdue.lastRun + 12 * 60_000)).toBe('12 m ago');
  });

  it('its runs: when, how long, and a failed one’s error, in the state the model gives a failed run', () => {
    const body = [
      {
        node: 'nas',
        jobs: [
          {
            job: 'b2',
            runs: [
              {
                status: 'failure',
                timestamp: '2026-10-20T03:00:04Z',
                duration_seconds: 4,
                error: 'locked',
              },
              { status: 'success', timestamp: '2026-10-19T03:00:00Z', duration_seconds: 1380 },
              { status: 'success', timestamp: '2026-10-18T03:00:00Z' },
              { status: 'success', timestamp: '2026-10-17T03:00:00Z' },
            ],
          },
        ],
      },
    ];
    const entity = { id: 'backups/nas:b2', kind: 'backup', name: 'b2', node: 'nas' };
    const runs = runsOf(cronEntryOf(body, entity), entity);
    expect(runs).toHaveLength(3);
    expect(runs.map((r) => [r.state, r.word, r.duration, r.error])).toEqual([
      ['crit', 'Failed', '4 s', 'locked'],
      ['ok', 'Succeeded', '23 min', null],
      ['ok', 'Succeeded', null, null],
    ]);
    // In the browser's time zone, as the old panel said it: "Oct 20, 03:00".
    expect(runs[0].time).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}$/);
    // A job's failed run is a warning.
    expect(runsOf(cronEntryOf(body, entity), { ...entity, kind: 'job' })[0].state).toBe('warn');
    expect(cronEntryOf(body, { ...entity, node: 'pve' })).toBeNull();
    expect(runsOf(null, entity)).toEqual([]);
  });

  it('says how long a run took', () => {
    expect(runDuration(48)).toBe('48 s');
    expect(runDuration(1380)).toBe('23 min');
    expect(runDuration(2940)).toBe('49 min');
    expect(runDuration(125)).toBe('2 min 5 s');
    expect(runDuration(3900)).toBe('1 h 5 min');
    expect(runDuration(7200)).toBe('2 h');
    expect(runDuration(null)).toBeNull();
    expect(runDuration('x')).toBeNull();
  });
});
