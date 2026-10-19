import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
vi.mock('@shared/hooks/useData.js', () => ({ getServiceIcon: () => null }));
import NodeDetail from './NodeDetail.jsx';
import NodeCard from '../components/NodeCard.jsx';

// Non-Pi VM node: no temperature → third bar = DISK
const DATA = { servicesBody: { nodes: { 'vm-101': {
  display_name: 'VM 101', subtitle: 'app', metrics: { cpu: '45', memPercent: '31', diskPercent: '55', diskUnit: 'GB', temp: null },
  services: [
    { uid: 'vm-101:adguard', display_name: 'AdGuard', icon: null, status: 'up', ping: 12, uptime24: 0.99, url: '' },
    { uid: 'vm-101:gitea', display_name: 'Gitea', icon: null, status: 'down', ping: null, uptime24: 0.42, url: 'http://h/gitea' },
  ],
} } } };

// Pi node: reports temperature and disk → detail shows both bars
const PI_DATA = { servicesBody: { nodes: { 'gateway-pi': {
  display_name: 'Gateway Pi', subtitle: 'edge', metrics: { cpu: '8', memPercent: '40', temp: '52', diskPercent: '10' },
  services: [
    { uid: 'gateway-pi:ssh', display_name: 'SSH', icon: null, status: 'up', ping: 1, uptime24: 1, url: '' },
  ],
} } } };

describe('NodeDetail', () => {
  it('shows the node metrics and its full service list, problems-first', () => {
    render(<NodeDetail data={DATA} nav={{ pop: vi.fn(), push: vi.fn() }} params={{ nodeKey: 'vm-101' }} />);
    expect(screen.getByRole('heading', { name: 'VM 101' })).toBeInTheDocument();
    const names = screen.getAllByText(/AdGuard|Gitea/).map((n) => n.textContent);
    expect(names[0]).toBe('Gitea'); // down first
  });

  it('tapping a service pushes its detail', () => {
    const push = vi.fn();
    render(<NodeDetail data={DATA} nav={{ pop: vi.fn(), push }} params={{ nodeKey: 'vm-101' }} />);
    fireEvent.click(screen.getByRole('button', { name: /Gitea/ }));
    expect(push).toHaveBeenCalledWith('serviceDetail', { uid: 'vm-101:gitea' });
  });

  it('back pops the stack', () => {
    const pop = vi.fn();
    render(<NodeDetail data={DATA} nav={{ pop, push: vi.fn() }} params={{ nodeKey: 'vm-101' }} />);
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(pop).toHaveBeenCalled();
  });

  it('renders DISK bar (not TEMP) for a non-Pi node with no temperature', () => {
    render(<NodeDetail data={DATA} nav={{ pop: vi.fn(), push: vi.fn() }} params={{ nodeKey: 'vm-101' }} />);
    expect(screen.getByText('DISK')).toBeInTheDocument();
    expect(screen.queryByText('TEMP')).toBeNull();
  });

  it('renders both TEMP and DISK bars for a Pi node reporting temperature and disk', () => {
    render(<NodeDetail data={PI_DATA} nav={{ pop: vi.fn(), push: vi.fn() }} params={{ nodeKey: 'gateway-pi' }} />);
    expect(screen.getByText('TEMP')).toBeInTheDocument();
    expect(screen.getByText('52°C')).toBeInTheDocument();
    expect(screen.getByText('DISK')).toBeInTheDocument();
    expect(screen.getByText('10%')).toBeInTheDocument();
  });

  it('at 94 % disk and 80 °C the detail screen shows both bars while the card shows DISK (#273)', () => {
    const hot = { ...PI_DATA.servicesBody.nodes['gateway-pi'], metrics: { cpu: '8', memPercent: '40', temp: '80', diskPercent: '94' } };
    const data = { servicesBody: { nodes: { 'gateway-pi': hot } } };
    const detail = render(<NodeDetail data={data} nav={{ pop: vi.fn(), push: vi.fn() }} params={{ nodeKey: 'gateway-pi' }} />);
    expect(screen.getByText('TEMP')).toBeInTheDocument();
    expect(screen.getByText('80°C')).toBeInTheDocument();
    expect(screen.getByText('DISK')).toBeInTheDocument();
    expect(screen.getByText('94%')).toBeInTheDocument();
    detail.unmount();

    render(<NodeCard nodeKey="gateway-pi" node={hot} onTap={() => {}} />);
    expect(screen.getByText('DISK')).toBeInTheDocument();
    expect(screen.getByText('94%')).toBeInTheDocument();
    expect(screen.queryByText('TEMP')).toBeNull();
  });

  it('keeps a DISK placeholder when the node reports neither temperature nor disk', () => {
    const bare = { ...DATA.servicesBody.nodes['vm-101'], metrics: { cpu: '45', memPercent: '31', diskPercent: null, temp: null } };
    const { container } = render(<NodeDetail data={{ servicesBody: { nodes: { 'vm-101': bare } } }} nav={{ pop: vi.fn(), push: vi.fn() }} params={{ nodeKey: 'vm-101' }} />);
    expect(screen.getByText('DISK')).toBeInTheDocument();
    expect(screen.queryByText('TEMP')).toBeNull();
    expect(container.querySelectorAll('.usage-bar')).toHaveLength(3);
  });

  it('renders "This node is no longer reported." for a missing node', () => {
    render(<NodeDetail data={{ servicesBody: { nodes: {} } }} nav={{ pop: vi.fn(), push: vi.fn() }} params={{ nodeKey: 'gone' }} />);
    expect(screen.getByText('This node is no longer reported.')).toBeInTheDocument();
  });
});
