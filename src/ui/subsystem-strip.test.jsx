import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { SubsystemStrip } from '@ui/subsystem-strip';

const NO_RING = /(^|\s|:)outline-(none|hidden|0)(\s|$)/;

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
    expect(within(tiles[0]).getByText('Services')).toHaveClass('text-overline', 'uppercase');
    expect(within(tiles[0]).getByText('30 / 32 up')).toHaveClass('@2xl:text-title-sm');
    expect(within(tiles[0]).getByText('1 down · 1 no signal')).toHaveClass('hidden', '@2xl:block');
  });

  it("tints a tile that isn't ok, and leaves an ok tile on the panel", () => {
    render(<SubsystemStrip cells={CELLS} />);
    const tiles = screen.getByRole('region').querySelectorAll('[data-slot="subsystem-tile"]');
    expect(tiles[0]).toHaveClass('bg-crit-tint');
    expect(tiles[1]).toHaveClass('bg-warn-tint');
    expect(tiles[5]).toHaveClass('bg-unknown-tint');
    expect(tiles[3]).toHaveClass('bg-surface-1');
    expect(tiles[3].className).not.toMatch(/-tint/);
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

  it('is plain content without onSelect', () => {
    render(<SubsystemStrip cells={CELLS} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('filters by a subsystem with onSelect: toggle buttons, the selected one edged in the accent', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(<SubsystemStrip cells={CELLS} onSelect={onSelect} />);
    const services = screen.getByRole('button', { name: /Services/ });
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

  it("is the Android app's 2×2 grid in the android look", () => {
    const { container } = render(
      <SubsystemStrip
        look="android"
        cells={[
          { key: 'ups', label: 'UPS', severity: 'caution', word: 'ON BATTERY', detail: '47% · 8m' },
        ]}
      />
    );
    expect(screen.getByRole('list', { name: 'Subsystem health' })).toHaveClass('subsys-strip');
    expect(container.querySelector('.subsystem-cell--caution')).not.toBeNull();
    // The UPS on battery keeps its bolt there.
    expect(container.querySelector('svg.status-lamp path')).not.toBeNull();
  });
});
