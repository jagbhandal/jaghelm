import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Infra from '@shared/phone/views/Infra.jsx';
import { STALE, UPS_ONLINE, boardOf, inputs, missing, monitored, node } from '../testing/board.js';

const DATA = boardOf(
  inputs({
    nodes: {
      'vm-101': node(
        { cpu: '45', memPercent: '31', diskPercent: '55', temp: null },
        { display_name: 'VM 101', subtitle: 'app', services: [monitored('vm-101:a', 'up')] }
      ),
      'gateway-pi': node(
        { cpu: '8', memPercent: '40', diskPercent: '20', temp: '52' },
        { display_name: 'Gateway Pi', subtitle: 'edge', services: [monitored('gateway-pi:b', 'up')] }
      ),
    },
    ups: UPS_ONLINE,
  })
);

const cardOf = (name) => screen.getByRole('button', { name: `${name} detail` });

describe('Infra, on the status model (#325)', () => {
  it('renders a card per node the model has, and pushes node detail on tap', () => {
    const push = vi.fn();
    render(<Infra data={DATA} nav={{ push }} />);
    expect(screen.getByText('VM 101')).toBeInTheDocument();
    expect(screen.getByText('Gateway Pi')).toBeInTheDocument();
    fireEvent.click(cardOf('Gateway Pi'));
    expect(push).toHaveBeenCalledWith('node', { nodeKey: 'gateway-pi' });
  });

  it('renders "No nodes reported." with no node, or no status yet', () => {
    const { unmount } = render(<Infra data={{ status: null, servicesBody: null }} nav={{ push: vi.fn() }} />);
    expect(screen.getByText('No nodes reported.')).toBeInTheDocument();
    unmount();
    const none = boardOf(inputs({ nodes: {}, ups: UPS_ONLINE }));
    render(<Infra data={none} nav={{ push: vi.fn() }} />);
    expect(screen.getByText('No nodes reported.')).toBeInTheDocument();
  });

  it('renders TEMP bar for the Pi node (temperature reported) and DISK for the VM', () => {
    render(<Infra data={DATA} nav={{ push: vi.fn() }} />);
    expect(screen.getByText('TEMP')).toBeInTheDocument();
    expect(screen.getByText('DISK')).toBeInTheDocument();
  });

  it('a Proxmox host with nothing reporting reads as unknown, not "0 up" (m13)', () => {
    // pve hosts nothing JagHelm monitors, and Prometheus couldn't read it this cycle.
    const pve = boardOf(
      inputs({
        nodes: {
          pve: node(
            { cpu: null, memPercent: null, diskPercent: null, temp: null },
            { display_name: 'pve', subtitle: 'proxmox', failedReads: ['reachable'] }
          ),
        },
        ups: UPS_ONLINE,
      })
    );
    const entity = pve.status.entities.find((e) => e.id === 'nodes/pve');
    expect([entity.state, entity.word]).toEqual(['unknown', 'No signal']);

    render(<Infra data={pve} nav={{ push: vi.fn() }} />);
    const card = cardOf('pve');
    const lamp = card.querySelector('.node-card__lamp .status-lamp');
    expect(lamp.getAttribute('class')).toMatch(/lamp--unknown/);
    expect(lamp.getAttribute('aria-label')).toBe('No signal');
    expect(card.querySelector('.node-card__count').textContent).toBe('No services');
    expect(card.textContent).not.toMatch(/0 up/);
    // Nothing was read, so no bar shows a number.
    expect([...card.querySelectorAll('.usage-bar__value')].map((v) => v.textContent)).toEqual(['—', '—', '—']);
  });

  it('hosted counts are the model\'s: down is what it calls down, red; up only what it calls healthy', () => {
    const vm = boardOf(
      inputs({
        nodes: {
          vm: node({}, {
            display_name: 'vm',
            services: [
              monitored('vm:a', 'up'),
              monitored('vm:b', 'up'),
              monitored('vm:c', 'down'),
              // A stopped container: the model's warning, Missing, neither up nor down.
              missing('vm:d'),
            ],
          }),
        },
        ups: UPS_ONLINE,
      })
    );
    const { unmount } = render(<Infra data={vm} nav={{ push: vi.fn() }} />);
    const count = cardOf('vm').querySelector('.node-card__count');
    expect(count.textContent).toBe('2 / 4 services up · 1 down');
    expect(count.querySelector('.node-card__down-count')).toHaveTextContent('1 down');
    expect(count.querySelector('.node-card__down-count')).toHaveStyle({ color: 'var(--red)' });
    // The node's own lamp is its own: its readings are fine, so healthy, never red for a down service.
    expect(cardOf('vm').querySelector('.node-card__lamp .status-lamp').getAttribute('class')).toMatch(/lamp--healthy/);
    unmount();

    // Stale, the count stays as last known, and its red goes steel (#480).
    render(<Infra data={{ ...vm, freshness: STALE }} nav={{ push: vi.fn() }} />);
    const said = cardOf('vm').querySelector('.node-card__down-count');
    expect(said).toHaveTextContent('1 down');
    expect(said).toHaveStyle({ color: 'var(--steel)' });
  });

  it('a stale status draws every card and bar as no signal, keeping the numbers last known (#480)', () => {
    render(<Infra data={{ ...DATA, freshness: STALE }} nav={{ push: vi.fn() }} />);
    expect(document.querySelectorAll('.node-card .lamp--unknown')).toHaveLength(2);
    expect(document.querySelector('.node-card .lamp--healthy')).toBeNull();
    const bars = [...document.querySelectorAll('.usage-bar')];
    expect(bars.map((b) => b.dataset.state)).toEqual(Array(6).fill('unknown'));
    expect(screen.getByText('45%')).toBeInTheDocument();
  });
});
