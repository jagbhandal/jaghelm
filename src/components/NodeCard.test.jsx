import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DndContext } from '@dnd-kit/core';
import NodeCard from './NodeCard';
import { ConfigProvider } from '../context/ConfigContext.jsx';

// NodeCard renders a node's display name (preferring nodeData.display_name over
// the section title) plus its services. Services render through
// DraggableServiceCard, which uses dnd-kit's useDraggable — so we wrap in a
// DndContext to mirror the real DashboardView tree. NodeCard now reads its
// config from ConfigContext (not props), so we wrap in a ConfigProvider too.
// These tests lock in that a node's name and its services reach the screen from
// config + node data, which must survive config moving into a context.

const renderInDnd = (ui, config = baseConfig()) =>
  render(
    <ConfigProvider config={config} setConfig={vi.fn()}>
      <DndContext>{ui}</DndContext>
    </ConfigProvider>
  );

const baseConfig = (overrides = {}) => ({
  sections: {},
  statusStyle: 'badge',
  cardLayout: 'row',
  showDockerStats: false,
  showAppData: false,
  ...overrides,
});

describe('NodeCard', () => {
  it('renders the node display_name from nodeData', () => {
    renderInDnd(
      <NodeCard
        sectionKey="production"
        nodeData={{ display_name: 'Production Node' }}
        services={[]}
      />
    );
    expect(screen.getByText('Production Node')).toBeInTheDocument();
  });

  it('falls back to the section title, then the sectionKey, when no nodeData name', () => {
    const { rerender } = renderInDnd(
      <NodeCard sectionKey="prod" services={[]} />,
      baseConfig({ sections: { prod: { title: 'Prod Box' } } })
    );
    expect(screen.getByText('Prod Box')).toBeInTheDocument();

    rerender(
      <ConfigProvider config={baseConfig()} setConfig={vi.fn()}>
        <DndContext>
          <NodeCard sectionKey="raw-key" services={[]} />
        </DndContext>
      </ConfigProvider>
    );
    expect(screen.getByText('raw-key')).toBeInTheDocument();
  });

  it('renders the subtitle when present', () => {
    renderInDnd(
      <NodeCard
        sectionKey="production"
        nodeData={{ display_name: 'Production', subtitle: '8 cores · 32GB' }}
        services={[]}
      />
    );
    expect(screen.getByText('8 cores · 32GB')).toBeInTheDocument();
  });

  it('renders each service belonging to the node', () => {
    renderInDnd(
      <NodeCard
        sectionKey="production"
        nodeData={{ display_name: 'Production' }}
        services={[
          { uid: 'a', container: 'grafana', name: 'Grafana', status: 'up' },
          { uid: 'b', container: 'gitea', name: 'Gitea', status: 'down' },
        ]}
      />
    );
    expect(screen.getByText('Grafana')).toBeInTheDocument();
    expect(screen.getByText('Gitea')).toBeInTheDocument();
  });

  it('renders node metrics with label, value, and unit', () => {
    renderInDnd(
      <NodeCard
        sectionKey="production"
        nodeData={{ display_name: 'Production' }}
        services={[]}
        metrics={[{ label: 'CPU', value: 42, unit: '%', percent: 42 }]}
      />
    );
    expect(screen.getByText('CPU')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
  });

  it('renders children passed through', () => {
    renderInDnd(
      <NodeCard sectionKey="production" nodeData={{ display_name: 'Production' }} services={[]}>
        <div>child-content</div>
      </NodeCard>
    );
    expect(screen.getByText('child-content')).toBeInTheDocument();
  });
});
