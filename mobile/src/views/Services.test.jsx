import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@shared/hooks/useData.js', () => ({ getServiceIcon: () => null }));
import Services from './Services.jsx';

const DATA = {
  servicesBody: { nodes: {
    'vm-101': { display_name: 'VM 101', metrics: {}, services: [
      { uid: 'vm-101:adguard', container: 'adguard', display_name: 'AdGuard', icon: null, status: 'up', ping: 12, uptime24: 0.99, url: '' },
      { uid: 'vm-101:gitea', container: 'gitea', display_name: 'Gitea', icon: null, status: 'down', ping: null, uptime24: 0.42, url: 'http://h/gitea' },
    ] },
    'gateway-pi': { display_name: 'Gateway Pi', metrics: {}, services: [
      { uid: 'gateway-pi:pihole', container: 'pihole', display_name: 'Pi-hole', icon: null, status: 'up', ping: 3, uptime24: 1, url: '' },
    ] },
  } },
  ups: {}, cron: [], history: {}, loading: false, error: null,
};
// DATA counts: All=3, Down=1, VM 101=2, Gateway Pi=1

describe('Services', () => {
  it('renders problems-first (down at top) with node tags', () => {
    render(<Services data={DATA} nav={{ push: vi.fn() }} />);
    const names = screen.getAllByText(/AdGuard|Gitea|Pi-hole/).map((n) => n.textContent);
    expect(names[0]).toBe('Gitea'); // down first
    expect(screen.getAllByText('VM 101').length).toBeGreaterThan(0);
  });

  it('Down chip filters to only down services', () => {
    render(<Services data={DATA} nav={{ push: vi.fn() }} />);
    // Chip now shows "Down 1" (count appended)
    fireEvent.click(screen.getByRole('button', { name: 'Down 1' }));
    expect(screen.getByText('Gitea')).toBeInTheDocument();
    expect(screen.queryByText('AdGuard')).toBeNull();
  });

  it('per-node chip shows node display name + count and filters correctly', () => {
    render(<Services data={DATA} nav={{ push: vi.fn() }} />);
    // Chip label is "Gateway Pi 1" (display_name + count)
    const chip = screen.getByRole('button', { name: 'Gateway Pi 1' });
    expect(chip).toBeInTheDocument();
    fireEvent.click(chip);
    expect(screen.getByText('Pi-hole')).toBeInTheDocument();
    expect(screen.queryByText('Gitea')).toBeNull();
  });

  it('search narrows by name', () => {
    render(<Services data={DATA} nav={{ push: vi.fn() }} />);
    fireEvent.change(screen.getByLabelText('Search services'), { target: { value: 'pi' } });
    expect(screen.getByText('Pi-hole')).toBeInTheDocument();
    expect(screen.queryByText('Gitea')).toBeNull();
  });

  it('tap pushes the service detail', () => {
    const push = vi.fn();
    render(<Services data={DATA} nav={{ push }} />);
    fireEvent.click(screen.getByRole('button', { name: /Gitea/ }));
    expect(push).toHaveBeenCalledWith('serviceDetail', { uid: 'vm-101:gitea' });
  });

  it('search does not crash when a service has null display_name', () => {
    const dataWithNull = {
      ...DATA,
      servicesBody: { nodes: {
        'vm-101': { display_name: 'VM 101', metrics: {}, services: [
          { uid: 'vm-101:adguard', container: 'adguard', display_name: null, icon: null, status: 'up', ping: 12, uptime24: 0.99, url: '' },
          { uid: 'vm-101:gitea', container: 'gitea', display_name: 'Gitea', icon: null, status: 'down', ping: null, uptime24: 0.42, url: 'http://h/gitea' },
        ] },
      } },
    };
    render(<Services data={dataWithNull} nav={{ push: vi.fn() }} />);
    // Typing a query must not throw; the null-name service is simply excluded
    fireEvent.change(screen.getByLabelText('Search services'), { target: { value: 'gitea' } });
    expect(screen.getByText('Gitea')).toBeInTheDocument();
  });

  it('chip counts reflect the data (All=3, Down=1, VM 101=2, Gateway Pi=1)', () => {
    render(<Services data={DATA} nav={{ push: vi.fn() }} />);
    expect(screen.getByRole('button', { name: 'All 3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Down 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'VM 101 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gateway Pi 1' })).toBeInTheDocument();
  });

  it('All chip is active by default and carries chip--active class', () => {
    render(<Services data={DATA} nav={{ push: vi.fn() }} />);
    const allChip = screen.getByRole('button', { name: 'All 3' });
    expect(allChip).toHaveClass('chip--active');
    expect(allChip).toHaveAttribute('aria-pressed', 'true');
  });
});
