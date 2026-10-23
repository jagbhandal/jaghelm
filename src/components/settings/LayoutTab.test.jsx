import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import LayoutTab from './LayoutTab.jsx';
import { ConfigProvider } from '../../context/ConfigContext.jsx';
import { OverlayProvider } from '../../context/OverlayContext.jsx';

function renderTab(config = {}) {
  return render(
    <ConfigProvider config={{ sections: {}, ...config }} setConfig={vi.fn()}>
      <OverlayProvider>
        <LayoutTab />
      </OverlayProvider>
    </ConfigProvider>
  );
}

describe('Settings → Layout', () => {
  // #300: the board has no service cards; the Overview's Services section
  // lists the services, so the cards' options would change nothing.
  it('has no Service Cards options: the board draws no service card', () => {
    renderTab({ cardLayout: 'grid', statusStyle: 'dot' });
    expect(screen.queryByText('Service Cards')).toBeNull();
    for (const name of ['Card Layout', 'Status Style', 'Service Columns per Row'])
      expect(screen.queryByRole('group', { name })).toBeNull();
    expect(screen.queryByText(/Docker Metrics/)).toBeNull();
    expect(screen.queryByText(/App Integration Data/)).toBeNull();
    // The rest of the tab is as it was.
    expect(screen.getByText('Refresh')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Link Target' })).toBeInTheDocument();
  });

  // #306: the old board's grid went with it; the Overview reflows, and
  // arranging comes back as Edit layout (Phase 5). Collapsible sections was
  // read by nothing.
  it('has no Grid card (columns, Auto-arrange, Reset) and no Collapsible sections', () => {
    renderTab({ gridColumns: 12, gridLayout: { lg: [] }, collapsibleSections: true });
    expect(screen.queryByText('Grid')).toBeNull();
    expect(screen.queryByText(/Grid Columns/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Auto-arrange/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reset Grid Layout/ })).toBeNull();
    expect(screen.queryByText('Collapsible Sections')).toBeNull();
    expect(screen.getByText(/Auto-refresh Interval/)).toBeInTheDocument();
  });
});
