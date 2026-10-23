import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import NodesTab from './NodesTab';

// What Nodes says with no nodes (#566). While the first boot waits for
// Prometheus to have nodes (the live services payload's `discovery:
// 'waiting'`), they come by themselves; otherwise nothing is discovering, so
// the words never say they will.
const EMPTY = { nodes: {}, services: {}, integrations: {} };

describe('NodesTab with no nodes', () => {
  it('while the first boot waits, says the nodes come once Prometheus has some', () => {
    render(<NodesTab serverConfig={EMPTY} onSave={vi.fn()} saving={false} discovery="waiting" />);
    expect(screen.getByText(/asks Prometheus again every refresh and adds them as soon as it has some/)).toBeTruthy();
    expect(screen.queryByText(/by hand/)).toBeNull();
  });

  it('otherwise never says discovery is under way: add them by hand, or fix PROMETHEUS_URL and restart', () => {
    render(<NodesTab serverConfig={EMPTY} onSave={vi.fn()} saving={false} />);
    expect(screen.getByText(/only when it starts with no services\.yaml/)).toBeTruthy();
    expect(screen.getByText(/add them to services\.yaml by hand/)).toBeTruthy();
    expect(screen.getByText(/if PROMETHEUS_URL is wrong, fix it and restart/)).toBeTruthy();
    expect(screen.queryByText(/every refresh/)).toBeNull();
  });

  it('with nodes, says neither', () => {
    const cfg = { ...EMPTY, nodes: { pi1: { display_name: 'Gateway', visible: true } } };
    render(<NodesTab serverConfig={cfg} onSave={vi.fn()} saving={false} discovery="waiting" />);
    expect(screen.getByText('Gateway')).toBeTruthy();
    expect(screen.queryByText(/No nodes/)).toBeNull();
  });
});

// Jag, 2026-10-23 (#306): the new design marks a node by its name, its role
// and its colour; the node's icon showed only on the old board's panels.
describe('NodesTab without an icon', () => {
  it('has no Icon field, and draws no icon for a node that has one', () => {
    const cfg = {
      ...EMPTY,
      nodes: { pi1: { display_name: 'Gateway', icon: 'https://icons.example/pi.png' } },
    };
    render(<NodesTab serverConfig={cfg} onSave={vi.fn()} saving={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByText('Display Name')).toBeTruthy();
    expect(screen.queryByText('Icon')).toBeNull();
    expect(document.querySelector('img[src="https://icons.example/pi.png"]')).toBeNull();
  });
});
