import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';

// #309: a tapped push opens the detail screen of the entity it is about, the
// one a row about it opens, by the push's `entity` (server/push/
// androidPayload.js). Warm: the app is running, on any tab. Cold: the tap
// starts the app; Capacitor hands the tap to the listener as initPush adds
// it, before the first poll has answered and before the last tab is read
// back, and the detail must survive both. The real shell, screens and
// routeFromData run here; the platform, storage, data and push registration
// are stubbed, the registration standing in for the plugin's listener.
const { addListener, exitApp, getPref, setPref, useDashboard, initPush } = vi.hoisted(() => ({
  addListener: vi.fn(),
  exitApp: vi.fn(),
  getPref: vi.fn(),
  setPref: vi.fn(),
  useDashboard: vi.fn(),
  initPush: vi.fn(),
}));
vi.mock('@capacitor/app', () => ({ App: { addListener, exitApp } }));
vi.mock('./storage/prefsAdapter.js', () => ({ getPref, setPref }));
vi.mock('./data/useDashboard.js', () => ({ useDashboard }));
vi.mock('./push/registerPush.js', () => ({ initPush, disablePush: vi.fn() }));
vi.mock('./components/RefreshStatus.jsx', () => ({ default: () => null }));
vi.mock('./open.js', () => ({ openTarget: vi.fn() }));
// A detail's history (#602) is asked and never answers here: its placeholders.
vi.mock('@shared/hooks/useData.js', () => ({
  getServiceIcon: () => null,
  getHistory: () => new Promise(() => {}),
  NOT_MODIFIED_NO_BODY: Symbol('not modified'),
}));

import MobileApp from './MobileApp.jsx';
import { routeFromData } from './push/routeFromData.js';
import { boardOf, cronNode, cronRun, inputs, monitored, node } from './testing/board.js';

const INPUTS = {
  nodes: {
    'vm-101': node(
      {},
      {
        display_name: 'VM 101',
        services: [monitored('vm-101:nginx', 'down', { display_name: 'nginx' })],
      }
    ),
    pve: node({}, { display_name: 'Proxmox' }),
  },
  // A Kuma monitor no card is drawn for (#390): the model's service, no card's.
  internal: { kumaWithoutCard: { 'vm-101:radarr': 'down' } },
  cron: [
    cronNode('pve', { 'proxmox-backup': cronRun('failure', 60_000, { error: 'Exit code 2' }) }),
  ],
  backupJobs: ['pve:proxmox-backup'],
};
const clock = {
  get: () => Date.now(),
  subscribe: () => () => {},
  builtAt: () => null,
  staleAfter: 72_000,
};
const READY = {
  ...boardOf(inputs(INPUTS)),
  updated: clock,
  lastUpdated: Date.now(),
  intervalMs: 30000,
  foreground: true,
};
// Before the first poll has answered.
const WAITING = {
  ...READY,
  status: null,
  servicesBody: null,
  ups: null,
  reach: 'loading',
  loading: true,
};

/** The FCM data of a push, as the server sends it (androidPayload.js). */
const PUSHES = {
  service: [
    {
      type: 'service_down',
      id: 'vm-101:nginx',
      node: 'vm-101',
      severity: 'critical',
      entity: 'services/vm-101:nginx',
    },
    'Service detail',
    'nginx',
  ],
  node: [
    {
      type: 'host_threshold',
      id: 'pve:disk',
      node: 'pve',
      severity: 'warning',
      entity: 'nodes/pve',
    },
    'Node detail',
    'Proxmox',
  ],
  backup: [
    {
      type: 'cron_failed',
      id: 'pve:proxmox-backup',
      node: 'pve',
      severity: 'critical',
      entity: 'backups/pve:proxmox-backup',
    },
    'Incident detail',
    'proxmox-backup',
  ],
};

let view;
let tapped; // the listener initPush adds: what a tap calls
beforeEach(() => {
  view = null;
  setPref.mockResolvedValue(undefined);
  addListener.mockImplementation(() => ({ remove() {} }));
  initPush.mockImplementation(({ nav }) => {
    tapped = (data) => routeFromData(data, nav);
    return Promise.resolve({ enabled: true });
  });
});

const poll = async (data) => {
  useDashboard.mockReturnValue({ ...data, refresh: vi.fn() });
  if (view)
    await act(async () => {
      view.rerender(<MobileApp />);
    });
};

describe('a tapped push opens its entity’s detail screen (#309)', () => {
  for (const [kind, [data, region, heading]] of Object.entries(PUSHES)) {
    it(`warm, on another tab: a ${kind}'s push opens its ${region}`, async () => {
      getPref.mockResolvedValue('services');
      await poll(READY);
      await act(async () => {
        view = render(<MobileApp />);
      });
      expect(screen.getByRole('region', { name: 'Services' })).toBeInTheDocument();

      await act(async () => {
        tapped(data);
      });
      const detail = screen.getByRole('region', { name: region });
      expect(within(detail).getByRole('heading', { name: heading })).toBeInTheDocument();
    });

    it(`cold: a ${kind}'s push tapped as the app starts opens its ${region}, once the poll and the last tab are in`, async () => {
      // The last tab is read back after the tap has been handed over.
      let lastTab;
      getPref.mockReturnValue(
        new Promise((resolve) => {
          lastTab = resolve;
        })
      );
      initPush.mockImplementation(({ nav }) => {
        routeFromData(data, nav); // the plugin hands over the launch tap at once
        return Promise.resolve({ enabled: true });
      });
      await poll(WAITING);
      await act(async () => {
        view = render(<MobileApp />);
      });
      // Waiting for the poll: it says so, never that the thing is gone.
      expect(screen.getByRole('region', { name: region })).toHaveTextContent('Loading…');
      expect(document.body.textContent).not.toMatch(/no longer|resolved/);

      await act(async () => {
        lastTab('services');
      });
      await poll(READY);
      const detail = screen.getByRole('region', { name: region });
      expect(within(detail).getByRole('heading', { name: heading })).toBeInTheDocument();
    });
  }

  // The entity isn't there to show: the push's event, as before #309.
  it('a service the cards don’t have: its issue, when the model has it; else the push’s own event', async () => {
    getPref.mockResolvedValue(null);
    await poll(READY);
    await act(async () => {
      view = render(<MobileApp />);
    });

    await act(async () => {
      tapped({
        type: 'service_down',
        id: 'vm-101:radarr',
        node: 'vm-101',
        severity: 'critical',
        entity: 'services/vm-101:radarr',
      });
    });
    let detail = screen.getByRole('region', { name: 'Incident detail' });
    expect(within(detail).getByRole('heading', { name: 'radarr' })).toBeInTheDocument();
    // The model's issue for it (a monitor with no card is no signal).
    expect(detail).toHaveTextContent('Active — Service · vm-101');

    await act(async () => {
      tapped({
        type: 'service_down',
        id: 'vm-101:gone',
        node: 'vm-101',
        severity: 'critical',
        entity: 'services/vm-101:gone',
      });
    });
    detail = screen.getByRole('region', { name: 'Incident detail' });
    expect(within(detail).getByRole('heading', { name: 'Service down' })).toBeInTheDocument();
    expect(detail).toHaveTextContent('it may have resolved');
    expect(document.body.textContent).not.toMatch(/no longer reported/);

    await act(async () => {
      tapped({
        type: 'host_unreachable',
        id: 'old-node',
        node: 'old-node',
        severity: 'critical',
        entity: 'nodes/old-node',
      });
    });
    detail = screen.getByRole('region', { name: 'Incident detail' });
    expect(within(detail).getByRole('heading', { name: 'Host unreachable' })).toBeInTheDocument();
  });
});
