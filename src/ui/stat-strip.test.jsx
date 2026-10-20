import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatStrip } from '@ui/stat-strip';
import { SubsystemStrip } from '@ui/subsystem-strip';
import { Sparkline } from '@ui/sparkline';

// The mock's UPS facts, as a strip.
const UPS = [
  { key: 'charge', label: 'Charge', value: '82 %', sub: 'on battery' },
  { key: 'runtime', label: 'Runtime', value: '~31 min' },
  { key: 'load', label: 'Load', value: '34 %' },
  { key: 'input', label: 'Input', value: '0 V', sub: 'mains lost 08:40' },
];

const strip = () => document.querySelector('[data-slot="stat-strip"]');

describe('StatStrip', () => {
  it('is a description list: each label is a term, its value and line under it are details', () => {
    render(<StatStrip stats={UPS} />);
    const terms = screen.getAllByRole('term');
    expect(terms.map((t) => t.textContent)).toEqual(['Charge', 'Runtime', 'Load', 'Input']);
    expect(strip().tagName).toBe('DL');
    const charge = terms[0].parentElement;
    expect(
      within(charge)
        .getAllByRole('definition')
        .map((d) => d.textContent)
    ).toEqual(['82 %', 'on battery']);
  });

  it("is the subsystem strip's frame with neutral tiles: no lamp, no tint", () => {
    render(<StatStrip stats={UPS} />);
    expect(strip()).toHaveClass(
      'grid',
      'gap-px',
      'overflow-hidden',
      'rounded-xl',
      'border',
      'border-border-subtle',
      'bg-border-subtle'
    );
    const tiles = [...strip().children];
    expect(tiles).toHaveLength(4);
    for (const tile of tiles) {
      expect(tile).toHaveAttribute('data-slot', 'stat');
      expect(tile).toHaveClass('bg-surface-1', 'min-w-0');
      expect(tile.className).not.toMatch(/-tint(\s|$)/);
      expect(tile.querySelector('[data-slot="status-lamp"]')).toBeNull();
    }
    expect(screen.getByText('Charge')).toHaveClass(
      'text-overline',
      'text-text-3',
      'uppercase',
      'truncate'
    );
    expect(screen.getByText('82 %')).toHaveClass('font-bold', 'text-text-1', '@2xl:text-title-sm');
    expect(screen.getByText('on battery')).toHaveClass('text-caption', 'text-text-3');
  });

  it('keeps every row of tiles full, with the columns the subsystem strip uses', () => {
    for (let n = 1; n <= 6; n += 1) {
      const cells = Array.from({ length: n }, (_, i) => ({
        key: `k${i}`,
        label: `Stat ${i}`,
        value: `${i}`,
        state: 'ok',
      }));
      const { container, unmount } = render(
        <>
          <StatStrip stats={cells} />
          <SubsystemStrip cells={cells} />
        </>
      );
      const ours = strip()
        .className.split(/\s+/)
        .filter((c) => /grid-cols|col-span/.test(c));
      const theirs = container
        .querySelector('[data-slot="subsystem-strip"]')
        .className.split(/\s+/)
        .filter((c) => /grid-cols|col-span/.test(c));
      expect(ours, `${n} tiles`).toEqual(theirs);
      unmount();
    }
  });

  it('holds a chart or meter under a value: a Sparkline, so slot 1 only', () => {
    render(
      <StatStrip
        stats={[
          {
            key: 'cpu',
            label: 'vm-103 · CPU',
            value: '41%',
            sub: 'Last 4 h',
            visual: <Sparkline label="CPU, last 4 hours" points={[20, 35, 41]} decorative />,
          },
        ]}
      />
    );
    const tile = strip().firstElementChild;
    const chart = tile.querySelector('[data-slot="sparkline"]');
    expect(chart).not.toBeNull();
    expect(chart.closest('dd')).not.toBeNull();
  });

  it('passes className and other props to its outer element', () => {
    render(<StatStrip stats={UPS} className="mt-4" data-testid="ups" />);
    expect(screen.getByTestId('ups')).toHaveClass('mt-4', '@container');
  });
});
