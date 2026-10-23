import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
vi.mock('@shared/hooks/useData.js', () => ({ getServiceIcon: () => null }));
import NodeDetail from '@shared/phone/views/NodeDetail.jsx';
import NodeCard from '@shared/phone/components/NodeCard.jsx';
import { nodeCardsOf } from '@shared/phone/data/board.js';
import { STALE, UPS_ONLINE, boardOf, inputs, monitored, node } from '../testing/board.js';

const vm101 = (metrics = {}) =>
  boardOf(
    inputs({
      nodes: {
        'vm-101': node(
          { cpu: '45', memPercent: '31', diskPercent: '55', temp: null, ...metrics },
          {
            display_name: 'VM 101',
            subtitle: 'app',
            services: [
              monitored('vm-101:adguard', 'up', { display_name: 'AdGuard', ping: 12 }),
              monitored('vm-101:gitea', 'down', { display_name: 'Gitea', url: 'http://h/gitea' }),
            ],
          }
        ),
      },
      ups: UPS_ONLINE,
    })
  );
const DATA = vm101();

const pi = (metrics) =>
  boardOf(
    inputs({
      nodes: {
        'gateway-pi': node(
          { cpu: '8', memPercent: '40', ...metrics },
          { display_name: 'Gateway Pi', subtitle: 'edge', services: [monitored('gateway-pi:ssh', 'up', { display_name: 'SSH' })] }
        ),
      },
      ups: UPS_ONLINE,
    })
  );
const PI_DATA = pi({ temp: '52', diskPercent: '10' });

const at = (nodeKey) => ({ nav: { pop: vi.fn(), push: vi.fn() }, params: { nodeKey } });

describe('NodeDetail (#325: the node as the model has it)', () => {
  it('shows the node, the model\'s word and hosted counts, and its services, worst first', () => {
    const { container } = render(<NodeDetail data={DATA} {...at('vm-101')} />);
    expect(screen.getByRole('heading', { name: 'VM 101' })).toBeInTheDocument();
    expect(container.querySelector('.node-detail__head .status-word').textContent).toBe('HEALTHY');
    expect(container.querySelector('.node-detail__count').textContent).toBe('1 / 2 services up · 1 down');
    const names = screen.getAllByText(/AdGuard|Gitea/).map((n) => n.textContent);
    expect(names[0]).toBe('Gitea'); // the model's issue first
  });

  it('draws the down count red, and steel while the status is stale (#480)', () => {
    const { container, unmount } = render(<NodeDetail data={DATA} {...at('vm-101')} />);
    expect(container.querySelector('.node-detail__down-count')).toHaveStyle({ color: 'var(--red)' });
    unmount();
    const stale = render(<NodeDetail data={{ ...DATA, freshness: STALE }} {...at('vm-101')} />);
    const down = stale.container.querySelector('.node-detail__down-count');
    expect(down).toHaveTextContent('1 down');
    expect(down).toHaveStyle({ color: 'var(--steel)' });
  });

  it('says the model\'s reason when the node isn\'t healthy', () => {
    render(<NodeDetail data={vm101({ diskPercent: '92' })} {...at('vm-101')} />);
    expect(screen.getByText('Disk 92 % (warning above 90 %)')).toBeInTheDocument();
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

  it('renders DISK bar (not TEMP) for a node with no temperature', () => {
    render(<NodeDetail data={DATA} {...at('vm-101')} />);
    expect(screen.getByText('DISK')).toBeInTheDocument();
    expect(screen.queryByText('TEMP')).toBeNull();
  });

  it('renders both TEMP and DISK bars for a Pi node reporting temperature and disk', () => {
    render(<NodeDetail data={PI_DATA} {...at('gateway-pi')} />);
    expect(screen.getByText('TEMP')).toBeInTheDocument();
    expect(screen.getByText('52°C')).toBeInTheDocument();
    expect(screen.getByText('DISK')).toBeInTheDocument();
    expect(screen.getByText('10%')).toBeInTheDocument();
  });

  it('at 94 % disk and 80 °C the detail screen shows both bars while the card shows DISK (#273)', () => {
    const hot = pi({ temp: '80', diskPercent: '94' });
    const detail = render(<NodeDetail data={hot} {...at('gateway-pi')} />);
    expect(screen.getByText('TEMP')).toBeInTheDocument();
    expect(screen.getByText('80°C')).toBeInTheDocument();
    expect(screen.getByText('DISK')).toBeInTheDocument();
    expect(screen.getByText('94%')).toBeInTheDocument();
    detail.unmount();

    const [card] = nodeCardsOf({ status: hot.status, servicesBody: hot.servicesBody });
    render(<NodeCard node={card} onTap={() => {}} />);
    expect(screen.getByText('DISK')).toBeInTheDocument();
    expect(screen.getByText('94%')).toBeInTheDocument();
    expect(screen.queryByText('TEMP')).toBeNull();
  });

  it('keeps a DISK placeholder when the node reports neither temperature nor disk', () => {
    const { container } = render(<NodeDetail data={vm101({ diskPercent: null })} {...at('vm-101')} />);
    expect(screen.getByText('DISK')).toBeInTheDocument();
    expect(screen.queryByText('TEMP')).toBeNull();
    expect(container.querySelectorAll('.usage-bar')).toHaveLength(3);
  });

  it('renders "This node is no longer reported." for a node the model doesn\'t have', () => {
    render(<NodeDetail data={DATA} {...at('gone')} />);
    expect(screen.getByText('This node is no longer reported.')).toBeInTheDocument();
  });

  it('draws its history (`charts`, #602) under the bars, above the services; none without', () => {
    const { container, unmount } = render(
      <NodeDetail data={DATA} {...at('vm-101')} charts={<p>HISTORY</p>} />
    );
    const history = container.querySelector('.detail-history');
    expect(history).toHaveTextContent('HISTORY');
    expect(history.previousElementSibling).toHaveClass('node-detail__bars');
    expect(history.nextElementSibling).toHaveClass('svc-list');
    unmount();
    const without = render(<NodeDetail data={DATA} {...at('vm-101')} />);
    expect(without.container.querySelector('.detail-history')).toBeNull();
  });
});
