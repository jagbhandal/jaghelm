import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../testing/render.js';

const { openTarget } = vi.hoisted(() => ({ openTarget: vi.fn() }));
vi.mock('../open.js', () => ({ openTarget }));

import IncidentDetail from '@shared/phone/views/IncidentDetail.jsx';
import { STALE, UPS_ONLINE, boardOf, cronNode, cronRun, inputs, monitored, node } from '../testing/board.js';

const DATA = boardOf(
  inputs({
    nodes: {
      'vm-101': node({}, {
        display_name: 'VM 101',
        services: [monitored('vm-101:gitea', 'down', { display_name: 'Gitea', uptime24: 0.42, url: 'http://h/gitea' })],
      }),
    },
    ups: UPS_ONLINE,
  })
);

const pad = (x) => String(x).padStart(2, '0');
const clockOf = (ts) => { const d = new Date(Number(ts)); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

describe('IncidentDetail — one of the model\'s issues (honest numbers)', () => {
  beforeEach(() => openTarget.mockReset());

  it('shows status word / node / cause / uptime + Open + back', () => {
    const pop = vi.fn();
    render(<IncidentDetail data={DATA} nav={{ pop }} params={{ id: 'services/vm-101:gitea' }} />);
    expect(screen.getByText('Gitea')).toBeInTheDocument();             // header title
    expect(screen.getByText('Service · vm-101')).toBeInTheDocument();  // where
    expect(screen.getByText('Kuma: down')).toBeInTheDocument();        // the model's reason
    expect(screen.getByText('42.0%')).toBeInTheDocument();            // uptime ring
    expect(screen.getByText('DOWN', { selector: '.status-word' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(openTarget).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(pop).toHaveBeenCalled();
  });

  it('Bug #2: removes the "Pending — push pipeline lands in Phase 5" dev string', () => {
    render(<IncidentDetail data={DATA} nav={{ pop: vi.fn() }} params={{ id: 'services/vm-101:gitea' }} />);
    expect(screen.queryByText(/Phase 5/i)).toBeNull();
    expect(screen.queryByText(/Pending/i)).toBeNull();
  });

  it('Bug #14: renders NO fabricated clock for a derived incident', () => {
    const { container } = render(<IncidentDetail data={DATA} nav={{ pop: vi.fn() }} params={{ id: 'services/vm-101:gitea' }} />);
    expect(screen.queryByText(/Detected/i)).toBeNull();
    expect(container.textContent).not.toMatch(/\d{1,2}:\d{2}/);
    // Instead: a single clock-less status line.
    expect(screen.getByText('Active — Service · vm-101')).toBeInTheDocument();
  });

  it('renders the uptime ring without a jammed "24H uptime42.0%" string (Bug #1)', () => {
    render(<IncidentDetail data={DATA} nav={{ pop: vi.fn() }} params={{ id: 'services/vm-101:gitea' }} />);
    expect(screen.queryByText(/uptime42/i)).toBeNull();
    expect(screen.getByText('42.0%')).toBeInTheDocument();
    expect(screen.getByText('24H')).toBeInTheDocument();
  });

  it('Bug #9: demotes Open to the secondary ghost variant', () => {
    render(<IncidentDetail data={DATA} nav={{ pop: vi.fn() }} params={{ id: 'services/vm-101:gitea' }} />);
    expect(screen.getByRole('button', { name: 'Open' }).className).toMatch(/open-btn--ghost/);
  });

  it('does not render a Mute button (read-only)', () => {
    render(<IncidentDetail data={DATA} nav={{ pop: vi.fn() }} params={{ id: 'services/vm-101:gitea' }} />);
    expect(screen.queryByRole('button', { name: /mute/i })).toBeNull();
  });

  it('handles a resolved/stale incident id gracefully', () => {
    render(<IncidentDetail data={DATA} nav={{ pop: vi.fn() }} params={{ id: 'services/gone:x' }} />);
    expect(screen.getByText(/has resolved/i)).toBeInTheDocument();
  });

  it('a stale status keeps the issue\'s words, its lamp no signal (#480)', () => {
    render(<IncidentDetail data={{ ...DATA, freshness: STALE }} nav={{ pop: vi.fn() }} params={{ id: 'services/vm-101:gitea' }} />);
    expect(screen.getByText('DOWN', { selector: '.status-word' }).className).toMatch(/word--unknown/);
    expect(document.querySelector('.detail-head .status-lamp').getAttribute('class')).toMatch(/lamp--unknown/);
  });

  const onBatteryAt = (runtime, extra) => boardOf(
    inputs({ nodes: { 'vm-101': node({}, { display_name: 'VM 101' }) }, ups: { ...UPS_ONLINE, status: 2, charge: 47.6, runtime } }),
    extra
  );

  it('the UPS on battery: the model\'s reason, and the model\'s runtime left, with no /api/ups (#549)', () => {
    const { unmount } = render(<IncidentDetail data={onBatteryAt(480, { ups: null })} nav={{ pop: vi.fn() }} params={{ id: 'power/ups' }} />);
    expect(screen.getByText('On battery (47 % charge)')).toBeInTheDocument();
    expect(screen.getByText('8 min left')).toBeInTheDocument();
    unmount();
    // No runtime reading in the model now: the reason alone, whatever /api/ups says.
    render(<IncidentDetail data={onBatteryAt(null, { ups: { ...UPS_ONLINE, status: 2, runtime: 480 } })} nav={{ pop: vi.fn() }} params={{ id: 'power/ups' }} />);
    expect(screen.getByText('On battery (47 % charge)')).toBeInTheDocument();
    expect(screen.queryByText(/min left/)).toBeNull();
  });

  it('the UPS on battery, the status stale: its words kept, no runtime (#549)', () => {
    render(<IncidentDetail data={onBatteryAt(480, { freshness: STALE })} nav={{ pop: vi.fn() }} params={{ id: 'power/ups' }} />);
    expect(screen.getByText('On battery (47 % charge)')).toBeInTheDocument();
    expect(screen.queryByText(/min left/)).toBeNull();
  });

  it('a server before #549 (no runtimeMinutes): the runtime from /api/ups, none without its answer', () => {
    const older = (data) => {
      for (const e of [...data.status.entities, ...data.status.issues]) delete e.runtimeMinutes;
      return data;
    };
    const { unmount } = render(<IncidentDetail data={older(onBatteryAt(480))} nav={{ pop: vi.fn() }} params={{ id: 'power/ups' }} />);
    expect(screen.getByText('8 min left')).toBeInTheDocument();
    unmount();
    render(<IncidentDetail data={older(onBatteryAt(480, { ups: null }))} nav={{ pop: vi.fn() }} params={{ id: 'power/ups' }} />);
    expect(screen.getByText('On battery (47 % charge)')).toBeInTheDocument();
    expect(screen.queryByText('8 min left')).toBeNull();
  });

  it('a job the model files as a backup opens from its job id, as a push names it', () => {
    const backup = boardOf(
      inputs({
        nodes: { pve: node({}, { display_name: 'pve' }) },
        ups: UPS_ONLINE,
        cron: [cronNode('pve', { 'proxmox-backup': cronRun('failure', 60_000, { error: 'exit 2' }) })],
        backupJobs: ['pve:proxmox-backup'],
      })
    );
    const issue = backup.status.issues.find((i) => i.kind === 'backup');
    expect(issue.id).toBe('backups/pve:proxmox-backup');
    render(<IncidentDetail data={backup} nav={{ pop: vi.fn() }} params={{ id: 'jobs/pve:proxmox-backup' }} />);
    expect(screen.getByText(issue.reason)).toBeInTheDocument();
    expect(screen.queryByText(/has resolved/i)).toBeNull();
  });
});

describe('IncidentDetail — push-event fallback (real timestamp only)', () => {
  const liveData = boardOf(
    inputs({
      nodes: { 'vm-101': node({}, { display_name: 'VM 101', services: [monitored('vm-101:nginx', 'down', { display_name: 'nginx', uptime24: 0.5 })] }) },
      ups: UPS_ONLINE,
    })
  );
  const calmData = boardOf(inputs({ nodes: { 'vm-101': node({}, { display_name: 'VM 101' }) }, ups: UPS_ONLINE }));

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
        params={{ id: 'services/vm-101:nginx', fcmId: 'vm-101:nginx', type: 'service_down', node: 'vm-101', severity: 'critical' }}
      />,
    );
    expect(screen.getByText('nginx')).toBeInTheDocument(); // live incident title (display_name)
    expect(screen.queryByText(/This incident has resolved/i)).toBeNull();
  });

  it('falls back to the resolved copy ONLY when there is neither a live incident nor push params', () => {
    render(<IncidentDetail nav={{ pop: vi.fn() }} data={calmData} params={{ id: 'services/gone' }} />);
    expect(screen.getByText(/This incident has resolved/i)).toBeInTheDocument();
  });
});
