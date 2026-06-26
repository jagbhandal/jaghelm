import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { openTarget } = vi.hoisted(() => ({ openTarget: vi.fn() }));
vi.mock('../open.js', () => ({ openTarget }));

import IncidentDetail from './IncidentDetail.jsx';

const DATA = {
  servicesBody: {
    nodes: {
      'vm-101': {
        display_name: 'VM 101',
        metrics: {},
        services: [
          {
            uid: 'vm-101:gitea',
            display_name: 'Gitea',
            icon: null,
            status: 'down',
            ping: null,
            uptime24: 0.42,
            url: 'http://h/gitea',
          },
        ],
      },
    },
  },
  ups: { status: 1 },
  cron: [],
  history: {},
  loading: false,
  error: null,
};

describe('IncidentDetail', () => {
  beforeEach(() => openTarget.mockReset());

  it('shows status/node/cause/uptime + a timeline + Open + back', () => {
    const pop = vi.fn();
    render(<IncidentDetail data={DATA} nav={{ pop }} params={{ id: 'service:vm-101:gitea' }} />);

    // Title and node
    expect(screen.getByText('Gitea')).toBeInTheDocument();
    expect(screen.getByText('VM 101')).toBeInTheDocument();

    // Cause
    expect(screen.getByText('Service is down')).toBeInTheDocument();

    // 24h uptime: 0.42 * 100 = 42.0%
    expect(screen.getByText('42.0%')).toBeInTheDocument();

    // Timeline section heading
    expect(screen.getByText(/timeline/i)).toBeInTheDocument();

    // Phase-5 push placeholder row in timeline
    expect(screen.getByText(/Pending.*push pipeline/i)).toBeInTheDocument();

    // Open button triggers openTarget
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(openTarget).toHaveBeenCalled();

    // Back button calls nav.pop
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(pop).toHaveBeenCalled();
  });

  it('shows the Phase-5 push-pending placeholder row in the timeline', () => {
    render(<IncidentDetail data={DATA} nav={{ pop: vi.fn() }} params={{ id: 'service:vm-101:gitea' }} />);
    expect(screen.getByText('Push sent')).toBeInTheDocument();
    expect(screen.getByText(/Pending.*Phase 5/i)).toBeInTheDocument();
  });

  it('shows Detected event in the timeline', () => {
    render(<IncidentDetail data={DATA} nav={{ pop: vi.fn() }} params={{ id: 'service:vm-101:gitea' }} />);
    expect(screen.getByText('Detected')).toBeInTheDocument();
  });

  it('handles a resolved/stale incident id gracefully', () => {
    render(<IncidentDetail data={DATA} nav={{ pop: vi.fn() }} params={{ id: 'service:gone:x' }} />);
    expect(screen.getByText(/resolved/i)).toBeInTheDocument();
  });

  it('does not render a Mute button (read-only)', () => {
    render(<IncidentDetail data={DATA} nav={{ pop: vi.fn() }} params={{ id: 'service:vm-101:gitea' }} />);
    expect(screen.queryByRole('button', { name: /mute/i })).toBeNull();
  });
});

// APPEND below the existing describe('IncidentDetail', ...) block — no new imports.
describe('IncidentDetail push-event fallback (Phase 5)', () => {
  const liveData = {
    servicesBody: { nodes: { 'vm-101': { display_name: 'VM 101', services: [
      { uid: 'vm-101:nginx', display_name: 'nginx', status: 'down', uptime24: 0.5, url: '' },
    ] } } },
    ups: { status: 1 }, cron: [],
  };
  const calmData = { servicesBody: { nodes: {} }, ups: { status: 1 }, cron: [] };

  it('renders a host-event push from fallback params when no derived incident exists (NOT the resolved stub)', () => {
    render(
      <IncidentDetail
        nav={{ pop: vi.fn() }}
        data={calmData}
        params={{ id: null, fcmId: 'vm-101', type: 'host_unreachable', node: 'vm-101', severity: 'critical' }}
      />,
    );
    expect(screen.queryByText(/This incident has resolved/i)).toBeNull();
    expect(screen.getByText('vm-101')).toBeInTheDocument();
    expect(screen.getByText(/host unreachable/i)).toBeInTheDocument();
    expect(screen.getByText(/critical/i)).toBeInTheDocument();
  });

  it('still renders the LIVE incident when the reconciled id matches (path unchanged)', () => {
    render(
      <IncidentDetail
        nav={{ pop: vi.fn() }}
        data={liveData}
        params={{ id: 'service:vm-101:nginx', fcmId: 'vm-101:nginx', type: 'service_down', node: 'vm-101', severity: 'critical' }}
      />,
    );
    expect(screen.getByText('nginx')).toBeInTheDocument(); // live incident title (display_name)
    expect(screen.queryByText(/This incident has resolved/i)).toBeNull();
  });

  it('falls back to the resolved copy ONLY when there is neither a live incident nor push params', () => {
    render(<IncidentDetail nav={{ pop: vi.fn() }} data={calmData} params={{ id: 'service:gone' }} />);
    expect(screen.getByText(/This incident has resolved/i)).toBeInTheDocument();
  });
});
