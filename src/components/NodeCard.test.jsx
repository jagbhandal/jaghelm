import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import NodeCard from './NodeCard';
import { ConfigProvider } from '../context/ConfigContext.jsx';

// NodeCard renders a node's display name (preferring nodeData.display_name over
// the section title) and what it is given (the node's Proxmox lists). It reads
// its config from ConfigContext (not props), so we wrap in a ConfigProvider.
// Its services are the Overview's Services section's (#300).

const renderCard = (ui, config = baseConfig()) =>
  render(
    <ConfigProvider config={config} setConfig={vi.fn()}>
      {ui}
    </ConfigProvider>
  );

const baseConfig = (overrides = {}) => ({
  sections: {},
  statusStyle: 'badge',
  cardLayout: 'row',
  showAppData: false,
  ...overrides,
});

describe('NodeCard', () => {
  it('renders the node display_name from nodeData', () => {
    renderCard(<NodeCard sectionKey="production" nodeData={{ display_name: 'Production Node' }} />);
    expect(screen.getByText('Production Node')).toBeInTheDocument();
  });

  it('falls back to the section title, then the sectionKey, when no nodeData name', () => {
    const { rerender } = renderCard(
      <NodeCard sectionKey="prod" />,
      baseConfig({ sections: { prod: { title: 'Prod Box' } } })
    );
    expect(screen.getByText('Prod Box')).toBeInTheDocument();

    rerender(
      <ConfigProvider config={baseConfig()} setConfig={vi.fn()}>
        <NodeCard sectionKey="raw-key" />
      </ConfigProvider>
    );
    expect(screen.getByText('raw-key')).toBeInTheDocument();
  });

  it('renders the subtitle when present', () => {
    renderCard(
      <NodeCard
        sectionKey="production"
        nodeData={{ display_name: 'Production', subtitle: '8 cores · 32GB' }}
      />
    );
    expect(screen.getByText('8 cores · 32GB')).toBeInTheDocument();
  });

  it('draws no service: they are the Services section’s (#300)', () => {
    const { container } = renderCard(
      <NodeCard sectionKey="production" nodeData={{ display_name: 'Production' }} />
    );
    expect(container.querySelector('.glass-card').textContent).toBe('Production');
  });

  it('draws no readings: they are the Infrastructure section’s (#299)', () => {
    const { container } = renderCard(
      <NodeCard sectionKey="production" nodeData={{ display_name: 'Production' }} />
    );
    expect(container.querySelector('.node-metrics')).toBeNull();
    expect(container.querySelector('.glass-card')).toHaveClass('node-card');
    expect(container.querySelector('.glass-card').className).not.toMatch(/node-card--/);
  });

  it('renders children passed through', () => {
    renderCard(
      <NodeCard sectionKey="production" nodeData={{ display_name: 'Production' }}>
        <div>child-content</div>
      </NodeCard>
    );
    expect(screen.getByText('child-content')).toBeInTheDocument();
  });
});
