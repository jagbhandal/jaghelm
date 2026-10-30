import { describe, it, expect } from 'vitest';
import {
  bandPath,
  breachRuns,
  evenTicks,
  linePath,
  normalise,
  spreadLabels,
  timeTicks,
  valueAxis,
} from './chart.js';

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

  it('valueAxis with `format` (#602): a coarser nice step until no two labels print the same', () => {
    const whole = (v) => String(Math.floor(v)); // rounded down, as a reading prints (#450)
    const tenths = (v) => (Math.floor(v * 10) / 10).toFixed(1);
    // 47.2–48.4 at half steps prints 47, 47, 48, 48: whole steps instead.
    expect(valueAxis(47.2, 48.4).ticks).toEqual([47, 47.5, 48, 48.5]);
    expect(valueAxis(47.2, 48.4, { format: whole }).ticks).toEqual([47, 48, 49]);
    // Under one, from 0: 0 and 1, never 0, 0, 0.
    expect(valueAxis(0.1, 0.9, { zero: true, format: whole }).ticks).toEqual([0, 1]);
    // Steps finer than the hundredths the ticks keep move up too.
    expect(valueAxis(0.001, 0.004, { zero: true, format: tenths }).ticks).toEqual([0, 0.1]);
    // A flat 0 °C line: 0 and 1, never an axis under 0 that prints "0" twice.
    expect(valueAxis(0, 0, { format: whole }).ticks).toEqual([0, 1]);
    // Labels already apart keep the finer step.
    expect(valueAxis(41, 47, { format: whole }).ticks).toEqual([40, 42, 44, 46, 48]);
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

  it('evenTicks: one even stride, counted on the clock, labels inside the plot', () => {
    const at = (d, h, m) => new Date(2026, 9, d, h, m).getTime();
    const from = at(13, 9, 30);
    const to = at(20, 9, 30);
    const day = 86_400_000;
    const label = (t) =>
      new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric' }).format(t);
    const ticksAt = (width) =>
      evenTicks(
        timeTicks(from, to, day).map((t) => ({ t, x: ((t - from) / (to - from)) * width })),
        { width, every: day, span: to - from, labelOf: label }
      );
    // Wide: a label a day. Narrow: every other day, the same days whatever the start.
    expect(ticksAt(600).map((k) => new Date(k.t).getDate())).toEqual([14, 15, 16, 17, 18, 19, 20]);
    const narrow = ticksAt(330);
    const days = narrow.map((k) => new Date(k.t).getDate());
    expect(days.length).toBeGreaterThanOrEqual(3);
    const gaps = narrow.slice(1).map((k, i) => k.t - narrow[i].t);
    expect(new Set(gaps).size).toBe(1);
    expect(gaps[0]).toBe(2 * day);
    // Every label stays inside the plot, centred on its tick.
    for (const k of narrow) {
      expect(k.x - (k.text.length * 7) / 2).toBeGreaterThanOrEqual(0);
      expect(k.x + (k.text.length * 7) / 2).toBeLessThanOrEqual(330);
    }
    // Two charts of the same range and width: the same ticks.
    expect(ticksAt(330)).toEqual(narrow);
  });

  it('evenTicks: a narrow hour keeps the hour and the half, never a stray quarter', () => {
    const at = (h, m) => new Date(2026, 9, 20, h, m).getTime();
    const from = at(8, 0);
    const to = at(9, 0);
    const every = 15 * 60_000;
    const hm = (t) => new Date(t).toTimeString().slice(0, 5);
    const ticks = (width) =>
      evenTicks(
        timeTicks(from, to, every).map((t) => ({ t, x: ((t - from) / (to - from)) * width })),
        { width, every, span: to - from, labelOf: hm }
      ).map((k) => k.text);
    expect(ticks(400)).toEqual(['08:15', '08:30', '08:45']);
    expect(ticks(150)).toEqual(['08:30']);
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

  it('bandPath: a closed shape per stretch between gaps, a lone point nothing, a low ceiling lifted onto the line', () => {
    const line = [
      { x: 0, y: 50 },
      { x: 10, y: 40 },
      { x: 20, y: null },
      { x: 30, y: 40 },
      { x: 40, y: 30 },
    ];
    const top = [
      { x: 0, y: 20 },
      { x: 10, y: 60 },
      { x: 20, y: 10 },
      { x: 30, y: 20 },
      { x: 40, y: 10 },
    ];
    // The ceiling at x=10 (60) sits under the line (40): the band takes the line's y.
    expect(bandPath(top, line)).toBe('M0 20L10 40L10 40L0 50ZM30 20L40 10L40 30L30 40Z');
    expect(bandPath([{ x: 0, y: 1 }], [{ x: 0, y: 2 }])).toBe('');
    expect(bandPath([], [])).toBe('');
  });

  it('breachRuns: inclusive stretches of consecutive indices; a lone one is a stretch of one', () => {
    const hit = [0, 1, 1, 0, 1, 0, 1, 1];
    expect(breachRuns(hit.length, (i) => hit[i] === 1)).toEqual([
      { from: 1, to: 2 },
      { from: 4, to: 4 },
      { from: 6, to: 7 },
    ]);
    expect(breachRuns(3, () => false)).toEqual([]);
    expect(breachRuns(3, () => true)).toEqual([{ from: 0, to: 2 }]);
  });
});
