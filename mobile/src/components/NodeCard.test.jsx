import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NodeCard from './NodeCard.jsx';

const VM = { display_name: 'VM 101', subtitle: 'app', metrics: { cpu: '45.3', memPercent: '31.2', diskPercent: '55.6', diskUnit: 'GB', temp: null }, services: [{ status: 'up' }, { status: 'down' }] };
const PI = { display_name: 'Gateway Pi', subtitle: 'edge', metrics: { cpu: '8.0', memPercent: '40.0', temp: '52.1', diskPercent: '20.0' }, services: [{ status: 'up' }] };
const ALL_UP = { display_name: 'DB 01', subtitle: 'db', metrics: { cpu: '10.0', memPercent: '20.0', diskPercent: '30.0', temp: null }, services: [{ status: 'up' }, { status: 'up' }, { status: 'unknown' }] };

describe('NodeCard', () => {
  it('shows up/down counts and CPU/MEM/DISK bars for a normal node', () => {
    render(<NodeCard nodeKey="vm-101" node={VM} onTap={() => {}} />);
    expect(screen.getByText('VM 101')).toBeInTheDocument();
    expect(screen.getByText(/1 up \/ 1 down/)).toBeInTheDocument();
    expect(screen.getByText('DISK')).toBeInTheDocument();
    expect(screen.queryByText('TEMP')).toBeNull();
  });
  it('shows TEMP instead of DISK when the node reports a temperature (the Pi)', () => {
    render(<NodeCard nodeKey="gateway-pi" node={PI} onTap={() => {}} />);
    expect(screen.getByText('TEMP')).toBeInTheDocument();
    expect(screen.getByText('52.1°C')).toBeInTheDocument();
  });
  it('renders "N up" with no "down" text when all services are up', () => {
    render(<NodeCard nodeKey="db-01" node={ALL_UP} onTap={() => {}} />);
    expect(screen.getByText(/3 up/)).toBeInTheDocument();
    expect(screen.queryByText(/down/)).toBeNull();
  });
  it('fires onTap with the nodeKey', () => {
    const onTap = vi.fn();
    render(<NodeCard nodeKey="vm-101" node={VM} onTap={onTap} />);
    fireEvent.click(screen.getByRole('button', { name: /VM 101/ }));
    expect(onTap).toHaveBeenCalledWith('vm-101');
  });
});
