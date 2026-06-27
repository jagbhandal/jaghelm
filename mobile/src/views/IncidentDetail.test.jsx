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
          { uid: 'vm-101:gitea', display_name: 'Gitea', icon: null, status: 'down', ping: null, uptime24: 0.42, url: 'http://h/gitea' },
        ],
      },
    },
  },
  ups: { status: 1 },
  cron: [],
};

const pad = (x) => String(x).padStart(2, '0');
const clockOf = (ts) => { const d = new Date(Number(ts)); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

describe('IncidentDetail — derived incident (honest numbers)', () => {
  beforeEach(() => openTarget.mockReset());

  it('shows status word / node / cause / uptime + Open + back', () => {
    const pop = vi.fn();
    render(<IncidentDetail data={DATA} nav={{ pop }} params={{ id: 'service:vm-101:gitea' }} />);
    expect(screen.getByText('Gitea')).toBeInTheDocument();            // header title
    expect(screen.getByText('VM 101')).toBeInTheDocument();           // node tag
    expect(screen.getByText('Service is down')).toBeInTheDocument();  // cause
    expect(screen.getByText('42.0%')).toBeInTheDocument();            // uptime ring
    expect(screen.getByText('DOWN', { selector: '.status-word' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(openTarget).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(pop).toHaveBeenCalled();
  });

  it('Bug #2: removes the "Pending — push pipeline lands in Phase 5" dev string', () => {
    render(<IncidentDetail data={DATA} nav={{ pop: vi.fn() }} params={{ id: 'service:vm-101:gitea' }} />);
    expect(screen.queryByText(/Phase 5/i)).toBeNull();
    expect(screen.queryByText(/Pending/i)).toBeNull();
  });

  it('Bug #14: renders NO fabricated clock for a derived incident', () => {
    const { container } = render(<IncidentDetail data={DATA} nav={{ pop: vi.fn() }} params={{ id: 'service:vm-101:gitea' }} />);
    expect(screen.queryByText(/Detected/i)).toBeNull();
    expect(container.textContent).not.toMatch(/\d{1,2}:\d{2}/);
    // Instead: a single clock-less status line.
    expect(screen.getByText('Active — VM 101')).toBeInTheDocument();
  });

  it('renders the uptime ring without a jammed "24H uptime42.0%" string (Bug #1)', () => {
    render(<IncidentDetail data={DATA} nav={{ pop: vi.fn() }} params={{ id: 'service:vm-101:gitea' }} />);
    expect(screen.queryByText(/uptime42/i)).toBeNull();
    expect(screen.getByText('42.0%')).toBeInTheDocument();
    expect(screen.getByText('24H')).toBeInTheDocument();
  });

  it('Bug #9: demotes Open to the secondary ghost variant', () => {
    render(<IncidentDetail data={DATA} nav={{ pop: vi.fn() }} params={{ id: 'service:vm-101:gitea' }} />);
    expect(screen.getByRole('button', { name: 'Open' }).className).toMatch(/open-btn--ghost/);
  });

  it('does not render a Mute button (read-only)', () => {
    render(<IncidentDetail data={DATA} nav={{ pop: vi.fn() }} params={{ id: 'service:vm-101:gitea' }} />);
    expect(screen.queryByRole('button', { name: /mute/i })).toBeNull();
  });

  it('handles a resolved/stale incident id gracefully', () => {
    render(<IncidentDetail data={DATA} nav={{ pop: vi.fn() }} params={{ id: 'service:gone:x' }} />);
    expect(screen.getByText(/has resolved/i)).toBeInTheDocument();
  });
});

describe('IncidentDetail — push-event fallback (real timestamp only)', () => {
  const liveData = {
    servicesBody: { nodes: { 'vm-101': { display_name: 'VM 101', services: [
      { uid: 'vm-101:nginx', display_name: 'nginx', status: 'down', uptime24: 0.5, url: '' },
    ] } } },
    ups: { status: 1 }, cron: [],
  };
  const calmData = { servicesBody: { nodes: {} }, ups: { status: 1 }, cron: [] };

  it('renders a host-event push from fallback params (NOT the resolved stub), with no dev string', () => {
    render(
      <IncidentDetail
        nav={{ pop: vi.fn() }}
        data={calmData}
        params={{ id: null, fcmId: 'vm-101', type: 'host_unreachable', node: 'vm-101', severity: 'critical' }}
      />,
    );
    expect(screen.queryByText(/This incident has resolved/i)).toBeNull();
    expect(screen.getByText('vm-101')).toBeInTheDocument();           // node tag
    expect(screen.getByText('Host unreachable')).toBeInTheDocument(); // header title
    expect(screen.getByText(/Severity: critical/i)).toBeInTheDocument();
    expect(screen.queryByText(/Phase 5/i)).toBeNull();
  });

  it('renders {event} · HH:MM from a REAL push-record timestamp (strings, as FCM delivers)', () => {
    const ts = String(Date.now() - 5 * 60_000);
    render(
      <IncidentDetail
        nav={{ pop: vi.fn() }}
        data={calmData}
        params={{ id: null, fcmId: 'vm-101', type: 'host_unreachable', node: 'vm-101', severity: 'critical', ts }}
      />,
    );
    expect(screen.getByText(`Host unreachable · ${clockOf(ts)}`)).toBeInTheDocument();
    expect(screen.getByText(/may have resolved/i)).toBeInTheDocument();
  });

  it('renders NO clock for a push-event that carries no real timestamp', () => {
    const { container } = render(
      <IncidentDetail
        nav={{ pop: vi.fn() }}
        data={calmData}
        params={{ id: null, fcmId: 'vm-101', type: 'host_unreachable', node: 'vm-101', severity: 'critical' }}
      />,
    );
    expect(container.textContent).not.toMatch(/\d{1,2}:\d{2}/);
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
