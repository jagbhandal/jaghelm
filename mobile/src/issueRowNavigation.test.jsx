import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';

// #279: an Overview issue row opens the detail screen of what it refers to.
// The real shell, Overview and detail screens render here; only the platform,
// storage, data and push seams are stubbed, so a tap goes through the app's
// own nav stack and SCREENS dispatcher.
const { addListener, exitApp, getPref, setPref, useDashboard, openTarget } = vi.hoisted(() => ({
  addListener: vi.fn(), exitApp: vi.fn(), getPref: vi.fn(), setPref: vi.fn(),
  useDashboard: vi.fn(), openTarget: vi.fn(),
}));
vi.mock('@capacitor/app', () => ({ App: { addListener, exitApp } }));
vi.mock('./storage/prefsAdapter.js', () => ({ getPref, setPref }));
vi.mock('./data/useDashboard.js', () => ({ useDashboard }));
vi.mock('./push/registerPush.js', () => ({ initPush: () => Promise.resolve({}), disablePush: vi.fn() }));
vi.mock('./components/RefreshStatus.jsx', () => ({ default: () => null }));
vi.mock('./open.js', () => ({ openTarget }));
vi.mock('@shared/hooks/useData.js', () => ({ getServiceIcon: () => null }));

import MobileApp from './MobileApp.jsx';
import { UPS_ONLINE, boardOf, cronNode, cronRun, inputs, monitored, node } from './testing/board.js';

// Two down services and two failed jobs share a name on different nodes, so a
// row that matched on display text would open the wrong one. The status is the
// model's, built from these inputs (#325).
const vm101 = (services) =>
  node({}, { display_name: 'VM 101', services });
const INPUTS = {
  nodes: {
    'vm-101': vm101([
      monitored('vm-101:nginx', 'down', { display_name: 'nginx', uptime24: 0.5, url: 'http://h/a' }),
      monitored('vm-101:vault', 'unknown', { display_name: 'vaultwarden' }),
    ]),
    'vm-103': node({}, {
      display_name: 'VM 103',
      services: [monitored('vm-103:nginx', 'down', { display_name: 'nginx', uptime24: 0.6, url: 'http://h/b' })],
    }),
  },
  ups: { ...UPS_ONLINE, status: 2, charge: 47, runtime: 480 },
  cron: [
    cronNode('vm-101', { backup: cronRun('failure', 60_000, { error: 'Exit code 1' }) }),
    cronNode('vm-103', { backup: cronRun('failure', 60_000, { error: 'Exit code 2' }) }),
  ],
};
const dataOf = (over = {}) => {
  const board = boardOf(inputs({ ...INPUTS, ...over }));
  return {
    ...board,
    updated: { get: () => Date.now(), subscribe: () => () => {}, builtAt: () => null, staleAfter: 72_000 },
    lastUpdated: Date.now(), intervalMs: 30000, foreground: true,
  };
};
const DATA = dataOf();

let backHandler;
beforeEach(() => {
  getPref.mockResolvedValue(null);
  setPref.mockResolvedValue(undefined);
  useDashboard.mockReturnValue({ ...DATA, refresh: vi.fn() });
  addListener.mockImplementation((evt, cb) => { if (evt === 'backButton') backHandler = cb; return { remove() {} }; });
});

let view;
async function renderOverview() {
  await act(async () => { view = render(<MobileApp />); });
  return screen.getByRole('region', { name: 'Active issues' });
}

// The next poll returns `data`; the app re-renders with it on whatever screen is up.
async function nextPoll(data) {
  useDashboard.mockReturnValue({ ...data, refresh: vi.fn() });
  await act(async () => { view.rerender(<MobileApp />); });
}

function issueRow(issues, name) {
  return within(issues).getByRole('button', { name });
}

describe('Overview issue rows open their detail screen (#279)', () => {
  it('a down service row opens that service, not a same-named one, and Back returns to the Overview', async () => {
    const issues = await renderOverview();
    fireEvent.click(issueRow(issues, 'nginx, Down, Service · vm-103'));

    expect(screen.getByRole('region', { name: 'Service detail' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'nginx' })).toBeInTheDocument();
    expect(screen.getByText('Kuma: down · VM 103')).toBeInTheDocument();
    expect(screen.queryByText('Kuma: down · VM 101')).toBeNull();
    // The row navigates in the app; the service's web page stays behind Open.
    expect(openTarget).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Overview' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('region', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Service detail' })).toBeNull();
  });

  it('a no-signal service row opens that service', async () => {
    const issues = await renderOverview();
    fireEvent.click(issueRow(issues, /vaultwarden/));

    const detail = screen.getByRole('region', { name: 'Service detail' });
    expect(within(detail).getByRole('heading', { name: 'vaultwarden' })).toBeInTheDocument();
    expect(within(detail).getByText('NO SIGNAL', { selector: '.status-word' })).toBeInTheDocument();
    expect(within(detail).getByText('VM 101')).toBeInTheDocument();
  });

  it('the UPS row opens its incident detail with the model\'s reason, and hardware back returns to the Overview', async () => {
    const issues = await renderOverview();
    fireEvent.click(issueRow(issues, /Back-UPS/));

    const detail = screen.getByRole('region', { name: 'Incident detail' });
    expect(within(detail).getByRole('heading', { name: 'Back-UPS' })).toBeInTheDocument();
    expect(within(detail).getByText('On battery (47 % charge)')).toBeInTheDocument();

    await act(async () => { backHandler(); });
    expect(screen.getByRole('region', { name: 'Overview' })).toBeInTheDocument();
    expect(exitApp).not.toHaveBeenCalled();
  });

  it('a job row opens the incident for that job on that node, not a same-named job elsewhere', async () => {
    const issues = await renderOverview();
    fireEvent.click(issueRow(issues, 'backup, Failed, Job · vm-103'));

    const detail = screen.getByRole('region', { name: 'Incident detail' });
    expect(within(detail).getByRole('heading', { name: 'backup' })).toBeInTheDocument();
    expect(within(detail).getByText('Last run failed: Exit code 2')).toBeInTheDocument();
    expect(within(detail).queryByText('Last run failed: Exit code 1')).toBeNull();
    expect(within(detail).getByText('Active — Job · vm-103')).toBeInTheDocument();
  });

  it('a service that stops being reported after its row was tapped shows so, and Back returns to the Overview', async () => {
    const issues = await renderOverview();
    fireEvent.click(issueRow(issues, 'nginx, Down, Service · vm-103'));
    expect(screen.getByRole('heading', { name: 'nginx' })).toBeInTheDocument();

    await nextPoll(dataOf({ nodes: { ...INPUTS.nodes, 'vm-103': node({}, { display_name: 'VM 103' }) } }));

    const detail = screen.getByRole('region', { name: 'Service detail' });
    expect(within(detail).getByText('This service is no longer reported.')).toBeInTheDocument();
    expect(within(detail).queryByRole('heading', { name: 'nginx' })).toBeNull();

    fireEvent.click(within(detail).getByRole('button', { name: 'Back' }));
    const back = screen.getByRole('region', { name: 'Active issues' });
    expect(screen.queryByRole('region', { name: 'Service detail' })).toBeNull();
    expect(within(back).queryByRole('button', { name: /nginx.*vm-103/ })).toBeNull();
    expect(issueRow(back, /nginx.*vm-101/)).toBeInTheDocument();
  });

  it('an incident that resolves after its row was tapped shows so, and hardware back returns to the Overview', async () => {
    const issues = await renderOverview();
    fireEvent.click(issueRow(issues, /Back-UPS/));
    expect(screen.getByRole('heading', { name: 'Back-UPS' })).toBeInTheDocument();

    await nextPoll(dataOf({ ups: UPS_ONLINE }));

    const detail = screen.getByRole('region', { name: 'Incident detail' });
    expect(within(detail).getByText('This incident has resolved.')).toBeInTheDocument();
    expect(within(detail).queryByRole('heading', { name: 'Back-UPS' })).toBeNull();

    await act(async () => { backHandler(); });
    const back = screen.getByRole('region', { name: 'Active issues' });
    expect(screen.queryByRole('region', { name: 'Incident detail' })).toBeNull();
    expect(within(back).queryByRole('button', { name: /Back-UPS/ })).toBeNull();
    expect(exitApp).not.toHaveBeenCalled();
  });

  it('every issue row is a focusable button named after what it opens, in the model\'s order', async () => {
    const issues = await renderOverview();
    const names = within(issues).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual([
      'nginx, Down, Service · vm-101',
      'nginx, Down, Service · vm-103',
      'Back-UPS, On battery, Power',
      'backup, Failed, Job · vm-101',
      'backup, Failed, Job · vm-103',
      'vaultwarden, No signal, Service · vm-101',
    ]);
    const first = issueRow(issues, 'nginx, Down, Service · vm-101');
    first.focus();
    expect(first).toHaveFocus();
  });
});
