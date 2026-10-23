import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import System from './System.jsx';
import AppsLinks from './AppsLinks.jsx';
import Appearance from './Appearance.jsx';
import { ConfigProvider } from '../../../context/ConfigContext.jsx';
import { OverlayProvider } from '../../../context/OverlayContext.jsx';

// Layout's settings went three ways in #317: the refresh interval to System,
// where links open to Apps & links, the temperature unit and the cards' blur
// to Appearance. `window.__config` is the latest.
function renderSection(Section, config = {}) {
  function Harness() {
    const [cfg, setCfg] = useState({ sections: {}, ...config });
    window.__config = cfg;
    return (
      <OverlayProvider>
        <ConfigProvider config={cfg} setConfig={setCfg}>
          <Section theme="dark" setTheme={vi.fn()} />
        </ConfigProvider>
      </OverlayProvider>
    );
  }
  return render(<Harness />);
}

describe('Settings → System', () => {
  it('has the password and sessions, the backup, and the data refresh', () => {
    renderSection(System, { refreshInterval: 45 });
    expect(screen.getByRole('region', { name: 'Password and sessions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Change Password' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Backup' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export Config' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Data refresh' })).toBeInTheDocument();
    // The slider is named by its label (Field labels the one control among its children).
    const interval = screen.getByRole('slider', { name: 'Auto-refresh Interval: 45s' });
    fireEvent.change(interval, { target: { value: '60' } });
    expect(window.__config.refreshInterval).toBe(60);
  });

  // The cards inside a part are its subheadings: the page is the h1.
  it('heads each part at h2 and the cards inside a part at h3', () => {
    renderSection(System);
    expect(screen.getByRole('heading', { name: 'Password and sessions' }).tagName).toBe('H2');
    expect(screen.getByRole('heading', { name: 'Change Password' }).tagName).toBe('H3');
    expect(screen.getByRole('heading', { name: 'Data refresh' }).tagName).toBe('H2');
  });
});

describe('what Layout had, where it went', () => {
  // #300: the board has no service cards; the Overview's Services section
  // lists the services, so the cards' options would change nothing.
  // #306: the old board's grid went with it; the Overview reflows, and
  // arranging comes back as Edit layout (Phase 5). Collapsible sections was
  // read by nothing.
  it('no section has the Service Cards options, the Grid card or Collapsible sections', () => {
    const old = {
      cardLayout: 'grid',
      statusStyle: 'dot',
      gridColumns: 12,
      gridLayout: { lg: [] },
      collapsibleSections: true,
    };
    for (const Section of [System, AppsLinks, Appearance]) {
      const view = renderSection(Section, old);
      expect(screen.queryByText('Service Cards')).toBeNull();
      for (const name of ['Card Layout', 'Status Style', 'Service Columns per Row'])
        expect(screen.queryByRole('group', { name })).toBeNull();
      expect(screen.queryByText(/Docker Metrics/)).toBeNull();
      expect(screen.queryByText(/App Integration Data/)).toBeNull();
      expect(screen.queryByText(/Grid Columns/)).toBeNull();
      expect(screen.queryByRole('button', { name: /Auto-arrange/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /Reset Grid Layout/ })).toBeNull();
      expect(screen.queryByText('Collapsible Sections')).toBeNull();
      view.unmount();
    }
  });

  it('the refresh is System’s, the link target Apps & links’, the units and blur Appearance’s', () => {
    let view = renderSection(System);
    expect(screen.getByText(/Auto-refresh Interval/)).toBeInTheDocument();
    view.unmount();
    view = renderSection(AppsLinks);
    expect(screen.getByRole('group', { name: 'Link Target' })).toBeInTheDocument();
    view.unmount();
    renderSection(Appearance);
    expect(screen.getByRole('radiogroup', { name: 'Temperature unit' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Card blur' })).toBeInTheDocument();
  });
});
