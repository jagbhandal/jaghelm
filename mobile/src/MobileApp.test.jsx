import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const { addListener, exitApp, getPref, setPref, useDashboard } = vi.hoisted(() => ({
  addListener: vi.fn(), exitApp: vi.fn(), getPref: vi.fn(), setPref: vi.fn(),
  useDashboard: vi.fn(),
}));
vi.mock('@capacitor/app', () => ({ App: { addListener, exitApp } }));
vi.mock('./storage/prefsAdapter.js', () => ({ getPref, setPref }));
vi.mock('./data/useDashboard.js', () => ({ useDashboard }));
// Stub the four views so we assert shell behaviour, and let Services expose a push.
vi.mock('./views/Overview.jsx', () => ({ default: () => <div>OverviewView</div> }));
vi.mock('./views/Services.jsx', () => ({
  default: ({ nav }) => (
    <div>
      <div>ServicesView</div>
      <button onClick={() => nav.push('serviceDetail', { uid: 'x' })}>go-detail</button>
      {nav.current.screen === 'serviceDetail' && <div>DetailView</div>}
    </div>
  ),
}));
vi.mock('./views/Infra.jsx', () => ({ default: () => <div>InfraView</div> }));
vi.mock('./views/Alerts.jsx', () => ({ default: () => <div>AlertsView</div> }));

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
    expect(screen.getByText('DetailView')).toBeInTheDocument();
    await act(async () => { backHandler(); });           // pop detail
    expect(screen.queryByText('DetailView')).toBeNull();
    await act(async () => { backHandler(); });           // now at root → exit
    expect(exitApp).toHaveBeenCalledTimes(1);
  });
  it('switching tabs resets the detail stack', () => {
    render(<MobileApp />);
    fireEvent.click(screen.getByRole('tab', { name: 'Services' }));
    fireEvent.click(screen.getByText('go-detail'));
    expect(screen.getByText('DetailView')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Services' }));
    expect(screen.queryByText('DetailView')).toBeNull(); // stack reset
  });
});
