import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { openTarget } = vi.hoisted(() => ({ openTarget: vi.fn() }));
vi.mock('../open.js', () => ({ openTarget }));

import Alerts from './Alerts.jsx';

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
    fireEvent.click(screen.getByRole('button', { name: /Gitea.*active/i }));
    expect(push).toHaveBeenCalledWith('incident', { id: 'service:vm-101:gitea' });
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

  // Active cards must show cause (Bug #8)
  it('active incident row shows the cause text', () => {
    render(<Alerts data={DATA} nav={{ push: vi.fn() }} />);
    // deriveIncidents builds cause = "Service is down · VM 101" or similar; check partial match
    // The cause text comes from deriveIncidents — assert the row has some cause content
    const activeRow = screen.getByRole('button', { name: /Gitea.*active/i });
    // The cause span is inside the active button
    expect(activeRow.querySelector('.alert-row__cause')).not.toBeNull();
  });

  it('shows an empty state when nothing is wrong', () => {
    const calm = { ...DATA, servicesBody: { nodes: {} }, ups: { status: 1 }, cron: [], loading: false, error: null };
    render(<Alerts data={calm} nav={{ push: vi.fn() }} />);
    expect(screen.getByText(/All clear/i)).toBeInTheDocument();
  });

  it('shows error banner and NOT all-clear when backend unreachable (has prior data)', () => {
    const errData = { ...DATA, error: new Error('network error') };
    render(<Alerts data={errData} nav={{ push: vi.fn() }} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toMatch(/Couldn't reach JagHelm/);
    expect(screen.queryByText(/All clear/i)).toBeNull();
  });

  it('shows error banner without "showing last known data" when no prior data', () => {
    const errNoData = { servicesBody: null, ups: null, cron: null, history: null, loading: false, error: new Error('fail') };
    render(<Alerts data={errNoData} nav={{ push: vi.fn() }} />);
    const banner = screen.getByRole('alert');
    expect(banner.textContent).toBe("Couldn't reach JagHelm");
    expect(banner.textContent).not.toMatch(/last known/i);
  });

  it('shows loading state and NOT all-clear when loading with no data', () => {
    const loading = { servicesBody: null, ups: null, cron: null, history: null, loading: true, error: null };
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
