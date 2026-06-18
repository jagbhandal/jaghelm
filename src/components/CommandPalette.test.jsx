import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import CommandPalette from './CommandPalette';
import { ConfigProvider } from '../context/ConfigContext.jsx';
import { THEMES } from './settings/themes.js';

const renderPalette = (props = {}, config = {}) => {
  const handlers = {
    open: true,
    onClose: vi.fn(),
    tabs: [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'media', label: 'Media' },
    ],
    onSelectTab: vi.fn(),
    onOpenSettings: vi.fn(),
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
          tabs={[]}
          onSelectTab={() => {}}
          onOpenSettings={() => {}}
          theme="dark"
          setTheme={() => {}}
        />
      </ConfigProvider>
    );
    expect(container.querySelector('.cmdk')).toBeNull();
  });

  it('opens as a combobox listing tabs, Settings, and themes', () => {
    renderPalette();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    const list = screen.getByRole('listbox');
    expect(within(list).getByText('Dashboard')).toBeInTheDocument();
    expect(within(list).getByText('Media')).toBeInTheDocument();
    expect(within(list).getByText('Settings')).toBeInTheDocument();
    expect(within(list).getByText(THEMES[0].name)).toBeInTheDocument();
  });

  it('filters the list as you type', async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.type(screen.getByRole('combobox'), 'media');
    const opts = screen.getAllByRole('option');
    expect(opts).toHaveLength(1);
    expect(opts[0]).toHaveTextContent('Media');
  });

  it('runs the active command on Enter and closes', async () => {
    const user = userEvent.setup();
    const h = renderPalette();
    await user.type(screen.getByRole('combobox'), 'media');
    await user.keyboard('{Enter}');
    expect(h.onSelectTab).toHaveBeenCalledWith('media');
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
    await user.click(screen.getByText(target.name));
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
