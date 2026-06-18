import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import NavBar from './NavBar';
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
});
