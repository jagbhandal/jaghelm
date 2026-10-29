import { describe, it, expect } from 'vitest';
import { chartsOf, seriesFor } from './historySeries.js';

// The drives' lines on a node's temperature chart (#728): the five hottest in
// name order after the node's sensor, "+N more" for the rest, a note on how
// often they move, and nothing changed for a node with no drive data.

const START = Date.UTC(2026, 9, 23, 11, 0, 0);
const line = (entity, v) => ({ entity, values: Array.from({ length: 4 }, () => v) });
const body = (drives, { node = true, driveOk = true } = {}) => ({
  series: [
    { series: 'node.cpu', ok: true, startMs: START, stepMs: 60_000, lines: [line('nas', 5)] },
    {
      series: 'node.temperature',
      ok: true,
      startMs: START,
      stepMs: 60_000,
      lines: node ? [line('nas', 45)] : [],
    },
    driveOk
      ? {
          series: 'drive.temperature',
          ok: true,
          startMs: START,
          stepMs: 60_000,
          lines: drives.map(([device, v]) => line(device, v)),
        }
      : { series: 'drive.temperature', ok: false, error: 'Prometheus refused the connection' },
  ],
});
const temperature = (answer, drives) =>
  chartsOf({ kind: 'node', entity: 'nas', drives }, answer, { range: '1h' }).find(
    (c) => c.key === 'temperature'
  );
const heat = (list) => list.map(([device, temperature]) => ({ device, temperature }));

describe('seriesFor', () => {
  it('a node asks for a fifth series only when it has drives', () => {
    expect(seriesFor('node')).toEqual(['node.cpu', 'node.memory', 'node.disk', 'node.temperature']);
    expect(seriesFor('node', { drives: true }).at(-1)).toBe('drive.temperature');
    expect(seriesFor('container', { drives: true })).toEqual(['container.cpu', 'container.memory']);
  });
});

describe('the temperature chart with drives', () => {
  const four = [
    ['sda', 40],
    ['sdb', 42],
    ['sdc', 39],
    ['nvme0', 31],
  ];

  it('the node sensor first, then each drive in name order, one name each', () => {
    const chart = temperature(body(four), heat(four));
    expect(chart.state).toBe('ready');
    expect(chart.series.map((s) => s.name)).toEqual(['Temperature', 'nvme0', 'sda', 'sdb', 'sdc']);
    expect(chart.series[1].points).toHaveLength(4);
    expect(chart.series[1].points[0]).toEqual({ time: START, value: 31 });
    expect(chart.note).toBe('Drives update about every 10 minutes');
  });

  it('with more than five, the five hottest are drawn, and the rest said as "+N more"', () => {
    const eight = [
      ['sda', 40],
      ['sdb', 42],
      ['sdc', 39],
      ['sdd', 55],
      ['sde', 30],
      ['sdf', 51],
      ['nvme0', 31],
      ['nvme1', 29],
    ];
    const chart = temperature(body(eight), heat(eight));
    // The hottest: sdd 55, sdf 51, sdb 42, sda 40, sdc 39; in name order. Six
    // lines in all is the chart's limit: the sensor and five.
    expect(chart.series.map((s) => s.name)).toEqual([
      'Temperature',
      'sda',
      'sdb',
      'sdc',
      'sdd',
      'sdf',
    ]);
    expect(chart.legendNote).toBe('+3 more drives, not drawn');
    expect(chart.note).toBe('Drives update about every 10 minutes');
  });

  it('exactly five drives with a sensor is six lines, none hidden', () => {
    const five = ['sda', 'sdb', 'sdc', 'sdd', 'sde'].map((d, i) => [d, 40 + i]);
    const chart = temperature(body(five), heat(five));
    expect(chart.series).toHaveLength(6);
    expect(chart.note).toBe('Drives update about every 10 minutes');
  });

  it('a node with no sensor draws its drives, and they keep the slots they have with one', () => {
    const chart = temperature(body(four, { node: false }), heat(four));
    expect(chart.series.map((s) => s.name)).toEqual(['nvme0', 'sda', 'sdb', 'sdc']);
  });

  it('a drive with no reading ranks last; a single hidden drive is "+1 more drive"', () => {
    const six = ['sda', 'sdb', 'sdc', 'sdd', 'sde', 'sdf'].map((d, i) => [d, 40 + i]);
    const drives = heat(six);
    drives[5].temperature = null; // sdf
    drives[0].temperature = null; // sda
    const chart = temperature(body(six), drives);
    // Two with no reading tie for last, by name: sdf is the one left out.
    expect(chart.series.map((s) => s.name)).not.toContain('sdf');
    expect(chart.series.map((s) => s.name)).toContain('sda');
    expect(chart.legendNote).toBe('+1 more drive, not drawn');
    expect(chart.note).not.toMatch(/more drive/);
  });

  it("the drives' series failing is said in the note, and the sensor's line stays", () => {
    const chart = temperature(body(four, { driveOk: false }), heat(four));
    expect(chart.state).toBe('ready');
    expect(chart.series.map((s) => s.name)).toEqual(['Temperature']);
    expect(chart.note).toBe('No data from Prometheus for drive temperatures');
  });

  it('a node with no drive data: the chart it always had, no note', () => {
    const chart = temperature(body(four), undefined);
    expect(chart.series.map((s) => s.name)).toEqual(['Temperature']);
    expect(chart.note).toBeNull();
    const none = temperature(body(four), []);
    expect(none.series.map((s) => s.name)).toEqual(['Temperature']);
  });

  const slots = (chart) => Object.fromEntries(chart.series.map((x) => [x.name, x.slot]));

  it('the sensor has slot 0 and a drive its place in the whole drive list by name', () => {
    const chart = temperature(body(four), heat(four));
    expect(slots(chart)).toEqual({ Temperature: 0, nvme0: 1, sda: 2, sdb: 3, sdc: 4 });
  });

  it('a drive leaving the five hottest leaves every other line its colour slot', () => {
    const six = ['sda', 'sdb', 'sdc', 'sdd', 'sde', 'sdf'].map((d, i) => [d, 50 - i]);
    const before = slots(temperature(body(six), heat(six))); // sdf (45) is left out
    expect(before.sdf).toBeUndefined();
    const cooled = heat(six);
    cooled[0].temperature = 20; // sda is now the coolest: it drops out, sdf comes in
    const after = slots(temperature(body(six), cooled));
    expect(after.sda).toBeUndefined();
    for (const d of ['sdb', 'sdc', 'sdd', 'sde']) expect(after[d]).toBe(before[d]);
    expect(Object.values(after)).toHaveLength(new Set(Object.values(after)).size);
  });

  it("the sensor's line missing from an answer leaves the drives' slots where they were", () => {
    const withSensor = slots(temperature(body(four), heat(four)));
    const without = slots(temperature(body(four, { node: false }), heat(four)));
    for (const d of ['nvme0', 'sda', 'sdb', 'sdc']) expect(without[d]).toBe(withSensor[d]);
    expect(without.Temperature).toBeUndefined();
  });
});
