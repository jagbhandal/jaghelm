import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@shared/hooks/useData.js', () => ({ getServiceIcon: () => null }));
import Services from './Services.jsx';
import { UPS_ONLINE, boardOf, inputs, missing, monitored, node } from '../testing/board.js';

const vmNode = (services) =>
  node({}, { display_name: 'VM 101', services });
const DATA = boardOf(
  inputs({
    nodes: {
      'vm-101': vmNode([
        monitored('vm-101:adguard', 'up', { display_name: 'AdGuard', ping: 12 }),
        monitored('vm-101:gitea', 'down', { display_name: 'Gitea', url: 'http://h/gitea' }),
      ]),
      'gateway-pi': node({}, { display_name: 'Gateway Pi', services: [monitored('gateway-pi:pihole', 'up', { display_name: 'Pi-hole', ping: 3 })] }),
    },
    ups: UPS_ONLINE,
  })
);
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
    const dataWithNull = boardOf(
      inputs({
        nodes: {
          'vm-101': vmNode([
            monitored('vm-101:adguard', 'up', { display_name: null }),
            monitored('vm-101:gitea', 'down', { display_name: 'Gitea' }),
          ]),
        },
        ups: UPS_ONLINE,
      })
    );
    render(<Services data={dataWithNull} nav={{ push: vi.fn() }} />);
    // Typing a query must not throw; the null-name service is simply excluded
    fireEvent.change(screen.getByLabelText('Search services'), { target: { value: 'gitea' } });
    expect(screen.getByText('Gitea')).toBeInTheDocument();
  });

  it('each row has the model\'s lamp and word; Down counts only what the model calls down (#325)', () => {
    const data = boardOf(
      inputs({
        nodes: {
          'vm-101': vmNode([
            monitored('vm-101:a', 'up', { display_name: 'A' }),
            monitored('vm-101:b', 'down', { display_name: 'B' }),
            missing('vm-101:d', undefined, { display_name: 'D' }),
          ]),
        },
        ups: UPS_ONLINE,
      })
    );
    const { container } = render(<Services data={data} nav={{ push: vi.fn() }} />);
    const rows = [...container.querySelectorAll('.svc-row')].map((r) => [
      r.querySelector('.svc-row__name').textContent,
      r.querySelector('.status-word').textContent,
    ]);
    // Worst first, in the model's issue order (Down, then Missing), then the rest as listed.
    expect(rows).toEqual([
      ['B', 'DOWN'],
      ['D', 'MISSING'],
      ['A', 'UP'],
    ]);
    expect(screen.getByRole('button', { name: 'Down 1' })).toBeInTheDocument();
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
