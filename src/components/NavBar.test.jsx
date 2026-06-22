import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import NavBar from './NavBar';
import { THEMES } from './settings/themes.js';
import { ConfigProvider } from '../context/ConfigContext.jsx';

// NavBar is config-driven: the title, the tab list, and feature toggles
// (search, weather) all come from `config`. NavBar now reads `config` from
// ConfigContext (not props), so we render it inside a ConfigProvider seeded with
// the same config the props used to carry. These tests lock in that the rendered
// output reflects config flags, so moving config into a context can't silently
// drop a feature. Weather pulls /api/weather, so we stub fetch.

const baseConfig = (configOverrides = {}) => ({
  title: 'MY HELM',
  showSearch: true,
  showWeather: false,
  links: {},
  ...configOverrides,
});

// Non-config NavBar props. Config is supplied via the ConfigProvider instead.
const baseProps = () => ({
  tabs: [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'media', label: 'Media' },
  ],
  activeTab: 'dashboard',
  onTabChange: vi.fn(),
  theme: 'dark',
  setTheme: vi.fn(),
  onToggleTheme: vi.fn(),
  health: 'up',
  lastUpdated: new Date(),
  refreshKey: 0,
});

// Render NavBar inside a ConfigProvider seeded with the given config.
const renderNav = (props = {}, config = baseConfig()) =>
  render(
    <ConfigProvider config={config} setConfig={vi.fn()}>
      <NavBar {...baseProps()} {...props} />
    </ConfigProvider>
  );

describe('NavBar', () => {
  beforeEach(() => {
    // Default: no weather payload. Individual tests override as needed.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: () => Promise.resolve({}),
        })
      )
    );
  });

  it('renders the title from config', () => {
    renderNav({}, baseConfig({ title: 'MY HELM' }));
    expect(screen.getByText('MY HELM')).toBeInTheDocument();
  });

  it('falls back to JAG-NET when config has no title', () => {
    renderNav({}, baseConfig({ title: '' }));
    expect(screen.getByText('JAG-NET')).toBeInTheDocument();
  });

  it('renders one tab per config-driven tab, marking the active one selected', () => {
    renderNav();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Media' })).toHaveAttribute('aria-selected', 'false');
  });

  it('shows the search box when showSearch is not false', () => {
    renderNav({}, baseConfig({ showSearch: true }));
    expect(screen.getByPlaceholderText(/search services or web/i)).toBeInTheDocument();
  });

  it('hides the search box when showSearch is false (feature toggle changes output)', () => {
    renderNav({}, baseConfig({ showSearch: false }));
    expect(screen.queryByPlaceholderText(/search services or web/i)).not.toBeInTheDocument();
  });

  it('reflects health status in the navbar label', () => {
    const config = baseConfig();
    const { rerender } = render(
      <ConfigProvider config={config} setConfig={vi.fn()}>
        <NavBar {...baseProps()} health="up" />
      </ConfigProvider>
    );
    expect(screen.getByText('All Systems Operational')).toBeInTheDocument();
    rerender(
      <ConfigProvider config={config} setConfig={vi.fn()}>
        <NavBar {...baseProps()} health="down" />
      </ConfigProvider>
    );
    expect(screen.getByText('Service Disruption')).toBeInTheDocument();
  });

  it('exposes the health label as a polite live region so status flips are announced', () => {
    renderNav({}, baseConfig());
    // The health label must be a role="status" aria-live="polite" region; otherwise
    // a screen-reader user gets no notice when overall health flips up/down/degraded.
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('All Systems Operational');
  });

  it('renders weather temp once weather loads when showWeather is enabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: () => Promise.resolve({ current: { temperature_2m: 72, weather_code: 0 } }),
        })
      )
    );
    renderNav(
      {},
      baseConfig({
        showWeather: true,
        weatherLat: '39.88',
        weatherLon: '-83.09',
        tempUnit: 'F',
        weatherCity: 'Grove City',
      })
    );
    // Weather is fetched in an effect, then setState — await the async update.
    expect(await screen.findByText('72°F')).toBeInTheDocument();
    expect(screen.getByText('Grove City')).toBeInTheDocument();
  });

  it('does not render weather when showWeather is false even with coords', () => {
    renderNav({}, baseConfig({ showWeather: false, weatherLat: '39.88', weatherLon: '-83.09' }));
    // No weather city/temp markup. fetch for weather should not be the path that renders it.
    expect(screen.queryByText(/°F/)).not.toBeInTheDocument();
  });

  // Link search: the live dropdown and the Enter (form-submit) handler must use
  // the SAME matcher. Previously the dropdown matched name OR url while Enter
  // matched name ONLY, so a url-only match shown in the dropdown was ignored by
  // Enter, which fell through to a web search. These tests lock the two in sync.
  describe('link search (dropdown ⇄ Enter agree)', () => {
    const linksConfig = () =>
      baseConfig({
        showSearch: true,
        links: {
          tools: [{ name: 'Photos', url: 'https://immich.example.com' }],
        },
      });

    it('opens a url-only match on Enter instead of falling through to web search', async () => {
      const user = userEvent.setup();
      const openSpy = vi.fn();
      vi.stubGlobal('open', openSpy);
      renderNav({}, linksConfig());
      const input = screen.getByPlaceholderText(/search services or web/i);
      // Query matches the link by URL only (its name is "Photos", not "immich").
      await user.type(input, 'immich');
      await user.keyboard('{Enter}');
      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(openSpy).toHaveBeenCalledWith('https://immich.example.com', '_blank');
    });

    it('surfaces a url-only match in the live dropdown', async () => {
      const user = userEvent.setup();
      renderNav({}, linksConfig());
      const input = screen.getByPlaceholderText(/search services or web/i);
      await user.type(input, 'immich');
      // The dropdown shows the link the Enter handler would open.
      expect(await screen.findByText('Photos')).toBeInTheDocument();
    });
  });

  // Mobile nav: .nav-tabs is hidden under 600px, so a hamburger menu is the only
  // way to switch tab on a phone. These tests lock in the menu existing, being
  // accessible, listing every tab, switching tab on tap, and closing correctly.
  describe('mobile nav menu', () => {
    it('renders a collapsed, accessible disclosure trigger', () => {
      renderNav();
      const btn = screen.getByRole('button', { name: /open navigation menu/i });
      expect(btn).toHaveAttribute('aria-haspopup', 'true');
      expect(btn).toHaveAttribute('aria-expanded', 'false');
      // Closed by default: the dropdown isn't rendered.
      expect(document.getElementById('nav-menu-dropdown')).toBeNull();
    });

    it('opens on click and lists one button per tab, marking the active one', async () => {
      const user = userEvent.setup();
      renderNav();
      const btn = screen.getByRole('button', { name: /open navigation menu/i });
      await user.click(btn);
      // Same node, label now reflects the "close" action.
      expect(btn).toHaveAttribute('aria-expanded', 'true');
      const dropdown = document.getElementById('nav-menu-dropdown');
      const items = within(dropdown).getAllByRole('button');
      expect(items).toHaveLength(2);
      expect(within(dropdown).getByRole('button', { name: 'Dashboard' })).toHaveAttribute(
        'aria-current',
        'page'
      );
      expect(within(dropdown).getByRole('button', { name: 'Media' })).not.toHaveAttribute(
        'aria-current'
      );
    });

    it('switches tab and closes the menu when an item is tapped', async () => {
      const user = userEvent.setup();
      const onTabChange = vi.fn();
      renderNav({ onTabChange });
      await user.click(screen.getByRole('button', { name: /open navigation menu/i }));
      const dropdown = document.getElementById('nav-menu-dropdown');
      await user.click(within(dropdown).getByRole('button', { name: 'Media' }));
      expect(onTabChange).toHaveBeenCalledWith('media');
      // Menu closes on selection.
      expect(document.getElementById('nav-menu-dropdown')).toBeNull();
    });

    it('flips its label, closes on Escape, and returns focus to the trigger', async () => {
      const user = userEvent.setup();
      renderNav();
      const btn = screen.getByRole('button', { name: /open navigation menu/i });
      await user.click(btn);
      expect(document.getElementById('nav-menu-dropdown')).not.toBeNull();
      // Label is state-aware: it advertises "Close" while open.
      expect(btn).toHaveAccessibleName(/close navigation menu/i);
      await user.keyboard('{Escape}');
      expect(document.getElementById('nav-menu-dropdown')).toBeNull();
      expect(btn).toHaveAttribute('aria-expanded', 'false');
      expect(btn).toHaveFocus();
    });
  });

  // Theme picker: the 🎨 button no longer blind-cycles themes — it opens a
  // popover of swatches so a specific theme is one click away. These tests lock
  // in the disclosure semantics, that every theme is offered, that the active
  // theme is marked, that picking one sets it directly (not by cycling), and
  // that Escape/outside-tap close it and return focus to the trigger.
  describe('theme picker', () => {
    it('renders a collapsed, accessible disclosure trigger', () => {
      renderNav();
      const btn = screen.getByRole('button', { name: /theme picker/i });
      expect(btn).toHaveAttribute('aria-haspopup', 'true');
      expect(btn).toHaveAttribute('aria-expanded', 'false');
      // Closed by default: the popover isn't rendered.
      expect(document.getElementById('nav-theme-popover')).toBeNull();
    });

    it('opens on click and offers one swatch per theme, marking the active one', async () => {
      const user = userEvent.setup();
      renderNav({ theme: 'dracula' });
      const btn = screen.getByRole('button', { name: /theme picker/i });
      await user.click(btn);
      // Same node, label now reflects the "close" action.
      expect(btn).toHaveAttribute('aria-expanded', 'true');
      expect(btn).toHaveAccessibleName(/close theme picker/i);
      const popover = document.getElementById('nav-theme-popover');
      const swatches = within(popover).getAllByRole('button');
      expect(swatches).toHaveLength(THEMES.length);
      // Each swatch's accessible name is the theme name.
      const dracula = THEMES.find((t) => t.id === 'dracula');
      expect(within(popover).getByRole('button', { name: dracula.name })).toHaveAttribute(
        'aria-current',
        'true'
      );
      // Non-active swatches don't claim aria-current.
      const other = THEMES.find((t) => t.id !== 'dracula');
      expect(within(popover).getByRole('button', { name: other.name })).not.toHaveAttribute(
        'aria-current'
      );
    });

    it('sets the chosen theme directly (by id, not by cycling) and closes', async () => {
      const user = userEvent.setup();
      const setTheme = vi.fn();
      // Start far from the target so a cycling impl couldn't reach it in one click.
      const target = THEMES[THEMES.length - 1];
      renderNav({ theme: THEMES[0].id, setTheme });
      await user.click(screen.getByRole('button', { name: /theme picker/i }));
      const popover = document.getElementById('nav-theme-popover');
      await user.click(within(popover).getByRole('button', { name: target.name }));
      // Direct set: called once with the target id (not an updater fn, not cycling).
      expect(setTheme).toHaveBeenCalledTimes(1);
      expect(setTheme).toHaveBeenCalledWith(target.id);
      // Popover closes on selection.
      expect(document.getElementById('nav-theme-popover')).toBeNull();
    });

    it('flips its label, closes on Escape, and returns focus to the trigger', async () => {
      const user = userEvent.setup();
      renderNav();
      const btn = screen.getByRole('button', { name: /theme picker/i });
      await user.click(btn);
      expect(document.getElementById('nav-theme-popover')).not.toBeNull();
      await user.keyboard('{Escape}');
      expect(document.getElementById('nav-theme-popover')).toBeNull();
      expect(btn).toHaveAttribute('aria-expanded', 'false');
      expect(btn).toHaveFocus();
    });
  });
});
