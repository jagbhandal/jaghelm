import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const { openTarget } = vi.hoisted(() => ({ openTarget: vi.fn() }));
vi.mock('../open.js', () => ({ openTarget }));
vi.mock('@shared/hooks/useData.js', () => ({ getServiceIcon: () => null }));

import Overview from './Overview.jsx';

// Build a services snapshot with `downCount` down services + one healthy service.
function makeData(downCount, extra = {}) {
  const services = [];
  for (let i = 0; i < downCount; i++) {
    services.push({ uid: `vm-101:s${i}`, container: `s${i}`, display_name: `Svc ${i}`, icon: null, status: 'down', ping: null, uptime24: 0.4, url: `http://h/s${i}` });
  }
  services.push({ uid: 'vm-101:ok', container: 'ok', display_name: 'Ok', icon: null, status: 'up', ping: 5, uptime24: 0.999, url: '' });
  return {
    servicesBody: { nodes: { 'vm-101': { display_name: 'VM 101', subtitle: 'app', metrics: { cpu: '45.3', memPercent: '31.2' }, services } } },
    ups: { status: 1, charge: 100 }, cron: [], loading: false, error: null, ...extra,
  };
}

describe('Overview', () => {
  beforeEach(() => openTarget.mockReset());

  it('renders hero + 2×2 cells + Active issues (no per-node bar list — Bug #10)', () => {
    render(<Overview data={makeData(1)} nav={{ push: vi.fn() }} />);
    // Hero
    expect(document.querySelector('.sys-status-card')).not.toBeNull();
    // Cells
    expect(screen.getByText('Services')).toBeInTheDocument();
    expect(document.querySelectorAll('.subsystem-cell').length).toBe(4);
    // Active issue (down service) — assert via the row name (the hero subline
    // also names the single down service, so scope to the issue row).
    expect(document.querySelector('.issue-row__name').textContent).toBe('Svc 0');
    // Bug #10: the old per-node CPU/MEM bar list is GONE.
    expect(document.querySelector('.node-row')).toBeNull();
    expect(document.querySelector('.node-row__bars')).toBeNull();
    expect(document.querySelector('.overview-nodes')).toBeNull();
    expect(document.querySelector('.usage-bar')).toBeNull();
  });

  it('down → red hero (color-spanned word) + Services cell DOWN + down IssueRow with cause', () => {
    render(<Overview data={makeData(2)} nav={{ push: vi.fn() }} />);
    const headline = document.querySelector('.sys-status-card__headline');
    expect(headline.textContent).toBe('Two services down');
    const word = document.querySelector('.sys-status-card__word');
    expect(word).not.toBeNull();
    expect(word.textContent).toBe('down');
    expect(word.className).toMatch(/sys-status-card__word--critical/);

    // Services cell shows the red DOWN word.
    const svcCell = screen.getByText('Services').closest('.subsystem-cell');
    expect(within(svcCell).getByText('DOWN')).toBeInTheDocument();

    // Down IssueRow shows the cause (only critical rows show a cause line).
    const row = screen.getByText('Svc 0').closest('.issue-row');
    expect(row.className).toMatch(/issue-row--critical/);
    expect(within(row).getByText('Service is down')).toBeInTheDocument();
  });

  it('tapping a down issue row opens its target', () => {
    render(<Overview data={makeData(1)} nav={{ push: vi.fn() }} />);
    fireEvent.click(document.querySelector('.issue-row'));
    expect(openTarget).toHaveBeenCalled();
  });

  it('healthy → green hero + the 🌙 clear state, no issue rows', () => {
    render(<Overview data={makeData(0)} nav={{ push: vi.fn() }} />);
    expect(document.querySelector('.sys-status-card__headline').textContent).toBe("Everything's healthy");
    expect(screen.getByText(/Nothing on fire/)).toBeInTheDocument();
    expect(document.querySelector('.issue-row')).toBeNull();
  });

  it('unreachable (error set) → steel "No signal" hero + cells NO SIGNAL even with stale data (Bug #4)', () => {
    // Stale non-null servicesBody is still in hand, but a live error forces NO SIGNAL.
    const errorData = makeData(0, { error: new Error('fetch failed') });
    render(<Overview data={errorData} nav={{ push: vi.fn() }} />);

    expect(document.querySelector('.sys-status-card__headline').textContent).toBe('No signal');
    expect(document.querySelector('.sys-status-card').className).toMatch(/sys-status-card--unknown/);

    // Every cell reads NO SIGNAL (steel), NOT green — the Bug #4 regression guard.
    const svcCell = screen.getByText('Services').closest('.subsystem-cell');
    expect(within(svcCell).getByText('NO SIGNAL')).toBeInTheDocument();
    expect(svcCell.className).not.toMatch(/subsystem-cell--healthy/);
    expect(document.querySelectorAll('.subsystem-cell--unknown').length).toBe(4);

    // Reused error banner; no issue rows while unreachable.
    expect(screen.getByRole('alert').textContent).toMatch(/Couldn't reach JagHelm/);
    expect(document.querySelector('.issue-row')).toBeNull();
  });

  it('error with no prior data → steel hero + error banner', () => {
    const noData = { servicesBody: null, ups: null, cron: null, loading: false, error: new Error('fail') };
    render(<Overview data={noData} nav={{ push: vi.fn() }} />);
    expect(document.querySelector('.sys-status-card__headline').textContent).toBe('No signal');
    expect(screen.getByRole('alert').textContent).toBe("Couldn't reach JagHelm");
  });

  it('loading with no data → Loading… and no clear state', () => {
    const loadingData = { servicesBody: null, ups: null, cron: null, loading: true, error: null };
    render(<Overview data={loadingData} nav={{ push: vi.fn() }} />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing on fire/)).toBeNull();
  });
});
