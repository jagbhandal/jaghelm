import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import CommandPalette from './CommandPalette';
import { ConfigProvider } from '../context/ConfigContext.jsx';
import { THEMES } from '../shell/theme.js';

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
    onNavigate: vi.fn(),
    theme: 'dark',
    setTheme: vi.fn(),
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

describe('CommandPalette', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ConfigProvider config={{ links: {} }} setConfig={vi.fn()}>
        <CommandPalette
          open={false}
          onClose={() => {}}
          onNavigate={() => {}}
          theme="dark"
          setTheme={() => {}}
        />
      </ConfigProvider>
    );
    expect(container.querySelector('.cmdk')).toBeNull();
  });

  it('opens as a combobox listing the pages, "Open <app>" for each app, and themes', () => {
    renderPalette();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    const list = screen.getByRole('listbox');
    expect(within(list).getByText('Overview')).toBeInTheDocument();
    expect(within(list).getByText('Alerts')).toBeInTheDocument();
    expect(within(list).getByText('Settings')).toBeInTheDocument();
    expect(within(list).getByText('Open Media')).toBeInTheDocument();
    for (const t of THEMES) expect(within(list).getByText(t.label)).toBeInTheDocument();
  });

  it('offers the three themes, Dark, Light and System, marking the current one', () => {
    renderPalette({ theme: 'system' });
    const list = screen.getByRole('listbox');
    const themes = THEMES.map((t) => within(list).getByText(t.label).closest('[role="option"]'));
    expect(themes.map((o) => o.textContent)).toEqual([
      'ThemeDark',
      'ThemeLight',
      'ThemeSystemcurrent',
    ]);
  });

  it('a page command opens its route', async () => {
    const user = userEvent.setup();
    const h = renderPalette();
    await user.type(screen.getByRole('combobox'), 'alerts');
    await user.keyboard('{Enter}');
    expect(h.onNavigate).toHaveBeenCalledWith('/alerts');
  });

  it('filters the list as you type', async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.type(screen.getByRole('combobox'), 'media');
    const opts = screen.getAllByRole('option');
    expect(opts).toHaveLength(1);
    expect(opts[0]).toHaveTextContent('Open Media');
  });

  it('runs the active command on Enter and closes', async () => {
    const user = userEvent.setup();
    const h = renderPalette();
    await user.type(screen.getByRole('combobox'), 'media');
    await user.keyboard('{Enter}');
    expect(h.onNavigate).toHaveBeenCalledWith('/apps/media');
    expect(h.onClose).toHaveBeenCalled();
  });

  it('Arrow keys move the active option (aria-activedescendant)', async () => {
    const user = userEvent.setup();
    renderPalette();
    const combo = screen.getByRole('combobox');
    await user.click(combo);
    expect(combo).toHaveAttribute('aria-activedescendant', 'cmdk-opt-0');
    await user.keyboard('{ArrowDown}');
    expect(combo).toHaveAttribute('aria-activedescendant', 'cmdk-opt-1');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('runs a theme command on click', async () => {
    const user = userEvent.setup();
    const target = THEMES[2];
    const h = renderPalette();
    await user.click(screen.getByText(target.label));
    expect(h.setTheme).toHaveBeenCalledWith(target.id);
    expect(h.onClose).toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const h = renderPalette();
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{Escape}');
    expect(h.onClose).toHaveBeenCalled();
  });

  it('lists configured links with a host hint', () => {
    renderPalette({}, { links: { apps: [{ name: 'Grafana', url: 'https://grafana.lan' }] } });
    expect(screen.getByText('Grafana')).toBeInTheDocument();
    expect(screen.getByText('grafana.lan')).toBeInTheDocument();
  });
});
