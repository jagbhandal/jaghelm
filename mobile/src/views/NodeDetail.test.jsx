import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
vi.mock('@shared/hooks/useData.js', () => ({ getServiceIcon: () => null }));
import NodeDetail from './NodeDetail.jsx';

const DATA = { servicesBody: { nodes: { 'vm-101': {
  display_name: 'VM 101', subtitle: 'app', metrics: { cpu: '45', memPercent: '31', diskPercent: '55', diskUnit: 'GB' },
  services: [
    { uid: 'vm-101:adguard', display_name: 'AdGuard', icon: null, status: 'up', ping: 12, uptime24: 0.99, url: '' },
    { uid: 'vm-101:gitea', display_name: 'Gitea', icon: null, status: 'down', ping: null, uptime24: 0.42, url: 'http://h/gitea' },
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
});
