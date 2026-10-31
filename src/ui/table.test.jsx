import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { Table } from '@ui/table';

const NO_RING = /(^|\s|:)outline-(none|hidden|0)(\s|$)/;

// The mock's Infrastructure table, two of its nodes.
const COLUMNS = [
  { key: 'name', header: 'Node' },
  { key: 'role', header: 'Role', className: 'text-text-2' },
  { key: 'cpu', header: 'CPU', numeric: true },
  { key: 'disk', header: 'Disk', numeric: true },
  { key: 'state', header: 'State', cell: (row) => <strong>{row.state}</strong> },
];
const ROWS = [
  { id: 'pve', name: 'Proxmox', role: 'Hypervisor', cpu: '18%', disk: '47%', state: 'Healthy' },
  {
    id: 'nas',
    name: 'JagNAS',
    role: 'Storage, B2 sync',
    cpu: '21%',
    disk: '92%',
    state: 'Warning',
  },
];

const frame = () => document.querySelector('[data-slot="table"]');

afterEach(() => vi.restoreAllMocks());

describe('Table', () => {
  it('is a table named by its caption, with column headers and each row named by its first cell', () => {
    render(<Table caption="Nodes" columns={COLUMNS} rows={ROWS} />);
    const table = screen.getByRole('table', { name: 'Nodes' });
    expect(within(table).getByText('Nodes', { selector: 'caption' })).toHaveClass('sr-only');
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual(['Node', 'Role', 'CPU', 'Disk', 'State']);
    for (const h of headers) expect(h).toHaveAttribute('scope', 'col');
    const rowHeaders = within(table).getAllByRole('rowheader');
    expect(rowHeaders.map((h) => h.textContent)).toEqual(['Proxmox', 'JagNAS']);
    for (const h of rowHeaders) expect(h).toHaveAttribute('scope', 'row');
    expect(within(table).getByRole('cell', { name: 'Warning' })).toBeInTheDocument();
  });

  it('right-aligns numeric columns, header and cells, in tabular figures', () => {
    render(<Table caption="Nodes" columns={COLUMNS} rows={ROWS} />);
    const disk = screen.getByRole('columnheader', { name: 'Disk' });
    expect(disk).toHaveClass('text-right');
    expect(screen.getByRole('cell', { name: '92%' })).toHaveClass('text-right', 'tabular-nums');
    expect(screen.getByRole('columnheader', { name: 'Role' })).toHaveClass('text-left');
    expect(screen.getByRole('cell', { name: 'Hypervisor' })).toHaveClass(
      'text-left',
      'text-text-2'
    );
  });

  it("draws the mock's table: a flat panel, overline headers, rows h-row tall with a subtle rule", () => {
    render(<Table caption="Nodes" columns={COLUMNS} rows={ROWS} />);
    expect(frame()).toHaveClass(
      'overflow-x-auto',
      'rounded-xl',
      'border',
      'border-border-subtle',
      'bg-surface-1'
    );
    expect(frame().className).not.toMatch(/shadow/);
    const table = screen.getByRole('table');
    expect(table).toHaveClass('w-full', 'border-collapse', 'text-body-sm');
    const header = screen.getByRole('columnheader', { name: 'Node' });
    expect(header).toHaveClass('text-overline', 'text-text-3', 'uppercase', 'py-2.5', 'px-3');
    // 12px between columns, 16px at both ends of the first and last, as the mock.
    expect(header).toHaveClass('px-3', 'first:px-4', 'last:px-4');
    expect(screen.getByRole('cell', { name: 'Hypervisor' })).toHaveClass('first:px-4', 'last:px-4');
    const [, row] = screen.getAllByRole('row');
    expect(row).toHaveClass('h-row', 'border-t', 'border-border-subtle');
    expect(screen.getByRole('rowheader', { name: 'Proxmox' })).toHaveClass(
      'font-bold',
      'text-left'
    );
  });

  it('keeps a minimum width when asked, as the mock (720px), and scrolls inside its frame', () => {
    render(<Table caption="Nodes" columns={COLUMNS} rows={ROWS} minWidth={720} />);
    expect(screen.getByRole('table')).toHaveStyle({ minWidth: '720px' });
  });

  it('is a region you can reach by keyboard only while it scrolls', () => {
    const { unmount } = render(<Table caption="Nodes" columns={COLUMNS} rows={ROWS} />);
    expect(frame()).not.toHaveAttribute('tabindex');
    expect(frame()).not.toHaveAttribute('role');
    unmount();
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(358);
    render(<Table caption="Nodes" columns={COLUMNS} rows={ROWS} minWidth={720} />);
    const region = screen.getByRole('region', { name: 'Nodes' });
    expect(region).toBe(frame());
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region.className).not.toMatch(NO_RING);
  });

  it('opens a row from its name, a button, and from a click anywhere on it', async () => {
    const user = userEvent.setup();
    const onRowOpen = vi.fn();
    render(<Table caption="Nodes" columns={COLUMNS} rows={ROWS} onRowOpen={onRowOpen} />);
    const open = screen.getByRole('button', { name: 'JagNAS' });
    expect(screen.getByRole('rowheader', { name: 'JagNAS' })).toContainElement(open);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Proxmox' })).toHaveFocus();
    await user.tab();
    expect(open).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onRowOpen).toHaveBeenLastCalledWith(ROWS[1]);
    await user.click(screen.getByRole('cell', { name: '18%' }));
    expect(onRowOpen).toHaveBeenLastCalledWith(ROWS[0]);
    expect(onRowOpen).toHaveBeenCalledTimes(2);
    const row = screen.getAllByRole('row')[1];
    expect(row).toHaveClass('cursor-pointer', 'hover:bg-row-hover');
  });

  it('leaves a link or control a cell holds to itself: its click does not open the row', async () => {
    const user = userEvent.setup();
    const onRowOpen = vi.fn();
    const columns = [
      ...COLUMNS,
      { key: 'netdata', header: 'Links', cell: (row) => <a href={`#${row.id}`}>Netdata</a> },
    ];
    render(<Table caption="Nodes" columns={columns} rows={ROWS} onRowOpen={onRowOpen} />);
    await user.click(screen.getAllByRole('link', { name: 'Netdata' })[0]);
    expect(onRowOpen).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Proxmox' }));
    expect(onRowOpen).toHaveBeenCalledWith(ROWS[0]);
  });

  it('can be named by its section’s heading, as the mock names its sections', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(358);
    render(
      <section>
        <h2 id="infra-h">Infrastructure</h2>
        <Table aria-labelledby="infra-h" columns={COLUMNS} rows={ROWS} />
      </section>
    );
    expect(screen.getByRole('table', { name: 'Infrastructure' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Infrastructure' })).toHaveAttribute('tabindex', '0');
    expect(document.querySelector('caption')).toBeNull();
  });

  it('holds what its cells position, so a scrolled-off column never widens the page (#299)', () => {
    render(<Table caption="Nodes" columns={COLUMNS} rows={ROWS} minWidth={720} />);
    // A cell's words for screen readers are positioned out of the flow: inside
    // the frame, not the page.
    expect(document.querySelector('[data-slot="table"]')).toHaveClass('relative');
  });

    it('says so when there are no rows, across every column', () => {
    render(<Table caption="Nodes" columns={COLUMNS} rows={[]} empty="No nodes yet" />);
    const cell = screen.getByRole('cell', { name: 'No nodes yet' });
    expect(cell).toHaveAttribute('colspan', '5');
    expect(cell).toHaveClass('text-text-3');
  });

  it('reads each row’s key from `rowKey`', () => {
    const rows = ROWS.map(({ id, ...r }) => ({ ...r, host: id }));
    render(<Table caption="Nodes" columns={COLUMNS} rows={rows} rowKey="host" />);
    expect(screen.getAllByRole('rowheader')).toHaveLength(2);
  });

  it('needs a caption: without one it throws in development', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Table columns={COLUMNS} rows={ROWS} />)).toThrow(/caption/);
    expect(() => render(<Table aria-label="Nodes" columns={COLUMNS} rows={ROWS} />)).not.toThrow();
  });
});
