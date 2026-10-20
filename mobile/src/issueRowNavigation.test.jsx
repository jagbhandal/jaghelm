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

// Two down services and two failed jobs share a name on different nodes, so a
// row that matched on display text would open the wrong one.
const DATA = {
  servicesBody: {
    nodes: {
      'vm-101': {
        display_name: 'VM 101', metrics: { cpu: '10', memPercent: '20' },
        services: [
          { uid: 'vm-101:nginx', display_name: 'nginx', status: 'down', uptime24: 0.5, url: 'http://h/a' },
          { uid: 'vm-101:vault', display_name: 'vaultwarden', status: 'unknown', uptime24: null, url: '' },
        ],
      },
      'vm-103': {
        display_name: 'VM 103', metrics: { cpu: '12', memPercent: '30' },
        services: [
          { uid: 'vm-103:nginx', display_name: 'nginx', status: 'down', uptime24: 0.6, url: 'http://h/b' },
        ],
      },
    },
  },
  ups: { status: 2, charge: 47, runtime: 480 },
  cron: [
    { node: 'vm-101', jobs: [{ job: 'backup', runs: [{ status: 'failure', error: 'Exit code 1' }] }] },
    { node: 'vm-103', jobs: [{ job: 'backup', runs: [{ status: 'failure', error: 'Exit code 2' }] }] },
  ],
  loading: false, error: null, lastUpdated: Date.now(), intervalMs: 30000, foreground: true,
};

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
    fireEvent.click(issueRow(issues, /nginx.*VM 103/));

    expect(screen.getByRole('region', { name: 'Service detail' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'nginx' })).toBeInTheDocument();
    expect(screen.getByText('Service is down · VM 103')).toBeInTheDocument();
    expect(screen.queryByText('Service is down · VM 101')).toBeNull();
    // The row navigates in the app; the service's web page stays behind Open.
    expect(openTarget).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Overview' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('region', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Service detail' })).toBeNull();
  });

  it('an unknown service row opens that service', async () => {
    const issues = await renderOverview();
    fireEvent.click(issueRow(issues, /vaultwarden/));

    const detail = screen.getByRole('region', { name: 'Service detail' });
    expect(within(detail).getByRole('heading', { name: 'vaultwarden' })).toBeInTheDocument();
    expect(within(detail).getByText('UNKNOWN', { selector: '.status-word' })).toBeInTheDocument();
    expect(within(detail).getByText('VM 101')).toBeInTheDocument();
  });

  it('the UPS row opens its incident detail with the cause, and hardware back returns to the Overview', async () => {
    const issues = await renderOverview();
    fireEvent.click(issueRow(issues, /UPS on battery/));

    const detail = screen.getByRole('region', { name: 'Incident detail' });
    expect(within(detail).getByRole('heading', { name: 'UPS on battery' })).toBeInTheDocument();
    expect(within(detail).getByText('On battery — 47% charge')).toBeInTheDocument();

    await act(async () => { backHandler(); });
    expect(screen.getByRole('region', { name: 'Overview' })).toBeInTheDocument();
    expect(exitApp).not.toHaveBeenCalled();
  });

  it('a cron row opens the incident for that job on that node, not a same-named job elsewhere', async () => {
    const issues = await renderOverview();
    fireEvent.click(issueRow(issues, /backup failed.*vm-103/));

    const detail = screen.getByRole('region', { name: 'Incident detail' });
    expect(within(detail).getByRole('heading', { name: 'backup failed' })).toBeInTheDocument();
    expect(within(detail).getByText('Exit code 2')).toBeInTheDocument();
    expect(within(detail).queryByText('Exit code 1')).toBeNull();
    expect(within(detail).getByText('Active — vm-103')).toBeInTheDocument();
  });

  it('a service that stops being reported after its row was tapped shows so, and Back returns to the Overview', async () => {
    const issues = await renderOverview();
    fireEvent.click(issueRow(issues, /nginx.*VM 103/));
    expect(screen.getByRole('heading', { name: 'nginx' })).toBeInTheDocument();

    const nodes = DATA.servicesBody.nodes;
    await nextPoll({ ...DATA, servicesBody: { nodes: { ...nodes, 'vm-103': { ...nodes['vm-103'], services: [] } } } });

    const detail = screen.getByRole('region', { name: 'Service detail' });
    expect(within(detail).getByText('This service is no longer reported.')).toBeInTheDocument();
    expect(within(detail).queryByRole('heading', { name: 'nginx' })).toBeNull();

    fireEvent.click(within(detail).getByRole('button', { name: 'Back' }));
    const back = screen.getByRole('region', { name: 'Active issues' });
    expect(screen.queryByRole('region', { name: 'Service detail' })).toBeNull();
    expect(within(back).queryByRole('button', { name: /nginx.*VM 103/ })).toBeNull();
    expect(issueRow(back, /nginx.*VM 101/)).toBeInTheDocument();
  });

  it('an incident that resolves after its row was tapped shows so, and hardware back returns to the Overview', async () => {
    const issues = await renderOverview();
    fireEvent.click(issueRow(issues, /UPS on battery/));
    expect(screen.getByRole('heading', { name: 'UPS on battery' })).toBeInTheDocument();

    await nextPoll({ ...DATA, ups: { status: 1, charge: 100, runtime: 1800 } });

    const detail = screen.getByRole('region', { name: 'Incident detail' });
    expect(within(detail).getByText('This incident has resolved.')).toBeInTheDocument();
    expect(within(detail).queryByRole('heading', { name: 'UPS on battery' })).toBeNull();

    await act(async () => { backHandler(); });
    const back = screen.getByRole('region', { name: 'Active issues' });
    expect(screen.queryByRole('region', { name: 'Incident detail' })).toBeNull();
    expect(within(back).queryByRole('button', { name: /UPS on battery/ })).toBeNull();
    expect(exitApp).not.toHaveBeenCalled();
  });

  it('every issue row is a focusable button named after what it opens', async () => {
    const issues = await renderOverview();
    const names = within(issues).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual([
      'nginx, DOWN, VM 101',
      'nginx, DOWN, VM 103',
      'UPS on battery, ON BATTERY, 47% · 8m',
      'backup failed, FAILED, vm-101',
      'backup failed, FAILED, vm-103',
      'vaultwarden, unknown, VM 101 · no signal',
    ]);
    const first = issueRow(issues, 'nginx, DOWN, VM 101');
    first.focus();
    expect(first).toHaveFocus();
  });
});
