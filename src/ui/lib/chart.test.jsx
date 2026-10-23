import { describe, it, expect } from 'vitest';
import { fitTicks, linePath, normalise, spreadLabels, timeTicks, valueAxis } from './chart.js';

// The line charts' shared geometry (#311): what the Chart and the Sparkline
// both draw from.

describe('lib/chart', () => {
  it('normalise: numbers or { time, value }, anything else a gap', () => {
    expect(normalise([1, null, 'x', { time: 5, value: 2 }, { time: 6, value: NaN }])).toEqual([
      { time: null, value: 1 },
      { time: null, value: null },
      { time: null, value: null },
      { time: 5, value: 2 },
      { time: 6, value: null },
    ]);
  });

  it('linePath: a run per stretch between gaps; a lone point draws nothing', () => {
    const xy = [
      { x: 0, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: null },
      { x: 3, y: 4 },
      { x: 4, y: null },
      { x: 5, y: 6 },
      { x: 6, y: 7 },
    ];
    const { line, runs } = linePath(xy);
    expect(line).toBe('M0 1L1 2M5 6L6 7');
    expect(runs).toHaveLength(2);
  });

  it('valueAxis: whole steps of 1, 2 or 5, from 0 for a magnitude, a step either side of a flat line', () => {
    expect(valueAxis(0, 100, { count: 2 })).toEqual({ lo: 0, hi: 100, ticks: [0, 50, 100] });
    expect(valueAxis(41, 47)).toEqual({ lo: 40, hi: 48, ticks: [40, 42, 44, 46, 48] });
    expect(valueAxis(43, 49).ticks).toEqual([42, 44, 46, 48, 50]);
    expect(valueAxis(120, 1300, { zero: true })).toEqual({
      lo: 0,
      hi: 1500,
      ticks: [0, 500, 1000, 1500],
    });
    expect(valueAxis(0.2, 0.9, { zero: true }).ticks).toEqual([0, 0.5, 1]);
    const flat = valueAxis(5, 5);
    expect(flat.lo).toBeLessThan(5);
    expect(flat.hi).toBeGreaterThan(5);
  });

  it('timeTicks: whole quarter hours, whole 6 hours, each local midnight', () => {
    const at = (d, h, m) => new Date(2026, 9, d, h, m).getTime();
    expect(timeTicks(at(20, 8, 3), at(20, 9, 3), 15 * 60_000)).toEqual([
      at(20, 8, 15),
      at(20, 8, 30),
      at(20, 8, 45),
      at(20, 9, 0),
    ]);
    expect(timeTicks(at(19, 9, 0), at(20, 9, 0), 6 * 3_600_000)).toEqual([
      at(19, 12, 0),
      at(19, 18, 0),
      at(20, 0, 0),
      at(20, 6, 0),
    ]);
    expect(timeTicks(at(13, 9, 30), at(20, 9, 30), 86_400_000)).toEqual(
      [14, 15, 16, 17, 18, 19, 20].map((d) => at(d, 0, 0))
    );
    expect(timeTicks(at(20, 8, 0), at(20, 9, 0), 15 * 60_000)[0]).toBe(at(20, 8, 0));
  });

  it('fitTicks: labels that would touch are left out; the ends are held inside the plot', () => {
    const ticks = [0, 40, 80, 120, 160, 200].map((x) => ({ t: x, x }));
    const kept = fitTicks(ticks, { width: 200, labelOf: () => 'Mon 19' });
    expect(kept.map((k) => [k.x, k.edge])).toEqual([
      [0, 'start'],
      [80, 'middle'],
      [160, 'middle'],
    ]);
    expect(fitTicks([{ t: 1, x: 190 }], { width: 200, labelOf: () => 'Mon 19' })[0].edge).toBe(
      'end'
    );
    expect(fitTicks(ticks, { width: 200, labelOf: () => '9' }).length).toBe(6);
  });

  it('spreadLabels: labels at least a gap apart, inside the plot, in the order of their lines', () => {
    const ys = spreadLabels(
      [
        { key: 'a', y: 50 },
        { key: 'b', y: 52 },
        { key: 'c', y: 108 },
      ],
      { gap: 16, top: 8, bottom: 104 }
    );
    expect(ys.b - ys.a).toBeGreaterThanOrEqual(16);
    expect(ys.c).toBe(104);
    expect(ys.c - ys.b).toBeGreaterThanOrEqual(16);
  });
});
