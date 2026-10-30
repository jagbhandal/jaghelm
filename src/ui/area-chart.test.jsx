import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AreaChart } from '@ui/area-chart';
import { Chart, ChartGroup } from '@ui/chart';

const q = (sel) => document.querySelector(sel);
const qa = (sel) => [...document.querySelectorAll(sel)];
const NOT_A_SLOT =
  /(^|\s)(stroke|fill|text|bg)-(meter|accent|ok|warn|crit|unknown|maintenance|info)(-|\s|$)/;

// Local times, so the default HH:MM reads the same in every time zone.
const at = (h, m) => new Date(2026, 9, 20, h, m).getTime();
const times = [at(8, 0), at(8, 15), at(8, 30), at(8, 45), at(9, 0)];
const pts = (values) => values.map((value, i) => ({ time: times[i], value }));
const mbps = (v) => `${Math.round(v)} MB/s`;

const IN = { key: 'in', name: 'In', points: pts([10, 40, 20, 60, 30]) };
const OUT = { key: 'out', name: 'Out', points: pts([5, 15, 25, 10, 20]) };

afterEach(() => vi.restoreAllMocks());

describe('AreaChart mirrored', () => {
  it('in above the zero line, out below, on one symmetric axis printed as magnitudes', () => {
    render(<AreaChart mirrored label="Traffic, last hour" series={[IN, OUT]} formatValue={mbps} />);
    const areas = qa('[data-slot="area-chart-area"]');
    expect(areas).toHaveLength(2);
    expect(areas[0]).toHaveClass('fill-series-1/20');
    expect(areas[1]).toHaveClass('fill-series-2/20');
    // Highest reading 60, so 0 to 60 either side: 4 ticks up... same extent down.
    const labels = qa('[data-slot="area-chart-y"] span:not(.invisible)').map((s) => s.textContent);
    expect(labels).toHaveLength(5);
    expect(labels[0]).toBe(labels[4]);
    expect(labels[1]).toBe(labels[3]);
    expect(labels[2]).toBe('0 MB/s');
    // The zero line is the stronger hairline, in the middle of the plot.
    const grid = qa('[data-slot="area-chart-grid"]');
    expect(grid[2]).toHaveClass('stroke-border');
    const zeroY = Number(grid[2].getAttribute('y1'));
    const ys = (slot) =>
      q(`[data-slot="area-chart-series"][data-key="${slot}"] [data-slot="area-chart-line"]`)
        .getAttribute('d')
        .match(/ (\d+(\.\d+)?)/g)
        .map((m) => Number(m));
    expect(Math.max(...ys('in'))).toBeLessThan(zeroY);
    expect(Math.min(...ys('out'))).toBeGreaterThan(zeroY);
    // Legend: names with where they sit; the words are never in a slot colour.
    expect(q('[data-slot="area-chart-legend"]').textContent).toBe('InaboveOutbelow');
    for (const el of qa('[data-slot="area-chart-legend"] span:not([data-slot])')) {
      expect(el.getAttribute('class') ?? '').not.toMatch(/series-/);
    }
  });

  it('is an image with a text summary of both series, and says which side each is on', () => {
    render(<AreaChart mirrored label="Traffic, last hour" series={[IN, OUT]} formatValue={mbps} />);
    expect(screen.getByRole('img', { name: 'Traffic, last hour' })).toHaveAccessibleDescription(
      'In (above zero): latest 30 MB/s at 09:00, lowest 10 MB/s, highest 60 MB/s. ' +
        'Out (below zero): latest 20 MB/s at 09:00, lowest 5 MB/s, highest 25 MB/s. ' +
        'The arrow keys read each point.'
    );
  });

  it('a missing reading breaks the area and is never drawn as zero', () => {
    const gap = (s) => ({ ...s, points: pts([10, 20, null, 30, 40]) });
    render(<AreaChart mirrored label="Traffic" series={[gap(IN), gap(OUT)]} formatValue={mbps} />);
    for (const key of ['in', 'out']) {
      const g = q(`[data-slot="area-chart-series"][data-key="${key}"]`);
      // Two runs of two readings: two shapes, two edges, and nothing over the gap.
      expect(
        g.querySelector('[data-slot="area-chart-area"]').getAttribute('d').match(/M/g)
      ).toHaveLength(2);
      expect(
        g.querySelector('[data-slot="area-chart-line"]').getAttribute('d').match(/M/g)
      ).toHaveLength(2);
    }
    // Its tooltip says "No data", not 0.
    const plot = screen.getByRole('img', { name: 'Traffic' });
    fireEvent.focus(plot);
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(q('[data-slot="area-chart-tooltip"]').textContent).toContain('No data');
    expect(qa('[data-slot="area-chart-dot"]')).toHaveLength(0);
    expect(q('[aria-live="polite"]').textContent).toBe('08:30: In no reading, Out no reading');
  });

  it('only one side missing leaves the other drawn; a negative rate is a gap too', () => {
    const out = { ...OUT, points: pts([5, -3, 25, 10, 20]) };
    render(<AreaChart mirrored label="Traffic" series={[IN, out]} formatValue={mbps} />);
    const d = (key) =>
      q(
        `[data-slot="area-chart-series"][data-key="${key}"] [data-slot="area-chart-line"]`
      ).getAttribute('d');
    expect(d('in').match(/M/g)).toHaveLength(1);
    // Out: one lone reading, then three: only the three draw.
    expect(d('out').match(/M/g)).toHaveLength(1);
    expect(d('out').match(/L/g)).toHaveLength(2);
  });

  it('the keyboard: focus shows the latest point, the arrows move, both values are read', async () => {
    const user = userEvent.setup();
    render(<AreaChart mirrored label="Traffic" series={[IN, OUT]} formatValue={mbps} />);
    await user.tab();
    expect(screen.getByRole('img', { name: 'Traffic' })).toHaveFocus();
    const tip = () => q('[data-slot="area-chart-tooltip"]');
    expect(tip().textContent).toBe('09:0030 MB/sIn20 MB/sOut');
    expect(qa('[data-slot="area-chart-dot"]')).toHaveLength(2);
    await user.keyboard('{ArrowLeft}');
    expect(q('[aria-live="polite"]').textContent).toBe('08:45: In 60 MB/s, Out 10 MB/s');
    await user.keyboard('{Home}');
    expect(q('[aria-live="polite"]').textContent).toMatch(/^08:00/);
    await user.keyboard('{Escape}');
    expect(tip()).toBeNull();
  });

  it('the pointer: the nearest time; touch follows a finger and lifting hides it', () => {
    render(<AreaChart mirrored label="Traffic" series={[IN, OUT]} formatValue={mbps} />);
    const plot = q('[data-slot="area-chart-plot"]');
    expect(plot).toHaveClass('touch-pan-y');
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 112));
    fireEvent.pointerMove(plot, { clientX: 105, pointerType: 'mouse' });
    const tip = () => q('[data-slot="area-chart-tooltip"]');
    expect(tip().textContent).toBe('08:1540 MB/sIn15 MB/sOut');
    fireEvent.pointerLeave(plot);
    expect(tip()).toBeNull();
    fireEvent.pointerDown(plot, { clientX: 300, pointerType: 'touch', pointerId: 3 });
    expect(tip().textContent.startsWith('08:45')).toBe(true);
    fireEvent.pointerUp(plot, { pointerType: 'touch', pointerId: 3 });
    expect(tip()).toBeNull();
  });

  it('never draws the accent or a status colour', () => {
    render(<AreaChart mirrored label="Traffic" series={[IN, OUT]} formatValue={mbps} />);
    fireEvent.focus(screen.getByRole('img', { name: 'Traffic' }));
    for (const el of q('[data-slot="area-chart"]').querySelectorAll('*')) {
      expect(el.getAttribute('class') ?? '').not.toMatch(NOT_A_SLOT);
    }
  });

  it('a series that names its slot keeps that colour', () => {
    render(
      <AreaChart
        mirrored
        label="Traffic"
        series={[
          { ...IN, slot: 3 },
          { ...OUT, slot: 5 },
        ]}
        formatValue={mbps}
      />
    );
    const areas = qa('[data-slot="area-chart-area"]');
    expect(areas[0]).toHaveClass('fill-series-4/20');
    expect(areas[1]).toHaveClass('fill-series-6/20');
  });

  it('refuses a third series', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(<AreaChart mirrored label="T" series={[IN, OUT, { ...IN, key: 'x' }]} />)
    ).toThrow(/two series/);
  });
});

describe('AreaChart plain', () => {
  const one = [{ key: 'w', name: 'Power', points: pts([80, 90, 85, 95, 88]) }];

  it('one filled series from the floor, no legend, a magnitude axis from 0', () => {
    render(<AreaChart label="Power, last hour" series={one} formatValue={(v) => `${v} W`} />);
    expect(q('[data-slot="area-chart"]')).toHaveAttribute('data-mode', 'area');
    expect(q('[data-slot="area-chart-legend"]')).toBeNull();
    expect(qa('[data-slot="area-chart-area"]')).toHaveLength(1);
    expect(q('[data-slot="area-chart-line"]')).toHaveClass('stroke-series-1', 'fill-none');
    const labels = qa('[data-slot="area-chart-y"] span:not(.invisible)').map((s) => s.textContent);
    expect(labels[0]).toBe('0 W');
    expect(screen.getByRole('img', { name: 'Power, last hour' })).toHaveAccessibleDescription(
      'latest 88 W at 09:00, lowest 80 W, highest 95 W. The arrow keys read each point.'
    );
  });

  it('a gap breaks the area', () => {
    const gap = [{ key: 'w', name: 'Power', points: pts([80, 90, null, 95, 88]) }];
    render(<AreaChart label="Power" series={gap} />);
    expect(q('[data-slot="area-chart-area"]').getAttribute('d').match(/M/g)).toHaveLength(2);
  });

  it('refuses a second series: that is the Chart', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(<AreaChart label="T" series={[...one, { ...one[0], key: 'b' }]} />)
    ).toThrow(/one series/);
  });
});

describe('AreaChart states', () => {
  it('loading is a placeholder named for assistive tech', () => {
    render(<AreaChart mirrored label="Traffic" series={[]} state="loading" />);
    expect(q('[data-slot="area-chart"]')).toHaveAttribute('data-state', 'loading');
    expect(q('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText('Traffic: loading')).toBeInTheDocument();
  });

  it('failed says so, and why; never an empty area that looks healthy', () => {
    render(
      <AreaChart mirrored label="Traffic" series={[IN, OUT]} state="failed" detail="Refused" />
    );
    expect(
      screen.getByRole('img', { name: 'Traffic: No data from Prometheus' })
    ).toBeInTheDocument();
    expect(q('[data-slot="area-chart-detail"]').textContent).toBe('Refused');
    expect(q('[data-slot="area-chart-area"]')).toBeNull();
  });

  it('no reading at all, or all gaps, says so', () => {
    const none = (s) => ({ ...s, points: pts([null, null, null, null, null]) });
    render(<AreaChart mirrored label="Traffic" series={[none(IN), none(OUT)]} />);
    expect(
      screen.getByRole('img', { name: 'Traffic: No readings in this range' })
    ).toBeInTheDocument();
  });

  it('needs a label', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<AreaChart series={[]} />)).toThrow(/label/);
  });

  it('busy dims the plot', () => {
    render(<AreaChart mirrored busy label="Traffic" series={[IN, OUT]} />);
    expect(q('[data-slot="area-chart"]')).toHaveAttribute('aria-busy', 'true');
    expect(q('[data-slot="area-chart-axes"]')).toHaveClass('opacity-60');
  });

  it('in a ChartGroup it takes the shared columns beside a Chart', () => {
    render(
      <ChartGroup>
        <Chart label="CPU" series={[{ key: 'c', name: 'CPU', points: pts([1, 2, 3, 4, 5]) }]} />
        <AreaChart mirrored label="Traffic" series={[IN, OUT]} formatValue={mbps} />
      </ChartGroup>
    );
    const fig = q('[data-slot="area-chart"]');
    expect(fig).toHaveClass('col-span-full', 'grid-cols-subgrid');
    expect(q('[data-slot="area-chart-axes"]')).toHaveClass('grid-cols-subgrid');
    expect(q('[data-slot="area-chart-x"]').textContent).toBe(
      q('[data-slot="chart-x"]').textContent
    );
  });
});
