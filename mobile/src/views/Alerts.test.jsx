import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { openTarget } = vi.hoisted(() => ({ openTarget: vi.fn() }));
vi.mock('../open.js', () => ({ openTarget }));

import Alerts from './Alerts.jsx';
import { STALE, UPS_ONLINE, boardOf, inputs, monitored, node } from '../testing/board.js';

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

describe('Alerts', () => {
  it('pins the active incident at top under Active heading', () => {
    render(<Alerts data={DATA} nav={{ push: vi.fn() }} />);
    expect(screen.getByText(/Active/i)).toBeInTheDocument();
    expect(screen.getAllByText('Gitea').length).toBeGreaterThanOrEqual(1);
    // History is empty-by-design; "Today" is NOT shown as a day-group heading
    const headings = screen.getAllByRole('heading');
    const dayHeading = headings.find((h) => /Today/i.test(h.textContent));
    expect(dayHeading).toBeFalsy();
  });

  it('the gear is enabled and pushes the notificationSettings screen on tap', () => {
    const push = vi.fn();
    render(<Alerts data={DATA} nav={{ push }} />);
    const gear = screen.getByRole('button', { name: /notification settings/i });
    expect(gear).not.toBeDisabled();
    fireEvent.click(gear);
    expect(push).toHaveBeenCalledWith('notificationSettings');
  });

  it('tapping an incident pushes its detail', () => {
    const push = vi.fn();
    render(<Alerts data={DATA} nav={{ push }} />);
    // Active row has "(active)" appended; click it to trigger nav
    fireEvent.click(screen.getByRole('button', { name: 'Gitea, Service · vm-101 (active)' }));
    expect(push).toHaveBeenCalledWith('incident', { id: 'services/vm-101:gitea' });
  });

  // Bug #3: history de-dup — active incidents are NOT repeated in history section
  it('active incident is NOT repeated in the history section (de-dup)', () => {
    render(<Alerts data={DATA} nav={{ push: vi.fn() }} />);
    // With history de-dup, Gitea appears only once (in the Active section, not history)
    expect(screen.getAllByText('Gitea').length).toBe(1);
  });

  // History empty-by-design (§13 decision #3)
  it('shows the history empty-state copy when all incidents are active', () => {
    render(<Alerts data={DATA} nav={{ push: vi.fn() }} />);
    expect(screen.getByText('No earlier alerts this session.')).toBeInTheDocument();
  });

  // Active cards must show cause (Bug #8): the model's reason.
  it('active incident row shows where it is and the model\'s reason', () => {
    render(<Alerts data={DATA} nav={{ push: vi.fn() }} />);
    const activeRow = screen.getByRole('button', { name: /Gitea.*active/i });
    expect(activeRow.querySelector('.alert-row__node').textContent).toBe('Service · vm-101');
    expect(activeRow.querySelector('.alert-row__cause').textContent).toBe('Kuma: down');
  });

  it('shows an empty state when nothing is wrong', () => {
    const calm = boardOf(inputs({ nodes: { 'vm-101': node({}, { display_name: 'VM 101' }) }, ups: UPS_ONLINE }));
    render(<Alerts data={calm} nav={{ push: vi.fn() }} />);
    expect(screen.getByText(/All clear/i)).toBeInTheDocument();
  });

  it('an empty board (#449) says "Nothing monitored yet", never all clear', () => {
    const empty = boardOf(
      inputs({
        nodes: {},
        services: { nodes: {}, overallHealth: 'unknown', sources: { prometheus: { ok: true } } },
        ups: { status: null, charge: null, runtime: null, load: null, ok: true, configured: false, model: null },
      })
    );
    render(<Alerts data={empty} nav={{ push: vi.fn() }} />);
    expect(screen.getByText('Nothing monitored yet')).toBeInTheDocument();
    expect(screen.queryByText(/All clear/i)).toBeNull();
  });

  it('a stale status (#480) lists nothing as active and says nothing is clear', () => {
    render(<Alerts data={{ ...DATA, freshness: STALE }} nav={{ push: vi.fn() }} />);
    expect(screen.queryByRole('button', { name: /active/i })).toBeNull();
    expect(screen.queryByText(/All clear/i)).toBeNull();
  });

  it('shows error banner and NOT all-clear when backend unreachable (has prior data)', () => {
    const errData = { ...DATA, error: new Error('network error'), freshness: STALE };
    render(<Alerts data={errData} nav={{ push: vi.fn() }} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toMatch(/Couldn't reach JagHelm/);
    expect(screen.queryByText(/All clear/i)).toBeNull();
  });

  it('shows error banner without "showing last known data" when no prior data', () => {
    const errNoData = { status: null, servicesBody: null, loading: false, error: new Error('fail'), freshness: STALE };
    render(<Alerts data={errNoData} nav={{ push: vi.fn() }} />);
    const banner = screen.getByRole('alert');
    expect(banner.textContent).toBe("Couldn't reach JagHelm");
    expect(banner.textContent).not.toMatch(/last known/i);
  });

  it('shows loading state and NOT all-clear when loading with no data', () => {
    const loading = { status: null, servicesBody: null, loading: true, error: null };
    render(<Alerts data={loading} nav={{ push: vi.fn() }} />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
    expect(screen.queryByText(/All clear/i)).toBeNull();
  });

  it('gear button does not have disabled attribute (always active)', () => {
    render(<Alerts data={DATA} nav={{ push: vi.fn() }} />);
    const gear = screen.getByRole('button', { name: /notification settings/i });
    expect(gear).not.toHaveAttribute('disabled');
  });
});
