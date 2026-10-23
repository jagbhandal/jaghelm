import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// MobileApp gives a node's and a container's detail screen their history
// (#602, components/DetailHistory.jsx) as `charts`, for what the screen shows;
// another screen, or a service with no container, gets none.

const { addListener, useDashboard, detail } = vi.hoisted(() => ({
  addListener: vi.fn(() => ({ remove() {} })),
  useDashboard: vi.fn(),
  // A detail screen that shows the `charts` it is given.
  detail: (name) => ({
    default: ({ charts }) => (
      <section aria-label={name}>{charts === undefined ? 'NO_CHARTS' : charts}</section>
    ),
  }),
}));
vi.mock('@capacitor/app', () => ({ App: { addListener, exitApp: vi.fn() } }));
vi.mock('./storage/prefsAdapter.js', () => ({
  getPref: vi.fn().mockResolvedValue(null),
  setPref: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./data/useDashboard.js', () => ({ useDashboard }));
vi.mock('./push/registerPush.js', () => ({
  initPush: vi.fn().mockResolvedValue({}),
  disablePush: vi.fn(),
}));
vi.mock('./components/RefreshStatus.jsx', () => ({ default: () => null }));
vi.mock('@shared/phone/views/Overview.jsx', () => ({ default: () => <div>OverviewView</div> }));
vi.mock('@shared/phone/views/Alerts.jsx', () => ({ default: () => <div>AlertsView</div> }));
vi.mock('@shared/phone/views/Services.jsx', () => ({
  default: ({ nav }) => (
    <>
      <button onClick={() => nav.push('serviceDetail', { uid: 'vm-101:gitea' })}>gitea</button>
      <button onClick={() => nav.push('serviceDetail', { uid: 'vm-101:router' })}>router</button>
    </>
  ),
}));
vi.mock('@shared/phone/views/Infra.jsx', () => ({
  default: ({ nav }) => (
    <button onClick={() => nav.push('node', { nodeKey: 'vm-101' })}>vm-101</button>
  ),
}));
vi.mock('@shared/phone/views/NodeDetail.jsx', () => detail('Node detail'));
vi.mock('@shared/phone/views/ServiceDetail.jsx', () => detail('Service detail'));
vi.mock('@shared/phone/views/IncidentDetail.jsx', () => detail('Incident detail'));
vi.mock('./components/DetailHistory.jsx', () => ({
  DetailHistory: ({ target, updated }) => (
    <p data-updated={String(Boolean(updated))}>{`HISTORY ${target.kind} ${target.entity}`}</p>
  ),
}));

import MobileApp from './MobileApp.jsx';
import { UPS_ONLINE, boardOf, card, inputs, monitored, node } from './testing/board.js';

const BOARD = boardOf(
  inputs({
    nodes: {
      'vm-101': node(
        {},
        {
          display_name: 'VM 101',
          services: [
            monitored('vm-101:gitea', 'up'),
            { ...card('vm-101:router'), container: null },
          ],
        }
      ),
    },
    ups: UPS_ONLINE,
  })
);

beforeEach(() => {
  useDashboard.mockReturnValue({
    ...BOARD,
    updated: {
      get: () => null,
      subscribe: () => () => {},
      builtAt: () => null,
      staleAfter: 72_000,
    },
    lastUpdated: null,
    intervalMs: 30_000,
    refresh: vi.fn(),
  });
});

describe('MobileApp: the detail screens’ history (#602)', () => {
  it('a node: its history, paced by the status poll', () => {
    render(<MobileApp />);
    fireEvent.click(screen.getByRole('tab', { name: 'Infra' }));
    fireEvent.click(screen.getByText('vm-101'));
    const history = screen.getByText('HISTORY node vm-101');
    expect(screen.getByRole('region', { name: 'Node detail' })).toContainElement(history);
    expect(history).toHaveAttribute('data-updated', 'true');
  });

  it("a service's container; a service with none gets no history", () => {
    render(<MobileApp />);
    fireEvent.click(screen.getByRole('tab', { name: 'Services' }));
    fireEvent.click(screen.getByText('gitea'));
    expect(screen.getByText('HISTORY container vm-101/gitea')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Services' }));
    fireEvent.click(screen.getByText('router'));
    expect(screen.getByRole('region', { name: 'Service detail' })).toHaveTextContent('NO_CHARTS');
  });
});
