import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { openTarget } = vi.hoisted(() => ({ openTarget: vi.fn() }));
vi.mock('../open.js', () => ({ openTarget }));
vi.mock('@shared/hooks/useData.js', () => ({ getServiceIcon: () => null }));
import ServiceDetail from './ServiceDetail.jsx';

const DATA = { servicesBody: { nodes: { 'vm-101': { display_name: 'VM 101', metrics: {}, services: [
  { uid: 'vm-101:gitea', container: 'gitea', display_name: 'Gitea', icon: null, status: 'down', ping: null, uptime24: 0.42, url: 'http://h/gitea', docker: { cpu: 2, memMB: 120 } },
] } } } };

describe('ServiceDetail', () => {
  beforeEach(() => openTarget.mockReset());
  it('shows the service status/node/uptime and Open + back', () => {
    const pop = vi.fn();
    render(<ServiceDetail data={DATA} nav={{ pop }} params={{ uid: 'vm-101:gitea' }} />);
    expect(screen.getByText('Gitea')).toBeInTheDocument();
    expect(screen.getByText('VM 101')).toBeInTheDocument();
    expect(screen.getByText('42.0%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(openTarget).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(pop).toHaveBeenCalled();
  });
  it('renders a not-found state for a stale uid', () => {
    render(<ServiceDetail data={DATA} nav={{ pop: vi.fn() }} params={{ uid: 'gone:x' }} />);
    expect(screen.getByText(/no longer/i)).toBeInTheDocument();
  });
});
