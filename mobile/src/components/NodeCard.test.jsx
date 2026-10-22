import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NodeCard from './NodeCard.jsx';
import { nodeCardsOf } from '../data/board.js';
import { UPS_ONLINE, boardOf, inputs, monitored, node } from '../testing/board.js';

/** The card the Infra screen draws for one node, through the model. */
function cardFor(metrics, extra = {}) {
  const data = boardOf(inputs({ nodes: { n: node(metrics, { display_name: 'N', subtitle: 'app', ...extra }) }, ups: UPS_ONLINE }));
  return nodeCardsOf({ status: data.status, servicesBody: data.servicesBody })[0];
}

describe('NodeCard (#325: the model\'s lamp, counts and levels)', () => {
  it('shows CPU/MEM/DISK bars for a node with no temperature, numbers as the model prints them', () => {
    const { container } = render(
      <NodeCard node={cardFor({ cpu: '45.3', memPercent: '31.2', diskPercent: '55.6', temp: null })} onTap={() => {}} />
    );
    expect([...container.querySelectorAll('.usage-bar__label')].map((l) => l.textContent)).toEqual(['CPU', 'MEM', 'DISK']);
    expect([...container.querySelectorAll('.usage-bar__value')].map((l) => l.textContent)).toEqual(['45%', '31%', '55%']);
  });

  it('shows TEMP instead of DISK when the node reports a temperature (the Pi)', () => {
    render(<NodeCard node={cardFor({ temp: '52.1', diskPercent: '20.0' })} onTap={() => {}} />);
    expect(screen.getByText('TEMP')).toBeInTheDocument();
    expect(screen.getByText('52°C')).toBeInTheDocument();
    expect(screen.queryByText('DISK')).toBeNull();
  });

  it('shows DISK instead of TEMP once the model has the disk over its line (#273)', () => {
    const { container } = render(<NodeCard node={cardFor({ temp: '52.1', diskPercent: '94' })} onTap={() => {}} />);
    expect(screen.getByText('DISK')).toBeInTheDocument();
    expect(screen.getByText('94%')).toBeInTheDocument();
    expect(screen.queryByText('TEMP')).toBeNull();
    expect(container.querySelector('.usage-bar:last-child').dataset.state).toBe('warn');
  });

  it('keeps TEMP while the disk is under its line, however full (89 %)', () => {
    render(<NodeCard node={cardFor({ temp: '52.1', diskPercent: '89' })} onTap={() => {}} />);
    expect(screen.getByText('TEMP')).toBeInTheDocument();
  });

  it('colours each bar by the model\'s level, not a ramp of its own: 80 % is green, 91 % amber, 96 % red', () => {
    const { container } = render(
      <NodeCard node={cardFor({ cpu: '80', memPercent: '91', diskPercent: '96', temp: null })} onTap={() => {}} />
    );
    const fills = [...container.querySelectorAll('.usage-bar__fill')].map((f) => f.style.background);
    expect(fills).toEqual(['var(--green)', 'var(--amber)', 'var(--red)']);
  });

  it('"N / M services up" with no down text when nothing is down; "No services" for a node with none', () => {
    const { container, unmount } = render(
      <NodeCard node={cardFor({}, { services: [monitored('n:a', 'up'), monitored('n:b', 'up')] })} onTap={() => {}} />
    );
    expect(container.querySelector('.node-card__count').textContent).toBe('2 / 2 services up');
    expect(container.querySelector('.node-card__down-count')).toBeNull();
    unmount();
    render(<NodeCard node={cardFor({})} onTap={() => {}} />);
    expect(document.querySelector('.node-card__count').textContent).toBe('No services');
  });

  it('fires onTap with the node key', () => {
    const onTap = vi.fn();
    render(<NodeCard node={cardFor({})} onTap={onTap} />);
    fireEvent.click(screen.getByRole('button', { name: 'N detail' }));
    expect(onTap).toHaveBeenCalledWith('n');
  });

  it('the lamp is the node\'s own state: healthy with a down service, amber for a hot node', () => {
    const { container, unmount } = render(
      <NodeCard node={cardFor({}, { services: [monitored('n:a', 'down')] })} onTap={() => {}} />
    );
    expect(container.querySelector('.lamp--healthy')).toBeInTheDocument();
    expect(container.querySelector('.node-card__lamp .lamp--critical')).toBeNull();
    unmount();
    const hot = render(<NodeCard node={cardFor({ memPercent: '95' })} onTap={() => {}} />);
    expect(hot.container.querySelector('.node-card__lamp .lamp--caution')).toBeInTheDocument();
    expect(hot.container.querySelector('.node-card__lamp .status-lamp').getAttribute('aria-label')).toBe('Warning');
  });
});
