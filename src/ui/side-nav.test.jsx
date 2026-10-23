import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Bell, LayoutDashboard } from 'lucide-react';
import { NavGroups, SideNav, appMonogram } from '@ui/side-nav';

const groups = ({ onUnload = vi.fn(), current = 'grafana' } = {}) => [
  {
    id: 'monitor',
    label: 'Monitor',
    items: [
      {
        id: 'overview',
        label: 'Overview',
        href: '/',
        icon: <LayoutDashboard aria-hidden="true" />,
      },
      {
        id: 'alerts',
        label: 'Alerts',
        href: '/alerts',
        icon: <Bell aria-hidden="true" />,
        current: current === 'alerts',
        badge: { count: 4, state: 'crit', label: '4 issues' },
      },
    ],
  },
  {
    id: 'apps',
    label: 'Apps',
    items: [
      {
        id: 'grafana',
        label: 'Grafana',
        href: '/apps/grafana',
        monogram: 'Gr',
        current: current === 'grafana',
      },
      {
        id: 'kuma',
        label: 'Uptime Kuma',
        href: '/apps/kuma',
        monogram: 'UK',
        loaded: true,
        onUnload,
      },
      { id: 'add', label: 'Add app', href: '/settings/tabs', minor: true },
    ],
  },
];

const nav = () => screen.getByRole('navigation', { name: 'Main' });
const link = (name) => within(nav()).getByRole('link', { name });

describe('appMonogram', () => {
  it("is an app's initials, or its first two letters", () => {
    expect(appMonogram('Home Assistant')).toBe('HA');
    expect(appMonogram('Uptime kuma')).toBe('UK');
    expect(appMonogram('Grafana')).toBe('Gr');
    expect(appMonogram('  arcane ')).toBe('Ar');
    expect(appMonogram('X')).toBe('X');
    expect(appMonogram('')).toBe('?');
    expect(appMonogram(undefined)).toBe('?');
  });
});

describe('SideNav', () => {
  it('is the Main navigation, its groups named by their labels', () => {
    render(<SideNav groups={groups()} />);
    expect(within(nav()).getAllByRole('group')).toHaveLength(2);
    expect(within(nav()).getByRole('group', { name: 'Monitor' })).toBeInTheDocument();
    expect(within(nav()).getByRole('group', { name: 'Apps' })).toBeInTheDocument();
  });

  it('marks the open page aria-current, in the accent tint, the others not', () => {
    render(<SideNav groups={groups()} />);
    expect(link('Grafana')).toHaveAttribute('aria-current', 'page');
    expect(link('Grafana')).toHaveClass('bg-accent-tint', 'text-text-1');
    expect(link('Overview')).not.toHaveAttribute('aria-current');
    expect(link('Overview')).toHaveClass('text-text-2');
    // The open app's chip takes the accent.
    expect(link('Grafana').querySelector('[data-slot="app-chip"]')).toHaveClass('bg-accent');
  });

  it("says Alerts' count in its name, on the state's tint", () => {
    render(<SideNav groups={groups()} />);
    const alerts = link('Alerts, 4 issues');
    const badge = alerts.querySelector('[data-slot="nav-badge"]');
    expect(badge).toHaveTextContent('4');
    expect(badge).toHaveClass('bg-crit-tint', 'text-crit-fg');
  });

  it('dots a loaded app, and its Unload unloads it and keeps focus on the entry', async () => {
    const user = userEvent.setup();
    const onUnload = vi.fn();
    render(<SideNav groups={groups({ onUnload })} />);
    const kuma = link('Uptime Kuma, still loaded');
    expect(kuma.querySelector('[data-slot="nav-loaded"]')).toBeInTheDocument();
    expect(link('Grafana').querySelector('[data-slot="nav-loaded"]')).toBeNull();
    await user.click(within(nav()).getByRole('button', { name: 'Unload Uptime Kuma' }));
    expect(onUnload).toHaveBeenCalledOnce();
    expect(kuma).toHaveFocus();
  });

  it('has no Unload on an app that is not loaded', () => {
    render(<SideNav groups={groups()} />);
    expect(within(nav()).getAllByRole('button', { name: /^Unload/ })).toHaveLength(1);
  });

  it('hands each click to onNavigate with its href', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn((e) => e.preventDefault());
    render(<SideNav groups={groups()} onNavigate={onNavigate} />);
    await user.click(link('Add app'));
    expect(onNavigate).toHaveBeenCalledWith(expect.anything(), '/settings/tabs');
  });

  it('collapses to icons: every entry keeps its name, the labels and Unload go', () => {
    render(<SideNav groups={groups()} collapsed onCollapsedChange={() => {}} />);
    expect(nav()).toHaveAttribute('data-collapsed', 'true');
    expect(nav()).toHaveClass('w-16');
    for (const name of ['Overview', 'Alerts, 4 issues', 'Grafana', 'Uptime Kuma, still loaded']) {
      expect(link(name)).toBeInTheDocument();
    }
    expect(screen.getByText('Monitor')).toHaveClass('sr-only');
    expect(within(nav()).queryByRole('button', { name: /^Unload/ })).toBeNull();
  });

  it('toggles collapsed with its button, when the caller keeps the choice', async () => {
    const user = userEvent.setup();
    const onCollapsedChange = vi.fn();
    const { rerender } = render(
      <SideNav groups={groups()} onCollapsedChange={onCollapsedChange} />
    );
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    rerender(<SideNav groups={groups()} collapsed onCollapsedChange={onCollapsedChange} />);
    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(onCollapsedChange).toHaveBeenLastCalledWith(false);
  });

  it('has no toggle without onCollapsedChange', () => {
    render(<SideNav groups={groups()} />);
    expect(screen.queryByRole('button', { name: /sidebar/ })).toBeNull();
  });
});

describe('NavGroups', () => {
  it('is the list alone, as the phone’s More sheet uses it', () => {
    render(<NavGroups groups={groups().slice(1)} />);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getByRole('group', { name: 'Apps' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Grafana' })).toHaveAttribute('href', '/apps/grafana');
  });
});

// #569: the phone's More sheet holds Log out, an action, not a page.
describe('an entry with onClick and no href', () => {
  it('is a button drawn as an entry, which runs it', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <NavGroups
        groups={[
          {
            id: 'tools',
            label: 'Tools',
            items: [
              { id: 'settings', label: 'Settings', href: '/settings' },
              { id: 'logout', label: 'Log out', onClick },
            ],
          },
        ]}
      />
    );
    const logout = screen.getByRole('button', { name: 'Log out' });
    expect(logout).toHaveAttribute('type', 'button');
    expect(logout).toHaveAttribute('data-slot', 'nav-item');
    expect(logout).not.toHaveAttribute('href');
    // Drawn as the links are.
    expect(logout).toHaveClass(...screen.getByRole('link', { name: 'Settings' }).classList);
    await user.click(logout);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
