import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { InfrastructureSection } from '@ui/infrastructure-section';

const reading = (key, label, value, state, extra = {}) => ({
  key,
  label,
  value,
  unit: key === 'temp' ? '°C' : '%',
  max: 100,
  state,
  warn: key === 'temp' ? 75 : 90,
  ...(key === 'disk' && { crit: 95 }),
  band: 5,
  shown: value == null ? null : `${Math.floor(value)}${key === 'temp' ? '°C' : '%'}`,
  ...extra,
});

const NODES = [
  {
    id: 'nodes/apps',
    anchor: 'entity-nodes/apps',
    name: 'App Server',
    host: 'apps',
    subtitle: 'Proxmox VM',
    colour: '#6366f1',
    state: 'ok',
    word: 'Healthy',
    reason: null,
    readings: [
      reading('cpu', 'CPU', 23.8, 'ok'),
      reading('mem', 'Memory', 62.2, 'ok'),
      reading('disk', 'Disk', 60.6, 'ok'),
    ],
    services: '8 / 9 services up · 1 down',
    uptime: 'Up 12d 3h',
    trend: null,
  },
  {
    id: 'nodes/storage',
    anchor: 'entity-nodes/storage',
    name: 'Storage',
    host: 'storage',
    subtitle: 'NAS',
    colour: '#14b8a6',
    state: 'warn',
    word: 'Warning',
    reason: 'Disk 94 % (warning above 90 %)',
    readings: [
      reading('cpu', 'CPU', 9.4, 'ok'),
      reading('mem', 'Memory', 41.6, 'ok'),
      reading('disk', 'Disk', 94.6, 'warn'),
      reading('temp', 'Temp', null, 'unknown'),
    ],
    services: '3 / 3 services up',
    uptime: 'Up 87d 14h',
    trend: null,
  },
];

const section = () => screen.getByRole('region', { name: 'Infrastructure' });

describe('InfrastructureSection', () => {
  it('a region named by its heading, with the count, and a card per node in cards view', () => {
    render(<InfrastructureSection nodes={NODES} count="2 nodes · 1 warning" />);
    expect(within(section()).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Infrastructure'
    );
    expect(section()).toHaveTextContent('2 nodes · 1 warning');
    expect(within(section()).getAllByRole('article')).toHaveLength(2);
    expect(within(section()).getByRole('article', { name: 'Storage' })).toHaveAttribute(
      'id',
      'entity-nodes/storage'
    );
    expect(within(section()).getByRole('article', { name: 'App Server' })).toHaveAttribute(
      'data-node',
      'nodes/apps'
    );
    // No toggle without a handler for it.
    expect(within(section()).queryByRole('radiogroup')).toBeNull();
  });

  it('the Cards / Table toggle is a radio group, "Node view", that asks for the other view', async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    render(<InfrastructureSection nodes={NODES} view="cards" onViewChange={onViewChange} />);
    const group = within(section()).getByRole('radiogroup', { name: 'Node view' });
    expect(within(group).getByRole('radio', { name: 'Cards' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await user.click(within(group).getByRole('radio', { name: 'Table' }));
    expect(onViewChange).toHaveBeenCalledWith('table');
  });

  it('table view: a table named by the heading, a row per node, readings as the meters print them', () => {
    render(<InfrastructureSection nodes={NODES} view="table" onViewChange={() => {}} />);
    const table = within(section()).getByRole('table', { name: 'Infrastructure' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent)
    ).toEqual(['Node', 'Role', 'CPU', 'Memory', 'Disk', 'Temp', 'Services', 'State']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    const storage = rows[1];
    expect(within(storage).getByRole('rowheader')).toHaveTextContent('Storagestorage');
    // The anchor is on the node's name, so a page's link lands on its row.
    expect(document.getElementById('entity-nodes/storage')).toBe(
      within(storage).getByRole('rowheader').firstChild
    );
    const cells = within(storage).getAllByRole('cell');
    expect(cells.map((c) => c.textContent)).toEqual([
      'NAS',
      '9%',
      '41%',
      '94%, warning',
      '—No data',
      '3 / 3 services up',
      'Warning',
    ]);
    // Coloured only at or over its line, with the state said.
    expect(cells[3].firstChild).toHaveClass('text-warn-fg');
    expect(cells[1].firstChild.className).not.toMatch(/text-(warn|crit|ok)-fg/);
    expect(within(cells[6]).getByText('Warning')).toHaveClass('text-warn-fg');
    // A node with no temperature sensor: a plain dash.
    expect(within(rows[0]).getAllByRole('cell')[4]).toHaveTextContent(/^—$/);
    // No cards in table view.
    expect(within(section()).queryAllByRole('article')).toEqual([]);
  });

  it('loading: busy, placeholder cards, no count and no nodes', () => {
    const { container } = render(
      <InfrastructureSection nodes={[]} count="2 nodes" loading onViewChange={() => {}} />
    );
    expect(section()).toHaveAttribute('aria-busy', 'true');
    expect(section()).toHaveTextContent('The nodes are loading');
    expect(section()).not.toHaveTextContent('2 nodes');
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
    expect(within(section()).queryAllByRole('article')).toEqual([]);
  });

  it('shows the banner it is given, above the nodes', () => {
    render(<InfrastructureSection nodes={NODES} banner={<p data-testid="banner">Old</p>} />);
    const banner = screen.getByTestId('banner');
    const first = within(section()).getAllByRole('article')[0];
    expect(banner.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
