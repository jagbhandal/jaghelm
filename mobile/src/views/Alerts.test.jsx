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
  it('pins the active incident at top and shows a day section', () => {
    render(<Alerts data={DATA} nav={{ push: vi.fn() }} />);
    expect(screen.getByText(/Active/i)).toBeInTheDocument();
    expect(screen.getAllByText('Gitea').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Today/i)).toBeInTheDocument();
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

  it('history rows show the service title', () => {
    render(<Alerts data={DATA} nav={{ push: vi.fn() }} />);
    // Both active and history rows render Gitea; getAllByText confirms title appears in history too
    expect(screen.getAllByText('Gitea').length).toBeGreaterThanOrEqual(2);
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

  it('history day section heading uses formatDayLabel (Today for current-day incidents)', () => {
    render(<Alerts data={DATA} nav={{ push: vi.fn() }} />);
    // All Phase-3 incidents are stamped now, so the history heading must say "Today"
    const headings = screen.getAllByRole('heading');
    const dayHeading = headings.find((h) => /Today/i.test(h.textContent));
    expect(dayHeading).toBeTruthy();
  });
});
