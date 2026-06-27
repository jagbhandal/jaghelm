import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { openTarget } = vi.hoisted(() => ({ openTarget: vi.fn() }));
vi.mock('../open.js', () => ({ openTarget }));
vi.mock('@shared/hooks/useData.js', () => ({ getServiceIcon: () => null }));
import ServiceDetail from './ServiceDetail.jsx';

// One service, overridable; wrapped in the { nodes: { ... } } servicesBody shape.
const svc = (over = {}) => ({
  uid: 'vm-101:gitea', container: 'gitea', display_name: 'Gitea', icon: null,
  status: 'down', ping: null, uptime24: 0.42, url: 'http://h/gitea',
  docker: { cpu: 2, memMB: 120 }, ...over,
});
const dataWith = (...services) => ({
  servicesBody: { nodes: { 'vm-101': { display_name: 'VM 101', metrics: {}, services } } },
});

describe('ServiceDetail', () => {
  beforeEach(() => openTarget.mockReset());

  it('shows the service status/node/uptime and Open + back', () => {
    const pop = vi.fn();
    render(<ServiceDetail data={dataWith(svc())} nav={{ pop }} params={{ uid: 'vm-101:gitea' }} />);
    expect(screen.getByText('Gitea')).toBeInTheDocument();
    expect(screen.getByText('VM 101')).toBeInTheDocument();
    expect(screen.getByText('42.0%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(openTarget).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(pop).toHaveBeenCalled();
  });

  it('renders a not-found state for a stale uid', () => {
    render(<ServiceDetail data={dataWith(svc())} nav={{ pop: vi.fn() }} params={{ uid: 'gone:x' }} />);
    expect(screen.getByText(/no longer/i)).toBeInTheDocument();
  });

  it('renders the status WORD in the DOM', () => {
    render(<ServiceDetail data={dataWith(svc({ status: 'down' }))} nav={{ pop: vi.fn() }} params={{ uid: 'vm-101:gitea' }} />);
    expect(screen.getByText('DOWN', { selector: '.status-word' })).toBeInTheDocument();
  });

  it('HIDES the docker CPU/MEM block when the service is down (Bug #12)', () => {
    render(<ServiceDetail data={dataWith(svc({ status: 'down', docker: { cpu: 0, memMB: 0 } }))} nav={{ pop: vi.fn() }} params={{ uid: 'vm-101:gitea' }} />);
    expect(screen.queryByText(/CPU/)).toBeNull();
    expect(screen.queryByText(/MEM/)).toBeNull();
    // ...but the cause/where line IS shown for a down service.
    expect(screen.getByText('Service is down · VM 101')).toBeInTheDocument();
  });

  it('SHOWS the docker CPU/MEM block when the service is up', () => {
    render(<ServiceDetail data={dataWith(svc({ uid: 'vm-101:up', status: 'up', ping: 12, docker: { cpu: 5, memMB: 64 } }))} nav={{ pop: vi.fn() }} params={{ uid: 'vm-101:up' }} />);
    expect(screen.getByText('CPU 5%')).toBeInTheDocument();
    expect(screen.getByText('MEM 64 MB')).toBeInTheDocument();
    // ping is latency, rendered as {ping}ms — never reinterpreted as an age.
    expect(screen.getByText('12ms')).toBeInTheDocument();
  });

  it('omits the "last seen" line entirely when there is no lastSeenAt', () => {
    render(<ServiceDetail data={dataWith(svc({ uid: 'vm-101:up', status: 'up', docker: null }))} nav={{ pop: vi.fn() }} params={{ uid: 'vm-101:up' }} />);
    expect(screen.queryByText(/last seen/i)).toBeNull();
  });

  it('shows "last seen X ago" ONLY for a presence breadcrumb with a real lastSeenAt', () => {
    const presence = svc({ uid: 'vm-101:pg', display_name: 'Postgres', status: 'unknown', source: 'presence', lastSeenAt: Date.now() - 2 * 60_000, docker: null, ping: null, uptime24: null });
    render(<ServiceDetail data={dataWith(presence)} nav={{ pop: vi.fn() }} params={{ uid: 'vm-101:pg' }} />);
    expect(screen.getByText(/last seen .* ago/i)).toBeInTheDocument();
  });

  it('omits the UptimeRing when uptime24 is null (no fake series)', () => {
    render(<ServiceDetail data={dataWith(svc({ uid: 'vm-101:nr', uptime24: null }))} nav={{ pop: vi.fn() }} params={{ uid: 'vm-101:nr' }} />);
    expect(screen.queryByText('24H')).toBeNull();
    expect(screen.queryByText('42.0%')).toBeNull();
  });

  it('demotes Open to the secondary ghost variant (Bug #9)', () => {
    render(<ServiceDetail data={dataWith(svc())} nav={{ pop: vi.fn() }} params={{ uid: 'vm-101:gitea' }} />);
    expect(screen.getByRole('button', { name: 'Open' }).className).toMatch(/open-btn--ghost/);
  });
});
