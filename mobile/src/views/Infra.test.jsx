import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Infra from './Infra.jsx';

const DATA = { servicesBody: { nodes: {
  'vm-101': { display_name: 'VM 101', subtitle: 'app', metrics: { cpu: '45', memPercent: '31', diskPercent: '55' }, services: [{ status: 'up' }] },
  'gateway-pi': { display_name: 'Gateway Pi', subtitle: 'edge', metrics: { cpu: '8', memPercent: '40', temp: '52' }, services: [{ status: 'up' }] },
} } };

const EMPTY_DATA = { servicesBody: { nodes: {} } };

describe('Infra', () => {
  it('renders a card per node and pushes node detail on tap', () => {
    const push = vi.fn();
    render(<Infra data={DATA} nav={{ push }} />);
    expect(screen.getByText('VM 101')).toBeInTheDocument();
    expect(screen.getByText('Gateway Pi')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Gateway Pi/ }));
    expect(push).toHaveBeenCalledWith('node', { nodeKey: 'gateway-pi' });
  });

  it('renders "No nodes reported." when the node map is empty', () => {
    render(<Infra data={EMPTY_DATA} nav={{ push: vi.fn() }} />);
    expect(screen.getByText('No nodes reported.')).toBeInTheDocument();
  });

  it('renders TEMP bar for the Pi node (temperature reported) and DISK for the VM', () => {
    render(<Infra data={DATA} nav={{ push: vi.fn() }} />);
    expect(screen.getByText('TEMP')).toBeInTheDocument();
    expect(screen.getByText('DISK')).toBeInTheDocument();
  });
});
