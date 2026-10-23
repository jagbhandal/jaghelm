/*
 * Nothing the old board's Scheduled Jobs panel shows is lost (#578, #306's
 * parity table): for every job the old panel lists from a cron store, the
 * Jobs section has its row (its name and node, its schedule) and the job's
 * detail its overdue line and each of its last runs (when, how long, its
 * error). The stores are the old panel's own test fixture and the demo's
 * (incident: a backup whose last run failed), each through the live model
 * as /api/status serves it and through /api/cron/status as the old panel
 * and the detail read it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, within } from '@testing-library/react';
import { CronJobs } from '../components/Widgets.jsx';
import { ConfigProvider } from '../context/ConfigContext.jsx';
import { JobsSection } from '@ui/jobs-section';
import { EntityDetail } from './detail/EntityDetail.jsx';
import { entityDetail } from './detail/entityDetail.js';
import { jobGroups, jobRows } from './jobsView.js';
import { runDuration } from './detail/jobRuns.js';
import { entityAnchor } from './entityAnchors.js';
import { decorateStatuses } from '../../server/cron-overdue.js';
import { demoCronStore } from '../../server/demoFixtures.js';
import { inputs, once } from '../../server/testing/statusFixtures.js';
import { scheduleWords } from '../../server/status/schedule.js';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const at = (msAgo) => new Date(NOW - msAgo).toISOString();
const HOUR = 3_600_000;

// The old panel's test fixture (src/components/CronJobs.test.jsx), as the
// store kept it: vm103-backup reported 31 h ago, expected every 24 h.
const OLD_PANEL_STORE = [
  {
    node: 'vm-103',
    jobs: [
      {
        job: 'vm103-backup',
        runs: [{ status: 'success', timestamp: at(31 * HOUR), expected_every_seconds: 86_400 }],
      },
      { job: 'healthy', runs: [{ status: 'success', timestamp: at(600_000) }] },
    ],
  },
];

const FIXTURES = [
  ['the old panel’s fixture', OLD_PANEL_STORE, []],
  [
    'the demo’s incident',
    demoCronStore({ scenario: 'incident', now: NOW }),
    ['storage:nightly-backup'],
  ],
];

// A run's time, either panel's way ("Oct 15, 01:00 AM", "Oct 15, 01:00",
// "15 Oct, 13:00"), as the minute it names: "Oct 15 01:00", every one in `text`.
const TIME =
  /(?:([A-Z][a-z]{2}) (\d{1,2})|(\d{1,2}) ([A-Z][a-z]{2})),? (\d{1,2}):(\d{2})(?:\s?([AP]M))?/g;
function minutesOf(text) {
  return [...String(text).matchAll(TIME)].map((m) => {
    let hour = Number(m[5]) % (m[7] ? 12 : 24);
    if (m[7] === 'PM') hour += 12;
    return `${m[1] ?? m[4]} ${m[2] ?? m[3]} ${String(hour).padStart(2, '0')}:${m[6]}`;
  });
}

// A duration, either panel's way ("23m 0s", "48s"; "23 min", "48 s", "2 min 5 s"), in seconds.
function secondsOf(text) {
  if (text == null) return null;
  const unit = { h: 3600, min: 60, m: 60, s: 1 };
  const parts = [...String(text).matchAll(/(\d+) ?(h|min|m|s)\b/g)];
  return parts.length ? parts.reduce((sum, [, n, u]) => sum + Number(n) * unit[u], 0) : null;
}

// The old panel's duration for `run`, by its own words, or null without one.
function oldDurationIn(box, run) {
  if (run.duration_seconds == null) return null;
  const s = run.duration_seconds;
  const said = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  expect(box).toHaveTextContent(said);
  return said;
}

// An age as the old panel wrote it ("31h") and the new words ("31 h").
const spaced = (text) => text.replace(/(\d)([mhd])\b/g, '$1 $2').replace(/(\d) m\b/g, '$1 min');

describe('every job the old Scheduled Jobs panel lists, with the same facts (#578)', () => {
  for (const [name, store, backupJobs] of FIXTURES) {
    it(name, () => {
      const cron = decorateStatuses(store, NOW);
      const status = JSON.parse(
        JSON.stringify(once(inputs({ cron: store, backupJobs }), { start: NOW }))
      );

      // The old panel, as the board drew it.
      const old = render(
        <ConfigProvider config={{ sections: {} }} setConfig={vi.fn()}>
          <CronJobs nodes={cron} onRemove={vi.fn()} />
        </ConfigProvider>
      );

      // The new section, from the status alone.
      const rows = jobRows({ status, at: NOW });
      const section = render(<JobsSection groups={jobGroups(rows, { status })} count="" />);

      for (const { node, jobs } of cron) {
        for (const job of jobs) {
          const entity = status.entities.find(
            (e) =>
              (e.kind === 'job' || e.kind === 'backup') && e.node === node && e.name === job.job
          );
          expect(entity, `${node}:${job.job} in the model`).toBeTruthy();
          const box = old.container.querySelector(
            `[id="${entityAnchor(`jobs/${node}:${job.job}`)}"]`
          );
          expect(box, `${node}:${job.job} on the old panel`).not.toBeNull();

          // Its row: name, node and schedule (or its reason while it fails).
          const row = section.container.querySelector(`[data-entity="${entity.id}"]`);
          expect(row).toHaveTextContent(job.job);
          expect(row).toHaveTextContent(node);
          // The old panel's schedule as sent ("0 2 * * * (UTC)"), the model's in words.
          const schedule = job.runs[0]?.schedule;
          const words = scheduleWords(schedule, job.runs[0]?.expected_every_seconds);
          if (schedule) expect(box).toHaveTextContent(schedule);
          expect(entity.schedule).toBe(words ?? undefined);
          if (words && entity.state === 'ok') expect(row).toHaveTextContent(words);

          // Its detail: the schedule, the overdue line, each run.
          const view = entityDetail({
            status,
            reach: 'ok',
            id: entity.id,
            at: NOW,
            read: { cron: { body: cron, error: null } },
          });
          const detail = render(<EntityDetail view={view} />).container;
          if (words) expect(detail).toHaveTextContent(words);
          const oldLine = within(box).queryByText(/^Last report /);
          const newLine = detail.querySelector('[data-slot="detail-runs-note"]');
          expect(Boolean(newLine), `${job.job}: overdue line`).toBe(Boolean(oldLine));
          if (oldLine) expect(newLine.textContent).toBe(spaced(oldLine.textContent));
          const runs = [...detail.querySelectorAll('[data-run]')];
          expect(runs).toHaveLength(job.runs.length);
          // Each run's time and duration, as the old panel said them.
          expect(runs.map((li) => minutesOf(li.textContent)[0])).toEqual(
            minutesOf(box.textContent)
          );
          const duration = (li) => li.querySelector('[data-slot="detail-run-duration"]');
          expect(runs.map((li) => secondsOf(duration(li)?.textContent))).toEqual(
            job.runs.map((run) => secondsOf(oldDurationIn(box, run)))
          );
          job.runs.forEach((run, i) => {
            const duration = runDuration(run.duration_seconds);
            if (duration) expect(runs[i]).toHaveTextContent(duration);
            if (run.status === 'failure' && run.error) {
              expect(within(box).getByText(run.error)).toBeInTheDocument();
              expect(runs[i]).toHaveTextContent(run.error);
              expect(runs[i]).toHaveTextContent('Failed');
            }
          });
        }
      }
    });
  }
});
