import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NodeCard from './NodeCard.jsx';

// Fixtures
const VM = { display_name: 'VM 101', subtitle: 'app', metrics: { cpu: '45.3', memPercent: '31.2', diskPercent: '55.6', diskUnit: 'GB', temp: null }, services: [{ status: 'up' }, { status: 'down' }] };
const PI = { display_name: 'Gateway Pi', subtitle: 'edge', metrics: { cpu: '8.0', memPercent: '40.0', temp: '52.1', diskPercent: '20.0' }, services: [{ status: 'up' }] };
const ALL_UP = { display_name: 'DB 01', subtitle: 'db', metrics: { cpu: '10.0', memPercent: '20.0', diskPercent: '30.0', temp: null }, services: [{ status: 'up' }, { status: 'up' }, { status: 'unknown' }] };
// Hot node: cpu >= 90 → caution (amber lamp)
const HOT_VM = { display_name: 'Hot VM', subtitle: 'app', metrics: { cpu: '95.0', memPercent: '50.0', diskPercent: '30.0', temp: null }, services: [{ status: 'up' }] };
// Node with a DOWN service but cool resources — lamp must stay healthy (green), not red
const DOWN_SVC_COOL = { display_name: 'Cool VM', subtitle: 'app', metrics: { cpu: '45.0', memPercent: '30.0', diskPercent: '20.0', temp: null }, services: [{ status: 'down' }] };

describe('NodeCard', () => {
  it('shows up/down counts and CPU/MEM/DISK bars for a normal node', () => {
    const { container } = render(<NodeCard nodeKey="vm-101" node={VM} onTap={() => {}} />);
    expect(screen.getByText('VM 101')).toBeInTheDocument();
    // Count text spans two nodes (plain + styled-down span); check full textContent
    const countEl = container.querySelector('.node-card__count');
    expect(countEl.textContent).toMatch(/1 up \/ 1 down/);
    expect(screen.getByText('DISK')).toBeInTheDocument();
    expect(screen.queryByText('TEMP')).toBeNull();
  });

  it('shows TEMP instead of DISK when the node reports a temperature (the Pi)', () => {
    render(<NodeCard nodeKey="gateway-pi" node={PI} onTap={() => {}} />);
    expect(screen.getByText('TEMP')).toBeInTheDocument();
    expect(screen.getByText('52.1°C')).toBeInTheDocument();
  });

  it('renders "N up" with no "down" text when all services are up', () => {
    const { container } = render(<NodeCard nodeKey="db-01" node={ALL_UP} onTap={() => {}} />);
    const countEl = container.querySelector('.node-card__count');
    expect(countEl.textContent).toMatch(/3 up/);
    // No red down-count span rendered when down === 0
    expect(container.querySelector('.node-card__down-count')).toBeNull();
  });

  it('fires onTap with the nodeKey', () => {
    const onTap = vi.fn();
    render(<NodeCard nodeKey="vm-101" node={VM} onTap={onTap} />);
    fireEvent.click(screen.getByRole('button', { name: /VM 101/ }));
    expect(onTap).toHaveBeenCalledWith('vm-101');
  });

  it('lamp reflects resource severity — cool resources show healthy lamp even with a down service', () => {
    const { container } = render(<NodeCard nodeKey="cool-vm" node={DOWN_SVC_COOL} onTap={() => {}} />);
    // Lamp must be healthy (green disc), not red/critical
    expect(container.querySelector('.lamp--healthy')).toBeInTheDocument();
    expect(container.querySelector('.lamp--critical')).toBeNull();
    // Down count is present and styled red
    const downSpan = container.querySelector('.node-card__down-count');
    expect(downSpan).toBeInTheDocument();
    expect(downSpan).toHaveStyle({ color: 'var(--red)' });
  });

  it('shows amber (caution) lamp for a hot node (cpu >= 90)', () => {
    const { container } = render(<NodeCard nodeKey="hot-vm" node={HOT_VM} onTap={() => {}} />);
    expect(container.querySelector('.lamp--caution')).toBeInTheDocument();
    expect(container.querySelector('.lamp--healthy')).toBeNull();
  });
});
