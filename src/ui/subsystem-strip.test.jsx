import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { SubsystemStrip } from '@ui/subsystem-strip';

const NO_RING = /(^|\s|:)outline-(none|hidden|0)(\s|$)/;

// The strip's container widths: below 320px (`@xs`), to 672px (`@2xl`), and
// from there. jsdom lays nothing out, so `layout` reads the classes a browser
// applies at each: the columns, and the columns the last tile spans.
const WIDTHS = {
  'below 320px': ['', '@max-2xl:'],
  '320 to 671px': ['', '@xs:', '@max-2xl:'],
  'from 672px': ['', '@xs:', '@2xl:'],
};
function layout(strip, width) {
  const classes = strip.className.split(/\s+/);
  const last = (pattern) => {
    let value = null;
    for (const prefix of WIDTHS[width]) {
      for (const c of classes) {
        if (c.startsWith(prefix) && pattern.test(c.slice(prefix.length))) {
          value = Number(c.slice(prefix.length).match(pattern)[1]);
        }
      }
    }
    return value;
  };
  return {
    columns: last(/^grid-cols-(\d+)$/),
    lastSpan: last(/^\[&>:last-child\]:col-span-(\d+)$/) ?? 1,
  };
}

// The mock's incident strip.
const CELLS = [
  {
    key: 'services',
    label: 'Services',
    state: 'crit',
    word: 'Down',
    value: '30 / 32 up',
    sub: '1 down · 1 no signal',
  },
  {
    key: 'nodes',
    label: 'Nodes',
    state: 'warn',
    word: 'Warning',
    value: '6 / 6 up',
    sub: '1 disk warning',
  },
  {
    key: 'power',
    label: 'Power',
    state: 'crit',
    word: 'On battery',
    value: 'On battery',
    sub: '82 % · ~31 min left',
  },
  {
    key: 'jobs',
    label: 'Jobs',
    state: 'ok',
    value: '14 / 14 on time',
    sub: 'next: npm-sync in 9 min',
  },
  {
    key: 'backups',
    label: 'Backups',
    state: 'warn',
    word: 'Overdue',
    value: '1 overdue',
    sub: 'vzdump OK 4 h ago',
  },
  {
    key: 'integrations',
    label: 'Integrations',
    state: 'unknown',
    value: '9 connected',
    sub: 'Arcane, Gitea, HA +6',
  },
];

describe('SubsystemStrip', () => {
  it('is the joined strip: a tile per subsystem, its lamp named by its word', () => {
    render(<SubsystemStrip cells={CELLS} />);
    const strip = screen.getByRole('region', { name: 'Subsystems' });
    expect(strip).toHaveClass('gap-px', 'rounded-xl', 'overflow-hidden', 'bg-border-subtle');
    const tiles = strip.querySelectorAll('[data-slot="subsystem-tile"]');
    expect(tiles).toHaveLength(6);
    expect(within(tiles[0]).getByRole('img', { name: 'Down' })).toHaveAttribute(
      'data-shape',
      'bar'
    );
    expect(within(tiles[2]).getByRole('img', { name: 'On battery' })).toBeInTheDocument();
    // Without a word, the lamp says its state's.
    expect(within(tiles[3]).getByRole('img', { name: 'OK' })).toHaveAttribute('data-shape', 'disc');
    expect(within(tiles[5]).getByRole('img', { name: 'No signal' })).toHaveAttribute(
      'data-shape',
      'ring'
    );
    // The label truncates, with an ellipsis, at every width, once it has used
    // 4px of the tile's padding.
    expect(within(tiles[0]).getByText('Services')).toHaveClass(
      'text-overline',
      'uppercase',
      'truncate',
      '-mr-1'
    );
    expect(within(tiles[0]).getByText('Services').className).not.toMatch(/overflow-visible/);
    expect(within(tiles[0]).getByText('30 / 32 up')).toHaveClass('@2xl:text-title-sm');
    expect(within(tiles[0]).getByText('1 down · 1 no signal')).toHaveClass('hidden', '@2xl:block');
  });

  it('tints a warning, critical or no-signal tile, and leaves ok and maintenance on the panel', () => {
    const { rerender } = render(<SubsystemStrip cells={CELLS} />);
    const tiles = () => screen.getByRole('region').querySelectorAll('[data-slot="subsystem-tile"]');
    expect(tiles()[5]).toHaveClass('bg-unknown-tint');
    const maintenance = { ...CELLS[5], state: 'maintenance', value: '1 in maintenance' };
    rerender(<SubsystemStrip cells={[...CELLS.slice(0, 5), maintenance]} />);
    const [crit, warn, , ok, , maint] = tiles();
    expect(crit).toHaveClass('bg-crit-tint');
    expect(warn).toHaveClass('bg-warn-tint');
    expect(ok).toHaveClass('bg-surface-1');
    expect(ok.className).not.toMatch(/-tint/);
    // Maintenance is not an issue (spec §6.1): its wrench says it, on the panel.
    expect(maint).toHaveClass('bg-surface-1');
    expect(maint.className).not.toMatch(/-tint/);
    expect(within(maint).getByRole('img', { name: 'Maintenance' })).toHaveAttribute(
      'data-shape',
      'wrench'
    );
  });

  it('sits six in a row from 672px, three from 320px and two below', () => {
    const { rerender } = render(<SubsystemStrip cells={CELLS} />);
    expect(screen.getByRole('region')).toHaveClass(
      'grid-cols-2',
      '@xs:grid-cols-3',
      '@2xl:grid-cols-6'
    );
    expect(screen.getByRole('region').parentElement).toHaveClass('@container');
    rerender(<SubsystemStrip cells={CELLS.slice(0, 4)} />);
    expect(screen.getByRole('region')).toHaveClass('grid-cols-2', '@2xl:grid-cols-4');
  });

  // An empty slot would show the frame's border-subtle as a grey block.
  it('leaves no empty slot in its last row, for one to six tiles at every width', () => {
    const { rerender } = render(<SubsystemStrip cells={CELLS.slice(0, 1)} />);
    for (let n = 1; n <= CELLS.length; n++) {
      rerender(<SubsystemStrip cells={CELLS.slice(0, n)} />);
      for (const width of Object.keys(WIDTHS)) {
        const { columns, lastSpan } = layout(screen.getByRole('region'), width);
        // The tiles before the last leave `used` slots in its row; the last
        // fills the rest of it.
        const used = (n - 1) % columns;
        expect(`${n} tiles ${width}: ${used} + ${lastSpan} of ${columns}`).toBe(
          `${n} tiles ${width}: ${used} + ${columns - used} of ${columns}`
        );
      }
    }
  });

  it('lays five tiles out as 2 + 2 + 1, then 3 + 2, the last tile wider, then one row', () => {
    render(<SubsystemStrip cells={CELLS.slice(0, 5)} />);
    const strip = screen.getByRole('region');
    expect(layout(strip, 'below 320px')).toEqual({ columns: 2, lastSpan: 2 });
    expect(layout(strip, '320 to 671px')).toEqual({ columns: 3, lastSpan: 2 });
    expect(layout(strip, 'from 672px')).toEqual({ columns: 5, lastSpan: 1 });
  });

  it('is plain content without onSelect', () => {
    render(<SubsystemStrip cells={CELLS} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('filters by a subsystem with onSelect: toggle buttons, the selected one edged in the accent', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(<SubsystemStrip cells={CELLS} onSelect={onSelect} />);
    // Named as a row is: "label, word, value", and described by the line under it.
    const services = screen.getByRole('button', { name: 'Services, Down, 30 / 32 up' });
    expect(services).toHaveAccessibleDescription('1 down · 1 no signal');
    expect(screen.getByRole('button', { name: 'Jobs, OK, 14 / 14 on time' })).toBeInTheDocument();
    expect(services).toHaveAttribute('aria-pressed', 'false');
    expect(services).toHaveClass('hover:bg-surface-2', '-outline-offset-2');
    expect(services.className).not.toMatch(NO_RING);
    await user.click(services);
    expect(onSelect).toHaveBeenLastCalledWith('services');

    rerender(<SubsystemStrip cells={CELLS} onSelect={onSelect} selected="services" />);
    const pressed = screen.getByRole('button', { name: /Services/ });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
    expect(pressed).toHaveClass('inset-ring-[1.5px]', 'inset-ring-accent');
    await user.click(pressed);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
});
