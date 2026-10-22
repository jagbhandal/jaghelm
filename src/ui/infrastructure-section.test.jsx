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

  it('table view: a table, "Nodes", a row per node, readings as the meters print them', () => {
    render(<InfrastructureSection nodes={NODES} view="table" onViewChange={() => {}} />);
    const table = within(section()).getByRole('table', { name: 'Nodes' });
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
    // Healthy stays quiet: the word in the row's own colour, beside its lamp.
    const healthy = within(within(rows[0]).getAllByRole('cell')[6]).getByText('Healthy');
    expect(healthy.className).not.toMatch(/text-(ok|warn|crit)-fg/);
    // A node with no temperature sensor: a plain dash.
    expect(within(rows[0]).getAllByRole('cell')[4]).toHaveTextContent(/^—$/);
    // No cards in table view.
    expect(within(section()).queryAllByRole('article')).toEqual([]);
  });

  it('narrower than the table (a phone): the cards, with every state and reading in view, and no toggle', () => {
    const at = (width) =>
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
        return new DOMRect(0, 0, this.dataset?.slot === 'infrastructure-section' ? width : 0, 0);
      });
    const spy = at(358);
    const { unmount } = render(
      <InfrastructureSection nodes={NODES} view="table" onViewChange={() => {}} />
    );
    expect(section()).toHaveAttribute('data-view', 'cards');
    expect(within(section()).queryByRole('table')).toBeNull();
    expect(within(section()).queryByRole('radiogroup')).toBeNull();
    const nas = within(section()).getByRole('article', { name: 'Storage' });
    expect(within(nas).getByText('Warning')).toBeInTheDocument();
    expect(nas.querySelector('[data-reading="disk"]')).toHaveAttribute('data-state', 'warn');
    unmount();
    spy.mockRestore();

    // Wide enough again: the table it was asked for, and the toggle.
    const wide = at(1100);
    render(<InfrastructureSection nodes={NODES} view="table" onViewChange={() => {}} />);
    expect(section()).toHaveAttribute('data-view', 'table');
    expect(within(section()).getByRole('table', { name: 'Nodes' })).toBeInTheDocument();
    expect(within(section()).getByRole('radiogroup', { name: 'Node view' })).toBeInTheDocument();
    wide.mockRestore();
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

  // #480: a stale status keeps each node's word, drawn as no signal.
  it('table view, no signal beside a last known word: the lamp is named No signal', () => {
    const stale = NODES.map((n) => ({ ...n, state: 'unknown' }));
    render(<InfrastructureSection nodes={stale} view="table" onViewChange={() => {}} />);
    const table = within(section()).getByRole('table', { name: 'Nodes' });
    const rows = within(table).getAllByRole('row').slice(1);
    for (const [row, word] of [
      [rows[0], 'Healthy'],
      [rows[1], 'Warning'],
    ]) {
      expect(within(row).getByRole('img', { name: 'No signal' })).toBeInTheDocument();
      expect(within(row).queryByRole('img', { name: word })).toBeNull();
      expect(row).toHaveTextContent(word);
    }
  });
});
