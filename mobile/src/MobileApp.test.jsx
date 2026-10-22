import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

const { addListener, exitApp, getPref, setPref, useDashboard } = vi.hoisted(() => ({
  addListener: vi.fn(), exitApp: vi.fn(), getPref: vi.fn(), setPref: vi.fn(),
  useDashboard: vi.fn(),
}));
vi.mock('@capacitor/app', () => ({ App: { addListener, exitApp } }));
vi.mock('./storage/prefsAdapter.js', () => ({ getPref, setPref }));
vi.mock('./data/useDashboard.js', () => ({ useDashboard }));
// Stub the four root views so we assert shell behaviour.
// Services stub exposes a 'go-detail' button that pushes serviceDetail.
// No inline DetailView branch — the real dispatcher (SCREENS map) renders ServiceDetail.
vi.mock('./views/Overview.jsx', () => ({ default: () => <div>OverviewView</div> }));
vi.mock('./views/Services.jsx', () => ({
  default: ({ nav }) => (
    <div>
      <div>ServicesView</div>
      <button onClick={() => nav.push('serviceDetail', { uid: 'x' })}>go-detail</button>
    </div>
  ),
}));
vi.mock('./views/Infra.jsx', () => ({ default: () => <div>InfraView</div> }));
vi.mock('./views/Alerts.jsx', () => ({
  default: ({ nav }) => (
    <div>
      <div>AlertsView</div>
      <button onClick={() => nav.push('notificationSettings')}>go-settings</button>
    </div>
  ),
}));
// Mock the detail views so the dispatcher renders them without real data deps.
vi.mock('./views/ServiceDetail.jsx', () => ({ default: ({ nav }) => <div>SERVICE_DETAIL<button onClick={nav.pop}>back</button></div> }));
vi.mock('./views/NodeDetail.jsx', () => ({ default: ({ nav }) => <div>NODE_DETAIL<button onClick={nav.pop}>back</button></div> }));
vi.mock('./views/IncidentDetail.jsx', () => ({ default: ({ nav }) => <div>INCIDENT_DETAIL<button onClick={nav.pop}>back</button></div> }));
// Phase 5: mock the push init + the settings screen so the existing shell tests
// don't pull the real plugin/storage import chain, and so we can assert initPush.
const { initPush } = vi.hoisted(() => ({
  initPush: vi.fn().mockResolvedValue({ enabled: true, permission: 'granted' }),
}));
vi.mock('./push/registerPush.js', () => ({ initPush, disablePush: vi.fn() }));
vi.mock('./views/NotificationSettings.jsx', () => ({
  default: ({ nav }) => (
    <div>NOTIFICATION_SETTINGS<button onClick={nav.pop}>back</button></div>
  ),
}));
// Task 6: stub RefreshStatus to capture the state/summary MobileApp hands it.
vi.mock('./components/RefreshStatus.jsx', () => ({
  default: ({ state, summary, foreground }) => (
    <div data-testid="refresh-status" data-foreground={String(foreground)}>{state}::{summary}</div>
  ),
}));

import MobileApp from './MobileApp.jsx';
import { UPS_ONLINE, inputs, monitored, node } from './testing/board.js';
import { once } from '../../server/testing/statusFixtures.js';

/** useDashboard's answer for one model cycle: the status, fresh, and its cards. */
function dashboardOf(cycleInputs, extra = {}) {
  return {
    status: JSON.parse(JSON.stringify(once(cycleInputs))),
    servicesBody: cycleInputs.services,
    reach: 'ok',
    updated: { get: () => Date.now(), subscribe: () => () => {}, builtAt: () => null, staleAfter: 72_000 },
    loading: false, error: null, lastUpdated: Date.now(), intervalMs: 30000, refresh: vi.fn(),
    ...extra,
  };
}
const oneService = (status) =>
  inputs({ nodes: { 'vm-101': node({}, { display_name: 'VM 101', services: [monitored('vm-101:a', status)] }) }, ups: UPS_ONLINE });

let backHandler;
beforeEach(() => {
  addListener.mockReset(); exitApp.mockReset(); getPref.mockReset(); setPref.mockReset(); useDashboard.mockReset();
  initPush.mockClear();
  getPref.mockResolvedValue(null);
  setPref.mockResolvedValue(undefined);
  useDashboard.mockReturnValue({ status: null, servicesBody: { nodes: {} }, reach: 'loading', loading: false, error: null });
  addListener.mockImplementation((evt, cb) => { if (evt === 'backButton') backHandler = cb; return { remove() {} }; });
});

describe('MobileApp shell — Phase 2 tab regression', () => {
  it('renders all four bottom-tab buttons with Overview selected by default', async () => {
    await act(async () => { render(<MobileApp />); });
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Services' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Infra' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Alerts' })).toHaveAttribute('aria-selected', 'false');
  });

  it('restores last tab from prefs and marks that tab aria-selected', async () => {
    getPref.mockResolvedValue('alerts');
    await act(async () => { render(<MobileApp />); });
    expect(screen.getByRole('tab', { name: 'Alerts' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'false');
  });
});

describe('MobileApp shell — Phase 3 nav', () => {
  it('hardware-back pops a detail before exiting', async () => {
    render(<MobileApp />);
    fireEvent.click(screen.getByRole('tab', { name: 'Services' }));
    fireEvent.click(screen.getByText('go-detail'));
    expect(screen.getByText('SERVICE_DETAIL')).toBeInTheDocument();
    await act(async () => { backHandler(); });           // pop detail
    expect(screen.queryByText('SERVICE_DETAIL')).toBeNull();
    await act(async () => { backHandler(); });           // now at root → exit
    expect(exitApp).toHaveBeenCalledTimes(1);
  });
  it('switching tabs resets the detail stack', () => {
    render(<MobileApp />);
    fireEvent.click(screen.getByRole('tab', { name: 'Services' }));
    fireEvent.click(screen.getByText('go-detail'));
    expect(screen.getByText('SERVICE_DETAIL')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Services' }));
    expect(screen.queryByText('SERVICE_DETAIL')).toBeNull(); // stack reset
  });
});

describe('MobileApp shell — Task 9 screen dispatcher', () => {
  it('renders the pushed serviceDetail screen, and back returns to the list', () => {
    render(<MobileApp />);
    fireEvent.click(screen.getByRole('tab', { name: 'Services' }));
    expect(screen.getByText('ServicesView')).toBeInTheDocument();
    fireEvent.click(screen.getByText('go-detail')); // Services stub pushes serviceDetail
    expect(screen.getByText('SERVICE_DETAIL')).toBeInTheDocument();
    expect(screen.queryByText('ServicesView')).toBeNull();
    fireEvent.click(screen.getByText('back'));
    expect(screen.queryByText('SERVICE_DETAIL')).toBeNull();
    expect(screen.getByText('ServicesView')).toBeInTheDocument();
  });
});

describe('MobileApp — the annunciator on the status model (#325)', () => {
  it('passes the model\'s ok state and its sentence when nothing is wrong', async () => {
    useDashboard.mockReturnValue(dashboardOf(oneService('up')));
    await act(async () => { render(<MobileApp />); });
    expect(screen.getByTestId('refresh-status').textContent).toBe('ok::1 service up · 1 node healthy');
  });

  it('passes the model\'s crit state and its sentence', async () => {
    useDashboard.mockReturnValue(dashboardOf(oneService('down')));
    await act(async () => { render(<MobileApp />); });
    expect(screen.getByTestId('refresh-status').textContent).toBe('crit::1 service down');
  });

  it('a status the server can\'t refresh is no signal, never its last state (Bug #4, #480)', async () => {
    useDashboard.mockReturnValue(dashboardOf(oneService('down'), { reach: 'down', error: new Error('fetch failed') }));
    await act(async () => { render(<MobileApp />); });
    expect(screen.getByTestId('refresh-status').textContent).toBe("unknown::Can't reach JagHelm");
  });

  it('no answer for longer than two polls is no signal too, though the last poll said ok (#480)', async () => {
    const old = Date.now() - 5 * 60_000;
    useDashboard.mockReturnValue(
      dashboardOf(oneService('up'), {
        updated: { get: () => old, subscribe: () => () => {}, builtAt: () => null, staleAfter: 72_000 },
      })
    );
    await act(async () => { render(<MobileApp />); });
    expect(screen.getByTestId('refresh-status').textContent).toBe("unknown::JagHelm's status is out of date");
  });

  it('hands the status bar the foreground flag, so its countdown pauses in the background', async () => {
    useDashboard.mockReturnValue(dashboardOf(oneService('up'), { foreground: false }));
    await act(async () => { render(<MobileApp />); });
    expect(screen.getByTestId('refresh-status').dataset.foreground).toBe('false');
  });
});

describe('MobileApp shell — Phase 5 push wiring', () => {
  it('calls initPush exactly once on mount, passing the live nav', async () => {
    await act(async () => { render(<MobileApp />); });
    await waitFor(() => expect(initPush).toHaveBeenCalledTimes(1));
    expect(initPush).toHaveBeenCalledWith(expect.objectContaining({ nav: expect.any(Object) }));
  });

  it('registers notificationSettings in SCREENS so nav.push renders it', async () => {
    await act(async () => { render(<MobileApp />); });
    fireEvent.click(screen.getByRole('tab', { name: 'Alerts' }));
    fireEvent.click(screen.getByText('go-settings'));
    expect(screen.getByText('NOTIFICATION_SETTINGS')).toBeInTheDocument();
    expect(screen.queryByText('AlertsView')).toBeNull();
  });
});
