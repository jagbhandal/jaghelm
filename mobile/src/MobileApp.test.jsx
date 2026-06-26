import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

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
vi.mock('./views/Alerts.jsx', () => ({ default: () => <div>AlertsView</div> }));
// Mock the detail views so the dispatcher renders them without real data deps.
vi.mock('./views/ServiceDetail.jsx', () => ({ default: ({ nav }) => <div>SERVICE_DETAIL<button onClick={nav.pop}>back</button></div> }));
vi.mock('./views/NodeDetail.jsx', () => ({ default: ({ nav }) => <div>NODE_DETAIL<button onClick={nav.pop}>back</button></div> }));
vi.mock('./views/IncidentDetail.jsx', () => ({ default: ({ nav }) => <div>INCIDENT_DETAIL<button onClick={nav.pop}>back</button></div> }));

import MobileApp from './MobileApp.jsx';

let backHandler;
beforeEach(() => {
  addListener.mockReset(); exitApp.mockReset(); getPref.mockReset(); setPref.mockReset(); useDashboard.mockReset();
  getPref.mockResolvedValue(null);
  setPref.mockResolvedValue(undefined);
  useDashboard.mockReturnValue({ servicesBody: { nodes: {} }, ups: {}, cron: [], history: {}, loading: false, error: null });
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
