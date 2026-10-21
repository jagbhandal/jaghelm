import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { NodeCard } from '@ui/node-card';

const READINGS = [
  { key: 'cpu', label: 'CPU', value: 34, unit: '%', max: 100, state: 'ok', warn: 90, band: 5 },
  { key: 'mem', label: 'Memory', value: 61, unit: '%', max: 100, state: 'ok', warn: 90, band: 5 },
  {
    key: 'disk',
    label: 'Disk',
    value: 94.6,
    unit: '%',
    max: 100,
    state: 'warn',
    warn: 90,
    crit: 95,
    band: 5,
  },
  { key: 'temp', label: 'Temp', value: null, unit: '°C', max: 100, state: 'unknown', warn: 75 },
];

const meter = (card, key) => card.querySelector(`[data-reading="${key}"]`);
const STATUS_HUES = /(^|\s)(bg|text|border|fill|stroke)-(ok|warn|crit)-/;

describe('NodeCard', () => {
  it('is an article named by the node, its host and subtitle under the name', () => {
    render(<NodeCard name="Storage" host="storage" subtitle="NAS" state="ok" word="Healthy" />);
    const card = screen.getByRole('article', { name: 'Storage' });
    expect(within(card).getByRole('heading', { level: 3, name: 'Storage' })).toBeInTheDocument();
    expect(card).toHaveTextContent('storage · NAS');
    expect(within(card).getByText('storage')).toHaveClass('font-mono');
  });

  it("shows the user's colour only as a 10px swatch beside the name", () => {
    const { container } = render(
      <NodeCard name="Storage" colour="#14b8a6" state="warn" word="Warning" readings={READINGS} />
    );
    const swatch = container.querySelector('[data-slot="node-swatch"]');
    expect(swatch).toHaveClass('size-2.5');
    expect(swatch).toHaveAttribute('aria-hidden', 'true');
    expect(swatch).toHaveStyle({ backgroundColor: '#14b8a6' });
    // Nothing else in the card wears it.
    const worn = [...container.querySelectorAll('*')].filter((el) =>
      (el.getAttribute('style') ?? '').includes('rgb(20, 184, 166)')
    );
    expect(worn).toEqual([swatch]);
  });

  it('healthy: the lamp alone, named by the word, and no reason', () => {
    const { container } = render(
      <NodeCard name="vm" state="ok" word="Healthy" reason="Healthy" readings={READINGS.slice(0, 2)} />
    );
    const state = container.querySelector('[data-slot="node-state"]');
    expect(within(state).getByRole('img', { name: 'Healthy' })).toBeInTheDocument();
    expect(state).not.toHaveTextContent('Healthy');
    expect(container.querySelector('[data-slot="node-reason"]')).toBeNull();
  });

  it("not healthy: the model's word beside the lamp, and its reason, in its state's colour", () => {
    const { container } = render(
      <NodeCard
        name="Storage"
        state="warn"
        word="Warning"
        reason="Disk 94 % (warning above 90 %)"
        readings={READINGS}
      />
    );
    const state = container.querySelector('[data-slot="node-state"]');
    expect(within(state).getByText('Warning')).toHaveClass('text-warn-fg');
    expect(state.querySelector('[data-slot="status-lamp"]')).toHaveAttribute('aria-hidden', 'true');
    const reason = container.querySelector('[data-slot="node-reason"]');
    expect(reason).toHaveTextContent('Disk 94 % (warning above 90 %)');
    expect(reason).toHaveClass('text-warn-fg');
  });

  it('a meter per reading, in its order, coloured only by the state it is given', () => {
    const { container } = render(
      <NodeCard name="Storage" state="warn" word="Warning" readings={READINGS} />
    );
    const meters = [...container.querySelectorAll('[data-slot="metric-meter"]')];
    expect(meters.map((m) => m.dataset.reading)).toEqual(['cpu', 'mem', 'disk', 'temp']);
    expect(meters.map((m) => m.dataset.state)).toEqual(['ok', 'ok', 'warn', 'unknown']);
    // Below its line a meter is the accent's, never a status hue.
    for (const key of ['cpu', 'mem']) {
      const fill = meter(container, key).querySelector('[data-slot="meter-fill"]');
      expect(fill).toHaveClass('bg-meter');
      expect(fill.className).not.toMatch(STATUS_HUES);
    }
    expect(meter(container, 'disk').querySelector('[data-slot="meter-fill"]')).toHaveClass(
      'bg-warn-solid'
    );
    expect(meter(container, 'disk')).toHaveTextContent('94%');
    expect(meter(container, 'disk')).toHaveAttribute('aria-valuetext', '94%, warning above 90%');
    // No reading: no number, said as no data.
    expect(meter(container, 'temp')).toHaveTextContent('No data');
    expect(meter(container, 'temp')).not.toHaveAttribute('role');
  });

  it("the server's level wins: a reading held inside its band keeps its colour", () => {
    const held = [{ ...READINGS[1], value: 87, state: 'warn' }];
    const { container } = render(<NodeCard name="edge" state="warn" readings={held} />);
    expect(meter(container, 'mem')).toHaveAttribute('data-state', 'warn');
  });

  it('the footer: the hosted services, the uptime and the trend, named', () => {
    render(
      <NodeCard
        name="apps"
        state="ok"
        services="8 / 9 services up · 1 down"
        uptime="Up 12d 3h"
        trend={{
          points: [20, 22, 30, 24],
          label: 'CPU, last hour',
          formatValue: (v) => `${Math.floor(v)}%`,
        }}
      />
    );
    const card = screen.getByRole('article', { name: 'apps' });
    expect(card).toHaveTextContent('8 / 9 services up · 1 down');
    expect(card).toHaveTextContent('Up 12d 3h');
    const chart = within(card).getByRole('img', { name: 'CPU, last hour' });
    expect(chart).toHaveAccessibleDescription(/Latest 24%/);
  });

  it('passes an id and data to its root, for a page to link to it', () => {
    render(<NodeCard id="entity-nodes/apps" data-node="nodes/apps" name="apps" state="ok" />);
    const card = screen.getByRole('article', { name: 'apps' });
    expect(card).toHaveAttribute('id', 'entity-nodes/apps');
    expect(card).toHaveAttribute('data-node', 'nodes/apps');
  });
});
