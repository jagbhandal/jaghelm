import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import CommandPalette from './CommandPalette';
import { ConfigProvider } from '../context/ConfigContext.jsx';
import { scenarioStatus } from '../../server/testing/statusScenarios.js';

// The palette wired (#315): what it finds from the status, the config and the
// pages, and what each kind of row does with it. src/App.palette.test.jsx
// opens each kind from the app itself; src/ui/command-palette.test.jsx checks
// the look and the keys.

const STATUS = scenarioStatus('every-state', { now: 1_782_345_600_000 });

const renderPalette = (props = {}, config = {}) => {
  const handlers = {
    open: true,
    onClose: vi.fn(),
    pages: [
      { id: 'overview', label: 'Overview', href: '/' },
      { id: 'alerts', label: 'Alerts', href: '/alerts' },
      { id: 'settings', label: 'Settings', href: '/settings' },
    ],
    apps: [{ id: 'media', label: 'Media', href: '/apps/media' }],
    status: STATUS,
    onNavigate: vi.fn(),
    onLogout: vi.fn(),
    ...props,
  };
  render(
    <ConfigProvider config={{ links: {}, ...config }} setConfig={vi.fn()}>
      <CommandPalette {...handlers} />
    </ConfigProvider>
  );
  return handlers;
};

const headings = () =>
  screen
    .getAllByRole('group')
    .map((g) => document.getElementById(g.getAttribute('aria-labelledby')).textContent);

describe('CommandPalette', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ConfigProvider config={{ links: {} }} setConfig={vi.fn()}>
        <CommandPalette open={false} onClose={() => {}} onNavigate={() => {}} />
      </ConfigProvider>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('lists the issues first, then the entities, pages, apps, Settings, Quick Launch and Log out', () => {
    renderPalette({}, { links: { apps: [{ name: 'Grafana', url: 'https://grafana.lan' }] } });
    expect(headings()).toEqual([
      'Issues',
      'Services',
      'Nodes',
      'Power',
      'Jobs',
      'Backups',
      'Integrations',
      'Pages',
      'Apps',
      'Settings',
      'Quick Launch',
      'Actions',
    ]);
    expect(screen.getAllByRole('option')[0]).toHaveAccessibleName(
      /^Network Edge, Issue, Unreachable/
    );
  });

  it('has no themes: the header and Settings → Appearance switch them', async () => {
    const user = userEvent.setup();
    renderPalette();
    const labels = screen.getAllByRole('option').map((o) => o.textContent);
    expect(labels.some((l) => /^(Dark|Light)/.test(l))).toBe(false);
    // "system" finds Settings → System, the section, then Appearance, where
    // the System theme is chosen; no theme.
    await user.type(screen.getByRole('combobox'), 'system');
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('href'))).toEqual([
      '/settings/system',
      '/settings/appearance',
    ]);
  });

  it('a page command opens its route', async () => {
    const user = userEvent.setup();
    const h = renderPalette();
    await user.type(screen.getByRole('combobox'), 'alerts');
    await user.keyboard('{Enter}');
    expect(h.onNavigate).toHaveBeenCalledWith('/alerts');
    expect(h.onClose).toHaveBeenCalled();
  });

  it('filters the list as you type, starting each time from an empty query', async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.type(screen.getByRole('combobox'), 'media');
    const opts = screen.getAllByRole('option');
    expect(opts).toHaveLength(1);
    expect(opts[0]).toHaveTextContent('Open Media');
  });

  it('an app opens inside JagHelm', async () => {
    const user = userEvent.setup();
    const h = renderPalette();
    await user.type(screen.getByRole('combobox'), 'media');
    await user.keyboard('{Enter}');
    expect(h.onNavigate).toHaveBeenCalledWith('/apps/media');
  });

  it('a Settings section opens at /settings/<section>', async () => {
    const user = userEvent.setup();
    const h = renderPalette();
    await user.type(screen.getByRole('combobox'), 'appearance');
    expect(
      screen.getByRole('option', { name: /^Appearance, Settings, Theme, custom themes, accent/ })
    ).toHaveAttribute('href', '/settings/appearance');
    await user.keyboard('{Enter}');
    expect(h.onNavigate).toHaveBeenCalledWith('/settings/appearance');
  });

  it('an entity is a link to its detail over the page under the palette', () => {
    window.history.replaceState(null, '', '/alerts');
    renderPalette();
    const services = screen.getAllByRole('group')[1];
    expect(within(services).getByRole('option', { name: /^Grafana, Service/ })).toHaveAttribute(
      'href',
      '/alerts?entity=services/apps:grafana'
    );
  });

  it('lists the Quick Launch links with their group and host, opening where Settings → Apps & links says', () => {
    renderPalette(
      {},
      {
        links: { devops: [{ name: 'Grafana', url: 'https://grafana.lan' }] },
        linkTarget: '_self',
      }
    );
    const link = screen.getByRole('option', {
      name: 'Open Grafana, Link, Dev & Monitoring, grafana.lan',
    });
    expect(link).toHaveAttribute('href', 'https://grafana.lan');
    expect(link).toHaveAttribute('target', '_self');
  });

  it('a stale status draws its lamps as no signal', () => {
    renderPalette({ stale: true });
    const lamps = screen.getByRole('listbox').querySelectorAll('[data-slot="status-lamp"]');
    expect(lamps.length).toBeGreaterThan(0);
    expect([...lamps].every((l) => l.getAttribute('data-state') === 'unknown')).toBe(true);
    expect(screen.getAllByRole('option')[0]).toHaveAccessibleName(
      /^Network Edge, Issue, No signal/
    );
  });

  it('draws in the shell’s theme', () => {
    renderPalette({ switches: { theme: 'light' } });
    expect(screen.getByRole('dialog').closest('.jh-ui')).toHaveAttribute('data-theme', 'light');
  });
});
