import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';
import { PHONE_WIDTH } from '@ui/app-shell';
import { runScenario } from '../server/testing/statusScenarios.js';
import { decorateStatuses } from '../server/cron-overdue.js';
import { forgetAnswers } from './hooks/useData.js';
import { forgetRemoved } from './shell/removedJobs.js';

// The Jobs section and a job's detail (#578): every scheduled job and backup
// on the Overview after Infrastructure, from the status alone; a row opens
// its detail (the drawer from 768px, the phone's sheet below it) with its
// schedule, last runs and the overdue line, and Remove behind a Confirm,
// which calls the old panel's endpoint, takes the row off and closes the
// detail. Below 768px the same list is under the nodes on Infrastructure.

const NOW = Date.now();
const RUN = runScenario('every-state', { now: NOW });
const STATUS = JSON.parse(JSON.stringify(RUN.status));
const SERVICES = JSON.parse(JSON.stringify(RUN.cycle.caches.getCached('services')));
const CRON = JSON.parse(
  JSON.stringify(decorateStatuses(RUN.cycle.caches.getAllCronStatuses(), NOW))
);

function respond(body, status = 200, headers = {}) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(body == null ? '' : JSON.stringify(body)),
  });
}

function windowOf({ phone }) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    media: query,
    matches: phone && query === PHONE_WIDTH,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
}

let display;
let removeAnswer;
beforeEach(() => {
  forgetAnswers();
  forgetRemoved();
  display = {};
  removeAnswer = 204;
  localStorage.clear();
  localStorage.setItem('jaghelm-token', 'tok');
  localStorage.setItem('jaghelm-config', JSON.stringify({ tabs: [] }));
  vi.stubGlobal(
    'fetch',
    vi.fn((url, opts = {}) => {
      const path = String(url).split('?')[0];
      if (opts.method === 'DELETE' && path.startsWith('/api/cron/jobs/'))
        return removeAnswer instanceof Error
          ? Promise.reject(removeAnswer)
          : respond(null, removeAnswer);
      if (path === '/api/auth/check') return respond({ authRequired: true, authenticated: true });
      if (path === '/api/status') return respond(STATUS);
      if (path === '/api/services') return respond(SERVICES);
      if (path === '/api/cron/status') return respond(CRON);
      if (path === '/api/display-config') return respond(display, 200, { ETag: '"v1"' });
      if (['/api/todos', '/api/gitea/activity'].includes(path)) return respond([]);
      return respond({});
    })
  );
});
afterEach(() => forgetRemoved());

const deletes = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([, opts]) => opts?.method === 'DELETE')
    .map(([u]) => u);

async function renderAt(path) {
  window.history.replaceState(null, '', path);
  render(<App />);
  await screen.findByRole('banner', { hidden: true });
}

const section = () => screen.findByRole('region', { name: 'Jobs' });
const rowNames = (root) =>
  [...root.querySelectorAll('[data-entity]')].map((el) => el.getAttribute('data-entity'));

describe('from 768px, the Overview’s Jobs section (#578)', () => {
  beforeEach(() => windowOf({ phone: false }));

  it('lists every job and backup after Infrastructure, before Services, from the status alone', async () => {
    await renderAt('/');
    const jobs = await section();
    expect(rowNames(jobs)).toEqual([
      'jobs/apps:db-dump',
      'jobs/apps:image-prune',
      'jobs/storage:scrub-check',
      'backups/storage:nightly-backup',
    ]);
    expect(within(jobs).getByText('4 scheduled · 1 failed · 2 overdue')).toBeInTheDocument();
    const order = [...document.querySelectorAll('[data-slot^="overview-"]')]
      .map((el) => el.getAttribute('data-slot'))
      .filter((slot) =>
        ['overview-infrastructure', 'overview-jobs', 'overview-services'].includes(slot)
      );
    expect(order).toEqual(['overview-infrastructure', 'overview-jobs', 'overview-services']);
    // A row: its node, its schedule while well, the model's reason while not, its last report.
    const scrub = jobs.querySelector('[data-entity="jobs/storage:scrub-check"]');
    expect(scrub).toHaveTextContent('storage');
    expect(scrub).toHaveTextContent('weekly');
    const dump = jobs.querySelector('[data-entity="jobs/apps:db-dump"]');
    expect(dump).toHaveTextContent('Last run failed: exit code 3');
    expect(dump).toHaveTextContent('1 h ago');
  });

  it('follows the strip’s filter: Backups keeps its group alone; another subsystem hides it', async () => {
    await renderAt('/?subsystem=backups');
    const jobs = await section();
    expect(rowNames(jobs)).toEqual(['backups/storage:nightly-backup']);
    window.history.pushState(null, '', '/?subsystem=services');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Jobs' })).toBeNull());
  });

  it('switched off in Settings, it isn’t drawn', async () => {
    display = { overviewSections: { jobs: false } };
    await renderAt('/');
    await screen.findByRole('region', { name: 'Services' });
    expect(screen.queryByRole('region', { name: 'Jobs' })).toBeNull();
  });

  it('a row opens its drawer: the schedule, the last report, the overdue line and the last runs', async () => {
    const user = userEvent.setup();
    await renderAt('/');
    const jobs = await section();
    await user.click(within(jobs).getByRole('link', { name: 'image-prune, Overdue' }));
    const drawer = await screen.findByRole('dialog', { name: 'image-prune' });
    expect(window.location.search).toBe('?entity=jobs/apps:image-prune');
    expect(drawer).toHaveTextContent('daily 04:00');
    expect(
      await within(drawer).findByText(/^Last report \d+ [hd] ago · expected every 24 h$/)
    ).toHaveClass('text-warn-fg');
    await waitFor(() => expect(drawer.querySelectorAll('[data-run]')).toHaveLength(3));
    expect(within(drawer).getByRole('button', { name: 'Remove…' })).toBeInTheDocument();
  });

  it('Remove asks first, calls the old panel’s endpoint, the row goes, and focus lands on the next row', async () => {
    const user = userEvent.setup();
    await renderAt('/');
    const jobs = await section();
    await user.click(within(jobs).getByRole('link', { name: 'db-dump, Failed' }));
    const drawer = await screen.findByRole('dialog', { name: 'db-dump' });

    // Cancel: nothing sent.
    await user.click(within(drawer).getByRole('button', { name: 'Remove…' }));
    let confirm = await screen.findByRole('alertdialog', { name: 'Remove this job?' });
    expect(confirm).toHaveTextContent('db-dump');
    expect(confirm).toHaveTextContent('On apps');
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(deletes()).toEqual([]);

    await user.click(within(drawer).getByRole('button', { name: 'Remove…' }));
    confirm = await screen.findByRole('alertdialog', { name: 'Remove this job?' });
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(deletes()).toEqual(['/api/cron/jobs/apps/db-dump']));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.search).toBe('');
    const after = await section();
    expect(rowNames(after)).not.toContain('jobs/apps:db-dump');
    await waitFor(() =>
      expect(document.activeElement).toBe(
        after.querySelector('[data-entity="jobs/apps:image-prune"]')
      )
    );
  });

  it('a Remove that fails says why, and the job stays', async () => {
    removeAnswer = 500;
    const user = userEvent.setup();
    await renderAt('/?entity=backups/storage:nightly-backup');
    const drawer = await screen.findByRole('dialog', { name: 'nightly-backup' });
    await user.click(within(drawer).getByRole('button', { name: 'Remove…' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove this backup?' });
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    const banner = await within(drawer).findByText("Couldn't remove nightly-backup");
    expect(banner.closest('[data-slot="detail-remove-error"]')).toHaveTextContent(
      'JagHelm answered HTTP 500. Nothing was removed.'
    );
    expect(screen.getByRole('dialog', { name: 'nightly-backup' })).toBeInTheDocument();
    // Under the open drawer (inert, so hidden), the row is still there.
    const under = await screen.findByRole('region', { name: 'Jobs', hidden: true });
    expect(rowNames(under)).toContain('backups/storage:nightly-backup');

    // Unreachable: says so too.
    removeAnswer = new TypeError('Failed to fetch');
    await user.click(within(drawer).getByRole('button', { name: 'Remove…' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' })
    );
    expect(
      await within(drawer).findByText("JagHelm couldn't be reached. Nothing was removed.")
    ).toBeInTheDocument();
  });
});

describe('below 768px, the same list under the nodes on Infrastructure (#578)', () => {
  beforeEach(() => windowOf({ phone: true }));

  it('lists every job; a row opens its sheet, whose Remove takes it off and closes it', async () => {
    const user = userEvent.setup();
    await renderAt('/infrastructure');
    const jobs = await screen.findByRole('region', { name: 'Jobs' });
    expect(jobs).toHaveAttribute('data-slot', 'phone-jobs');
    expect(rowNames(jobs)).toEqual([
      'jobs/apps:db-dump',
      'jobs/apps:image-prune',
      'jobs/storage:scrub-check',
      'backups/storage:nightly-backup',
    ]);
    await user.click(within(jobs).getByRole('button', { name: 'scrub-check, OK' }));
    const sheet = await screen.findByRole('dialog', { name: /scrub-check/ });
    expect(window.location.search).toBe('?entity=jobs/storage:scrub-check');
    await waitFor(() => expect(sheet.querySelectorAll('[data-run]')).toHaveLength(3));
    await user.click(within(sheet).getByRole('button', { name: 'Remove…' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove this job?' });
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(deletes()).toEqual(['/api/cron/jobs/storage/scrub-check']));
    await waitFor(() => expect(window.location.search).toBe(''));
    const after = await screen.findByRole('region', { name: 'Jobs' });
    expect(rowNames(after)).not.toContain('jobs/storage:scrub-check');
    await waitFor(() =>
      expect(document.activeElement).toBe(
        after.querySelector('[data-entity="backups/storage:nightly-backup"]')
      )
    );
  });
});
