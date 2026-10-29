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
