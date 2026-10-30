import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { SmallMultiples } from '@ui/small-multiples';

const q = (root, sel) => root.querySelector(sel);
const qa = (root, sel) => [...root.querySelectorAll(sel)];
const NOT_A_SLOT =
  /(^|\s)(stroke|fill|text|bg)-(meter|accent|ok|warn|crit|unknown|maintenance|info)(-|\s|$)/;

// Local times, so the default HH:MM reads the same in every time zone.
const at = (h, m) => new Date(2026, 9, 20, h, m).getTime();
const times = [at(8, 0), at(8, 15), at(8, 30), at(8, 45), at(9, 0)];
const pts = (values) => values.map((value, i) => ({ time: times[i], value }));
const pct = (v) => `${Math.round(v)} %`;

const THRESHOLDS = [
  { level: 'warn', value: 80 },
  { level: 'crit', value: 90 },
];
const CELLS = [
  { key: 'edge', name: 'Network Edge', points: pts([10, 20, 15, 30, 25]) },
  { key: 'app', name: 'App Server', points: pts([40, 50, 60, 55, 45]) },
  { key: 'store', name: 'Storage', points: pts([20, 30, 40, 35, 30]) },
];
const FLAGGED = [
  ...CELLS.slice(0, 2),
  { key: 'media', name: 'Media', points: pts([60, 70, 85, 92, 95]) },
];

const grid = (props) => (
  <SmallMultiples
    label="CPU by node, last hour"
    cells={CELLS}
    formatValue={pct}
    thresholds={THRESHOLDS}
    {...props}
  />
);
const cellsOf = (c) => qa(c, '[data-slot="small-multiples-cell"]');

describe('SmallMultiples grid', () => {
  it('draws one titled cell per entity, each with its latest reading and a chart of its own', () => {
    const { container } = render(grid());
    const cells = cellsOf(container);
    expect(cells).toHaveLength(3);
    expect(screen.getByRole('list', { name: 'CPU by node, last hour' })).toBeInTheDocument();
    expect(cells.map((c) => q(c, '[data-slot="small-multiples-name"]').textContent)).toEqual([
      'Network Edge',
      'App Server',
      'Storage',
    ]);
    expect(cells.map((c) => q(c, '[data-slot="small-multiples-latest"]').textContent)).toEqual([
      '25 %',
      '45 %',
      '30 %',
    ]);
    expect(qa(container, '[data-slot="chart"]')).toHaveLength(3);
    // A chart's image carries its own name and summary.
    expect(
      screen.getByRole('img', { name: 'Network Edge, CPU by node, last hour' })
    ).toBeInTheDocument();
  });

  it('gives every cell one value axis by default, and its own with scale="own"', () => {
    const yOf = (c) => qa(c, '[data-slot="chart-y"]').map((n) => n.textContent);
    const { container, rerender } = render(grid({ thresholds: undefined }));
    const shared = yOf(container);
    expect(new Set(shared).size).toBe(1);
    // The highest reading of ANY cell (60) is under the one axis: 0 to 100 in steps of 50.
    expect(shared[0]).toBe('100 %0 %50 %100 %');
    rerender(grid({ thresholds: undefined, scale: 'own' }));
    expect(new Set(yOf(container)).size).toBeGreaterThan(1);
  });

  it('holds the threshold lines on the shared axis, so a line no cell reaches is still drawn', () => {
    const { container } = render(grid());
    const cells = cellsOf(container);
    for (const c of cells) {
      expect(qa(c, '[data-slot="chart-threshold"]').map((l) => l.dataset.level)).toEqual([
        'warn',
        'crit',
      ]);
      expect(q(c, '[data-slot="chart-threshold-label"]')).toBeTruthy();
    }
  });

  it('a fixed domain is every cell’s axis', () => {
    const { container } = render(grid({ thresholds: undefined, domain: [0, 100] }));
    const ys = qa(container, '[data-slot="chart-y"]').map((n) => n.textContent);
    expect(new Set(ys).size).toBe(1);
    expect(ys[0]).toMatch(/100 %/);
  });

  it('a cell may bring its own thresholds', () => {
    const cells = [{ ...CELLS[0], thresholds: [{ level: 'warn', value: 28 }] }, CELLS[1]];
    const { container } = render(grid({ cells }));
    const [a, b] = cellsOf(container);
    expect(qa(a, '[data-slot="chart-threshold"]')).toHaveLength(1);
    expect(qa(b, '[data-slot="chart-threshold"]')).toHaveLength(2);
    // 25 is under 28: no breach word.
    expect(q(a, '[data-slot="small-multiples-breach"]')).toBeNull();
  });

  it('a cell at or past a line says so in words, and the worst line wins', () => {
    const { container } = render(grid({ cells: FLAGGED }));
    const cells = cellsOf(container);
    expect(cells.map((c) => c.dataset.state)).toEqual(['ok', 'ok', 'crit']);
    const word = q(cells[2], '[data-slot="small-multiples-breach"]');
    expect(word.textContent).toBe('Critical');
    expect(word).toHaveClass('font-bold', 'text-crit-fg');
    expect(qa(container, '[data-slot="small-multiples-breach"]')).toHaveLength(1);
  });

  it('a floor (direction below) breaches when the reading falls to it', () => {
    const cells = [{ key: 'free', name: 'Free', points: pts([60, 50, 40, 25, 15]) }];
    const { container } = render(
      grid({ cells, thresholds: [{ level: 'warn', value: 20, direction: 'below' }] })
    );
    expect(q(container, '[data-slot="small-multiples-breach"]').textContent).toBe('Warn');
  });

  it('a cell with no reading says so in its place, and is never zero', () => {
    const cells = [
      CELLS[0],
      { key: 'off', name: 'Offline', points: pts([null, null, null, null, null]) },
      { key: 'none', name: 'Never seen', points: [] },
    ];
    const { container } = render(grid({ cells }));
    const [, off, none] = cellsOf(container);
    for (const c of [off, none]) {
      expect(c.dataset.state).toBe('empty');
      expect(q(c, '[data-slot="small-multiples-empty"]').textContent).toBe('No data');
      expect(q(c, '[data-slot="chart"]')).toBeNull();
      expect(c.textContent).not.toMatch(/\b0 %/);
    }
    expect(
      screen.getByRole('img', { name: 'Offline, CPU by node, last hour: No data' })
    ).toBeTruthy();
    // The no-data cell does not pull the shared axis to zero.
    expect(qa(container, '[data-slot="chart-y"]')).toHaveLength(1);
  });

  it('a newest point that is a gap says "No reading", not a figure', () => {
    const cells = [{ key: 'a', name: 'A', points: pts([10, 20, 30, 40, null]) }];
    const { container } = render(grid({ cells }));
    expect(q(container, '[data-slot="small-multiples-latest"]').textContent).toBe('No reading');
  });

  it('a gap breaks the line, never bridged', () => {
    const cells = [{ key: 'a', name: 'A', points: pts([10, 20, null, 40, 50]) }];
    const { container } = render(grid({ cells }));
    expect(q(container, '[data-slot="chart-line"]').getAttribute('d').match(/M/g)).toHaveLength(2);
  });

  it('takes the entity’s chart slot, never a status colour', () => {
    const cells = [CELLS[0], { ...CELLS[1], slot: 4 }];
    const { container } = render(grid({ cells, thresholds: undefined }));
    const lines = qa(container, '[data-slot="chart-line"]');
    expect(lines[0].getAttribute('class')).toContain('stroke-series-1');
    expect(lines[1].getAttribute('class')).toContain('stroke-series-5');
    for (const l of lines) expect(l.getAttribute('class')).not.toMatch(NOT_A_SLOT);
  });

  it('highlighted draws the selected ring and a text tag, never a status colour', () => {
    const cells = [CELLS[0], { ...CELLS[1], highlighted: true }];
    const { container } = render(grid({ cells }));
    const [plain, picked] = cellsOf(container);
    expect(plain).not.toHaveAttribute('data-highlighted');
    expect(q(plain, '[data-slot="small-multiples-tag"]')).toBeNull();
    expect(picked).toHaveAttribute('data-highlighted');
    expect(picked).toHaveClass('inset-ring-accent');
    expect(picked.className).not.toMatch(/(ok|warn|crit)-/);
    expect(q(picked, '[data-slot="small-multiples-tag"]').textContent).toBe('Selected');
  });

  it('highlighted as a string is the tag’s words', () => {
    const cells = [{ ...CELLS[1], highlighted: 'Warning · 91 % used' }];
    const { container } = render(grid({ cells }));
    expect(q(container, '[data-slot="small-multiples-tag"]').textContent).toBe(
      'Warning · 91 % used'
    );
  });

  it('keeps the Chart’s keyboard crosshair in each cell', async () => {
    const user = userEvent.setup();
    const { container } = render(grid());
    await user.tab();
    expect(screen.getByRole('img', { name: 'Network Edge, CPU by node, last hour' })).toHaveFocus();
    expect(q(container, '[data-slot="chart-tooltip"]').textContent).toContain('25 %');
  });

  it('loading and failed are one placeholder or message for the set, never empty cells', () => {
    const { container, rerender } = render(grid({ state: 'loading' }));
    expect(cellsOf(container)).toHaveLength(0);
    expect(q(container, '[data-state="loading"]')).toBeTruthy();
    rerender(grid({ state: 'failed', detail: 'Prometheus didn’t answer' }));
    expect(cellsOf(container)).toHaveLength(0);
    expect(q(container, '[data-slot="chart-message"]').textContent).toBe('No data from Prometheus');
    expect(q(container, '[data-slot="chart-detail"]').textContent).toBe('Prometheus didn’t answer');
  });

  it('without a label it throws in development', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<SmallMultiples cells={CELLS} />)).toThrow(/needs a `label`/);
    vi.restoreAllMocks();
  });
});

describe('SmallMultiples phone', () => {
  const phone = (props) => grid({ variant: 'phone', ...props });

  it('is a list of rows, each a name, its latest reading and a sparkline', () => {
    const { container } = render(phone());
    const rows = cellsOf(container);
    expect(rows).toHaveLength(3);
    expect(container.querySelector('[data-variant="phone"]')).toBeTruthy();
    expect(qa(container, '[data-slot="sparkline"]')).toHaveLength(3);
    expect(q(rows[0], '[data-slot="small-multiples-latest"]').textContent).toBe('25 %');
    // No full chart in the list.
    expect(qa(container, '[data-slot="chart"]')).toHaveLength(0);
  });

  it('each row is a 44px target that opens the chart with its key', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(phone({ cells: FLAGGED, onOpen }));
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    for (const b of buttons) expect(b).toHaveClass('min-h-11', 'w-full');
    expect(buttons[2]).toHaveAccessibleName('Media, Critical, 95 %. Open the chart');
    await user.click(buttons[2]);
    expect(onOpen).toHaveBeenCalledWith('media');
    buttons[1].focus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenLastCalledWith('app');
  });

  it('without onOpen the rows are plain, not buttons', () => {
    render(phone());
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('a row with no data says so and draws no sparkline, never zero', () => {
    const cells = [CELLS[0], { key: 'off', name: 'Offline', points: [] }];
    const { container } = render(phone({ cells, onOpen: () => {} }));
    const [, off] = cellsOf(container);
    expect(off.textContent).toContain('No data');
    expect(off.textContent).not.toMatch(/\b0 %/);
    expect(q(off, '[data-slot="sparkline"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Offline, No data. Open the chart' })).toBeTruthy();
  });

  it('highlighted draws the ring and the tag on the row', () => {
    const cells = [{ ...CELLS[0], highlighted: true }, CELLS[1]];
    const { container } = render(phone({ cells, onOpen: () => {} }));
    const [picked] = cellsOf(container);
    expect(within(picked).getByRole('button')).toHaveClass('inset-ring-accent');
    expect(q(picked, '[data-slot="small-multiples-tag"]').textContent).toBe('Selected');
  });

  it('loading and failed show the set’s placeholder, no rows', () => {
    const { container } = render(phone({ state: 'loading' }));
    expect(cellsOf(container)).toHaveLength(0);
    expect(q(container, '[data-state="loading"]')).toBeTruthy();
  });

  it('draws a cell\'s `also` lines in the same chart, without changing its latest figure', () => {
    const also = [{ key: 'app-swap', name: 'Swap', slot: 1, points: pts([5, 5, 6, 6, 7]) }];
    const { container } = render(
      grid({ cells: [{ ...CELLS[1], also }, CELLS[0]], thresholds: undefined })
    );
    const [withAlso, plain] = cellsOf(container);
    expect(qa(withAlso, '[data-slot="chart-line"]')).toHaveLength(2);
    expect(qa(plain, '[data-slot="chart-line"]')).toHaveLength(1);
    expect(q(withAlso, '[data-slot="small-multiples-latest"]').textContent).toBe('45 %');
  });
});
