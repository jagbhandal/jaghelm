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
    expect(screen.getByText('Gitea')).toBeInTheDocument();
    expect(screen.getByText(/Today/i)).toBeInTheDocument();
  });

  it('renders a disabled, inert notification gear (Phase 5)', () => {
    render(<Alerts data={DATA} nav={{ push: vi.fn() }} />);
    const gear = screen.getByRole('button', { name: /notification settings/i });
    expect(gear).toBeDisabled();
  });

  it('tapping an incident pushes its detail', () => {
    const push = vi.fn();
    render(<Alerts data={DATA} nav={{ push }} />);
    fireEvent.click(screen.getByRole('button', { name: /Gitea/ }));
    expect(push).toHaveBeenCalledWith('incident', { id: 'service:vm-101:gitea' });
  });

  it('shows an empty state when nothing is wrong', () => {
    const calm = { ...DATA, servicesBody: { nodes: {} }, ups: { status: 1 }, cron: [] };
    render(<Alerts data={calm} nav={{ push: vi.fn() }} />);
    expect(screen.getByText(/All clear/i)).toBeInTheDocument();
  });

  it('history day section heading uses formatDayLabel (Today for current-day incidents)', () => {
    render(<Alerts data={DATA} nav={{ push: vi.fn() }} />);
    // All Phase-3 incidents are stamped now, so the history heading must say "Today"
    const headings = screen.getAllByRole('heading');
    const dayHeading = headings.find((h) => /Today/i.test(h.textContent));
    expect(dayHeading).toBeTruthy();
  });
});
