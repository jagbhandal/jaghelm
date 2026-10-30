import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Chart, ChartGroup, SLOT_DASHES } from '@ui/chart';

const q = (sel) => document.querySelector(sel);
const qa = (sel) => [...document.querySelectorAll(sel)];
const NOT_A_SLOT =
  /(^|\s)(stroke|fill|text|bg)-(meter|accent|ok|warn|crit|unknown|maintenance|info)(-|\s|$)/;

// Local times, so the default HH:MM reads the same in every time zone.
const at = (h, m) => new Date(2026, 9, 20, h, m).getTime();
const times = [at(8, 0), at(8, 15), at(8, 30), at(8, 45), at(9, 0)];
const pts = (values) => values.map((value, i) => ({ time: times[i], value }));
const pct = (v) => `${Math.round(v)} %`;

const NAMES = ['Network Edge', 'App Server', 'Storage', 'Media', 'Backup', 'Lab'];
const six = (n = 6) =>
  NAMES.slice(0, n).map((name, i) => ({
    key: `n${i}`,
    name,
    points: pts([10 + i * 5, 20 + i * 5, 15 + i * 5, 30 + i * 5, 25 + i * 5]),
  }));

afterEach(() => vi.restoreAllMocks());

describe('Chart', () => {
  it('one series: slot 1, solid, with value and time axes, and no legend or label', () => {
    render(
      <Chart
        label="CPU, last hour"
        series={[{ key: 'cpu', name: 'CPU', points: pts([12, 48, 30, 41, 22]) }]}
        formatValue={pct}
      />
    );
    const lines = qa('[data-slot="chart-line"]');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveClass('stroke-series-1', 'fill-none');
    expect(lines[0]).toHaveAttribute('stroke-width', '2');
    expect(lines[0]).not.toHaveAttribute('stroke-dasharray');
    expect(q('[data-slot="chart-legend"]')).toBeNull();
    expect(q('[data-slot="chart-labels"]')).toBeNull();
    // 0–100 % with a hairline at each tick; the times every 15 minutes.
    expect(q('[data-slot="chart-y"]').textContent).toBe('100 %0 %50 %100 %');
    expect(qa('[data-slot="chart-grid"]')).toHaveLength(3);
    // Centred on their ticks: the ends, whose labels would run past the plot, left out.
    expect(q('[data-slot="chart-x"]').textContent).toBe('08:1508:3008:45');
    expect(screen.getByRole('img', { name: 'CPU, last hour' })).toHaveAccessibleDescription(
      'latest 22 % at 09:00, lowest 12 %, highest 48 %. The arrow keys read each point.'
    );
  });

  it('three series: a legend and a label at each line’s end, all solid, words never in a slot colour', () => {
    render(<Chart label="Usage, last hour" series={six(3)} formatValue={pct} />);
    const lines = qa('[data-slot="chart-line"]');
    expect(lines.map((l) => l.getAttribute('class').match(/stroke-series-\d/)[0])).toEqual([
      'stroke-series-1',
      'stroke-series-2',
      'stroke-series-3',
    ]);
    expect(lines.every((l) => !l.hasAttribute('stroke-dasharray'))).toBe(true);
    expect(qa('[data-slot="chart-legend"] li').map((li) => li.textContent)).toEqual(
      NAMES.slice(0, 3)
    );
    expect(qa('[data-slot="chart-label"]').map((l) => l.textContent)).toEqual(NAMES.slice(0, 3));
    for (const el of qa('[data-slot="chart-legend"] span, [data-slot="chart-label"]')) {
      expect(el.getAttribute('class') ?? '').not.toMatch(/series-/);
    }
  });

  it('more than three series: slots 4 to 6 dashed, each its own pattern, in the plot, legend and labels', () => {
    render(<Chart label="CPU by node, last hour" series={six()} formatValue={pct} />);
    const dashes = qa('[data-slot="chart-line"]').map((l) => l.getAttribute('stroke-dasharray'));
    expect(dashes).toEqual([null, null, null, '6 6', '0.5 5', '10 5 0.5 5']);
    expect(new Set(SLOT_DASHES.slice(3)).size).toBe(3);
    const keyDash = (root) =>
      [...root.querySelectorAll('[data-slot="chart-key"] line')].map((l) =>
        l.getAttribute('stroke-dasharray')
      );
    expect(keyDash(q('[data-slot="chart-legend"]'))).toEqual(dashes);
    expect(keyDash(q('[data-slot="chart-labels"]')).slice(1)).toEqual(dashes);
    // Every line carries its name at its right end.
    expect(qa('[data-slot="chart-label"]')).toHaveLength(6);
  });

  it('a series marked dashed is drawn in long dashes in its own slot, in the plot and the legend (#754)', () => {
    const [a, b] = six(2);
    render(<Chart label="Disk filling" series={[a, { ...b, dashed: true }]} formatValue={pct} />);
    expect(qa('[data-slot="chart-line"]').map((l) => l.getAttribute('stroke-dasharray'))).toEqual([null, '6 6']);
    const keys = [...q('[data-slot="chart-legend"]').querySelectorAll('[data-slot="chart-key"] line')];
    expect(keys.map((l) => l.getAttribute('stroke-dasharray'))).toEqual([null, '6 6']);
  });

  it('a series that names its slot keeps that colour; a legendNote ends the legend, with no key', () => {
    const two = six(2).map((s, i) => ({ ...s, slot: i === 0 ? 4 : 2 }));
    render(
      <Chart label="T" series={two} formatValue={pct} legendNote="+3 more drives, not drawn" />
    );
    const lines = qa('[data-slot="chart-line"]');
    expect(lines[0]).toHaveClass('stroke-series-5');
    expect(lines[1]).toHaveClass('stroke-series-3');
    const legend = q('[data-slot="chart-legend"]');
    const note = legend.querySelector('[data-slot="chart-legend-note"]');
    expect(note).toHaveTextContent('+3 more drives, not drawn');
    expect(note.querySelector('svg')).toBeNull();
    expect(legend.lastElementChild).toBe(note);
  });

  it('labels of lines that end close together are moved apart, with a leader to their line', () => {
    const close = [
      { key: 'a', name: 'Memory', points: pts([40, 40, 41, 40, 40]) },
      { key: 'b', name: 'Disk', points: pts([41, 41, 41, 41, 41]) },
    ];
    render(<Chart label="Usage" series={close} formatValue={pct} />);
    const tops = qa('[data-slot="chart-label"]').map((l) => parseFloat(l.style.top));
    expect(Math.abs(tops[0] - tops[1])).toBeGreaterThanOrEqual(16);
    expect(qa('[data-slot="chart-leader"]').length).toBeGreaterThan(0);
  });

  it('never draws the accent or a status colour', () => {
    render(<Chart label="CPU by node" series={six()} formatValue={pct} />);
    fireEvent.focus(screen.getByRole('img', { name: 'CPU by node' }));
    for (const el of q('[data-slot="chart"]').querySelectorAll('*')) {
      expect(el.getAttribute('class') ?? '').not.toMatch(NOT_A_SLOT);
    }
  });

  it('a missing reading breaks the line rather than bridging it', () => {
    render(
      <Chart
        label="CPU"
        series={[{ key: 'c', name: 'CPU', points: pts([10, 20, null, 30, 40]) }]}
      />
    );
    expect(q('[data-slot="chart-line"]').getAttribute('d').match(/M/g)).toHaveLength(2);
  });

  it("'auto' fits the readings, 'zero' starts at 0", () => {
    const temps = [{ key: 't', name: 'Temperature', points: pts([41, 44, 47, 45, 43]) }];
    const { rerender } = render(
      <Chart label="Temperature" series={temps} domain="auto" formatValue={(v) => `${v} °C`} />
    );
    expect(q('[data-slot="chart-y"]').textContent).toBe('40 °C40 °C42 °C44 °C46 °C48 °C');
    rerender(
      <Chart label="Temperature" series={temps} domain="zero" formatValue={(v) => `${v} °C`} />
    );
    expect(q('[data-slot="chart-y"]').textContent.startsWith('20 °C0 °C')).toBe(true);
  });

  it('the keyboard: focus shows the latest point, the arrows move, the live region says each', async () => {
    const user = userEvent.setup();
    render(<Chart label="Usage" series={six(2)} formatValue={pct} />);
    await user.tab();
    expect(screen.getByRole('img', { name: 'Usage' })).toHaveFocus();
    const tip = () => q('[data-slot="chart-tooltip"]');
    expect(tip().textContent).toBe('09:0025 %Network Edge30 %App Server');
    expect(qa('[data-slot="chart-dot"]')).toHaveLength(2);
    await user.keyboard('{ArrowLeft}');
    expect(tip().textContent).toContain('08:45');
    expect(q('[aria-live="polite"]').textContent).toBe('08:45: Network Edge 30 %, App Server 35 %');
    await user.keyboard('{Home}');
    expect(q('[aria-live="polite"]').textContent).toMatch(/^08:00/);
    await user.keyboard('{Escape}');
    expect(tip()).toBeNull();
    expect(tip()).toBeNull();
  });

  it('the pointer: the crosshair finds the nearest time and the tooltip lists every series', () => {
    render(<Chart label="CPU by node" series={six()} formatValue={pct} />);
    const plot = q('[data-slot="chart-plot"]');
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 112));
    fireEvent.pointerMove(plot, { clientX: 105, pointerType: 'mouse' });
    expect(q('[data-slot="chart-crosshair"]')).not.toBeNull();
    const tip = q('[data-slot="chart-tooltip"]');
    expect(tip.textContent.startsWith('08:15')).toBe(true);
    for (const name of NAMES) expect(tip.textContent).toContain(name);
    expect(qa('[data-slot="chart-dot"]')).toHaveLength(6);
    fireEvent.pointerLeave(plot);
    expect(q('[data-slot="chart-tooltip"]')).toBeNull();
  });

  it('touch (#602): a finger down shows the nearest time, a drag follows it, lifting hides it', () => {
    render(<Chart label="CPU by node" series={six(3)} formatValue={pct} />);
    const plot = q('[data-slot="chart-plot"]');
    // A sideways drag is the chart's; an up-and-down one still scrolls the sheet.
    expect(plot).toHaveClass('touch-pan-y');
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 112));
    const tip = () => q('[data-slot="chart-tooltip"]');
    fireEvent.pointerDown(plot, { clientX: 105, pointerType: 'touch', pointerId: 7 });
    expect(tip().textContent.startsWith('08:15')).toBe(true);
    expect(qa('[data-slot="chart-dot"]')).toHaveLength(3);
    fireEvent.pointerMove(plot, { clientX: 300, pointerType: 'touch', pointerId: 7 });
    expect(tip().textContent.startsWith('08:45')).toBe(true);
    fireEvent.pointerUp(plot, { clientX: 300, pointerType: 'touch', pointerId: 7 });
    expect(tip()).toBeNull();
    expect(q('[data-slot="chart-crosshair"]')).toBeNull();
    // The tap focuses the plot after the finger lifts: that opens nothing.
    fireEvent.focus(plot);
    expect(tip()).toBeNull();
    // A scroll that takes the finger over cancels it: hidden too.
    fireEvent.pointerDown(plot, { clientX: 5, pointerType: 'touch', pointerId: 8 });
    expect(tip().textContent.startsWith('08:00')).toBe(true);
    fireEvent.pointerCancel(plot, { pointerType: 'touch', pointerId: 8 });
    expect(tip()).toBeNull();
    // The keyboard still reaches it once the finger is gone.
    fireEvent.keyDown(plot, { key: 'End' });
    expect(tip().textContent.startsWith('09:00')).toBe(true);
  });

  it('Prometheus failing says so, never an empty line; no reading says that; loading holds the space', () => {
    const { rerender } = render(
      <Chart label="CPU" series={[]} state="failed" detail="Prometheus didn't answer" />
    );
    expect(screen.getByRole('img', { name: 'CPU: No data from Prometheus' })).toBeInTheDocument();
    expect(q('[data-slot="chart-detail"]').textContent).toBe("Prometheus didn't answer");
    expect(q('[data-slot="chart-line"]')).toBeNull();
    rerender(
      <Chart
        label="CPU"
        series={[{ key: 'c', name: 'CPU', points: pts([null, null, null, null, null]) }]}
      />
    );
    expect(screen.getByRole('img', { name: 'CPU: No readings in this range' })).toBeInTheDocument();
    rerender(<Chart label="CPU" series={[]} state="loading" />);
    expect(q('[data-slot="chart"] [aria-busy="true"]')).not.toBeNull();
  });

  it('busy keeps the last lines, dimmed', () => {
    render(<Chart label="CPU" series={six(1)} busy />);
    expect(q('[data-slot="chart"]')).toHaveAttribute('aria-busy', 'true');
    expect(q('[data-slot="chart-line"]')).not.toBeNull();
    expect(q('[data-slot="chart-plot"]').parentElement).toHaveClass('opacity-60');
  });

  it('refuses a seventh series and a chart with no name', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const seven = [...six(), { key: 'x', name: 'Seventh', points: pts([1, 2, 3, 4, 5]) }];
    expect(() => render(<Chart label="Too many" series={seven} />)).toThrow(/at most 6/);
    expect(() => render(<Chart series={six(1)} />)).toThrow(/needs a `label`/);
  });

  it('in a ChartGroup, charts of different units share one time axis: the columns, and the same ticks', () => {
    render(
      <ChartGroup>
        <Chart label="Usage" series={six(3)} formatValue={pct} />
        <Chart
          label="Temperature"
          series={[{ key: 't', name: 'Temperature', points: pts([41, 44, 47, 45, 43]) }]}
          domain="auto"
          formatValue={(v) => `${v} °C`}
        />
      </ChartGroup>
    );
    const charts = qa('[data-slot="chart"]');
    // Each lays its labels, plot and names into the group's three columns.
    expect(q('[data-slot="chart-group"]')).toHaveClass('grid-cols-[auto_minmax(0,1fr)_auto]');
    for (const chart of charts) {
      expect(chart).toHaveClass('col-span-full', 'grid-cols-subgrid');
      expect(chart.querySelector('[data-slot="chart-axes"]')).toHaveClass('grid-cols-subgrid');
      // Three cells in its first row, an empty one where a single series names no line.
      expect(chart.querySelector('[data-slot="chart-axes"]').children[2]).not.toBeNull();
    }
    const ticks = charts.map((c) => c.querySelector('[data-slot="chart-x"]').textContent);
    expect(ticks[0]).toBe(ticks[1]);
  });
});

// Reference lines and the max band (#746).
describe('Chart: reference lines and the max band', () => {
  const avg = [{ key: 'cpu', name: 'CPU', points: pts([40, 82, 85, 60, 95]) }];
  const marks = [
    { level: 'warn', value: 80, mark: true },
    { level: 'crit', value: 90 },
  ];

  it('draws a line at each given value with its words, in the status colour but never as a series', () => {
    render(<Chart label="CPU" series={avg} formatValue={pct} thresholds={marks} />);
    const lines = qa('[data-slot="chart-threshold"] > line:first-child');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveClass('stroke-warn-fg');
    expect(lines[0]).toHaveAttribute('stroke-dasharray', '4 4');
    expect(lines[1]).toHaveClass('stroke-crit-fg');
    expect(lines[1]).not.toHaveAttribute('stroke-dasharray');
    // y is the value's place on 0–100: warn (80) is under crit (90).
    expect(Number(lines[0].getAttribute('y1'))).toBeGreaterThan(
      Number(lines[1].getAttribute('y1'))
    );
    // The words are there, not the colour alone.
    expect(qa('[data-slot="chart-threshold-label"]').map((e) => e.textContent)).toEqual([
      'Warn 80 %',
      'Critical 90 %',
    ]);
    // The series itself stays in a slot.
    expect(q('[data-slot="chart-line"]')).toHaveClass('stroke-series-1');
  });

  it('takes the caller’s own label, and keeps two close labels apart', () => {
    render(
      <Chart
        label="CPU"
        series={avg}
        height={72}
        thresholds={[
          { level: 'warn', value: 80, label: 'Warn at 80 % (5 min)' },
          { level: 'crit', value: 85 },
        ]}
      />
    );
    const labels = qa('[data-slot="chart-threshold-label"]');
    expect(labels[0].textContent).toBe('Warn at 80 % (5 min)');
    const tops = labels.map((l) => parseFloat(l.style.top));
    expect(Math.abs(tops[0] - tops[1])).toBeGreaterThanOrEqual(16);
  });

  it('marks the breached span as a heavier stretch of the line and says it in the summary', () => {
    render(<Chart label="CPU" series={avg} formatValue={pct} thresholds={marks} />);
    const breach = qa('[data-slot="chart-breach"]');
    // Warn (marked) is crossed at 08:15 to 09:00 on 82, 85, 60?, 95: 82 and 85, then 95 alone.
    expect(breach).toHaveLength(2);
    expect(breach[0]).toHaveClass('stroke-warn-fg');
    expect(Number(breach[0].getAttribute('x2'))).toBeGreaterThan(
      Number(breach[0].getAttribute('x1'))
    );
    const desc = screen.getByRole('img', { name: 'CPU' }).getAttribute('aria-describedby');
    const words = document.getElementById(desc).textContent;
    expect(words).toContain('Warn 80 %: reached from 08:15 to 08:30, at 09:00.');
    expect(words).toContain('Critical 90 %: reached at 09:00.');
  });

  it('a floor: direction below puts the words under the line and marks readings at or under it', () => {
    render(
      <Chart
        label="Free"
        series={[{ key: 'f', name: 'Free', points: pts([50, 20, 10, 40, 60]) }]}
        thresholds={[{ level: 'crit', value: 15, direction: 'below', mark: true }]}
      />
    );
    expect(qa('[data-slot="chart-breach"]')).toHaveLength(1);
    const desc = screen.getByRole('img', { name: 'Free' }).getAttribute('aria-describedby');
    expect(document.getElementById(desc).textContent).toContain('Critical 15: under at 08:30.');
  });

  it('says so when a line is never reached, and leaves one off a fixed axis undrawn but named', () => {
    render(
      <Chart
        label="CPU"
        series={avg}
        thresholds={[
          { level: 'warn', value: 99 },
          { level: 'crit', value: 150 },
        ]}
      />
    );
    expect(qa('[data-slot="chart-threshold"]')).toHaveLength(1);
    const desc = screen.getByRole('img', { name: 'CPU' }).getAttribute('aria-describedby');
    const words = document.getElementById(desc).textContent;
    expect(words).toContain('Warn 99: never reached.');
    expect(words).toContain('Critical 150 (off this axis): never reached.');
  });

  it('a fitted axis grows to hold the lines; a bad level or value is ignored', () => {
    render(
      <Chart
        label="Temp"
        series={[{ key: 't', name: 'Temp', points: pts([40, 44, 47, 45, 43]) }]}
        domain="auto"
        formatValue={(v) => `${v} °C`}
        thresholds={[
          { level: 'crit', value: 80 },
          { level: 'nope', value: 60 },
          { level: 'warn', value: 'x' },
        ]}
      />
    );
    expect(qa('[data-slot="chart-threshold"]')).toHaveLength(1);
    expect(q('[data-slot="chart-y"]').textContent).toContain('80 °C');
  });

  it('the max band: only when supplied, behind the line in its slot, in the legend, summary and tooltip', async () => {
    const { rerender } = render(<Chart label="CPU" series={avg} formatValue={pct} />);
    expect(q('[data-slot="chart-band"]')).toBeNull();
    expect(q('[data-slot="chart-legend"]')).toBeNull();

    const band = { name: 'Peak', points: pts([55, 90, 99, 70, 100]) };
    rerender(<Chart label="CPU" series={avg} formatValue={pct} band={band} />);
    const shape = q('[data-slot="chart-band"]');
    expect(shape).toHaveClass('fill-series-1');
    expect(shape.getAttribute('d')).toMatch(/^M.*Z$/);
    // Behind the line: it comes before it in the SVG.
    expect(
      shape.compareDocumentPosition(q('[data-slot="chart-line"]')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(q('[data-slot="chart-legend-band"]').textContent).toBe('Peak');
    const desc = screen.getByRole('img', { name: 'CPU' }).getAttribute('aria-describedby');
    expect(document.getElementById(desc).textContent).toContain(
      'Peak (the band behind the line): highest 100 % at 09:00.'
    );

    const user = userEvent.setup();
    await user.tab();
    const tip = q('[data-slot="chart-tooltip"]');
    expect(tip.textContent).toContain('100 %Peak');
    expect(tip.textContent).toContain('95 %');
  });

  it('the band is drawn against the series named by `of`, breaks at a gap, and a lone point draws nothing', () => {
    const two = [
      { key: 'a', name: 'A', points: pts([10, 20, 30, 20, 10]) },
      { key: 'b', name: 'B', points: pts([30, 40, 50, 40, 30]) },
    ];
    render(
      <Chart label="Two" series={two} band={{ of: 'b', points: pts([60, 70, null, 70, 60]) }} />
    );
    const shape = q('[data-slot="chart-band"]');
    expect(shape).toHaveClass('fill-series-2');
    // Two stretches of two points each.
    expect(shape.getAttribute('d').match(/M/g)).toHaveLength(2);
    expect(q('[data-slot="chart-legend-band"]').textContent).toBe('Max');
  });

  it('the tooltip and the live region say which lines a point is past', async () => {
    render(<Chart label="CPU" series={avg} formatValue={pct} thresholds={marks} />);
    const user = userEvent.setup();
    await user.tab();
    expect(q('[data-slot="chart-tooltip"]').textContent).toContain('over Warn 80 %');
    expect(q('[data-slot="chart-tooltip"]').textContent).toContain('over Critical 90 %');
    await user.keyboard('{ArrowLeft}');
    expect(q('[data-slot="chart-tooltip"]').textContent).not.toContain('over Warn');
    expect(screen.getByText(/09:00|08:45/, { selector: '[aria-live]' }).textContent).toBe(
      '60 % at 08:45'
    );
  });

  it('nothing changes with neither prop, and neither draws while loading or failed', () => {
    const { rerender } = render(<Chart label="CPU" series={avg} formatValue={pct} />);
    expect(q('[data-slot="chart-threshold"]')).toBeNull();
    expect(q('[data-slot="chart-breach"]')).toBeNull();
    rerender(<Chart label="CPU" series={avg} state="loading" thresholds={marks} />);
    expect(q('[data-slot="chart-threshold"]')).toBeNull();
    rerender(
      <Chart label="CPU" series={[]} state="failed" thresholds={marks} band={{ points: [] }} />
    );
    expect(q('[data-state="failed"]')).not.toBeNull();
    expect(q('[data-slot="chart-band"]')).toBeNull();
  });
});
