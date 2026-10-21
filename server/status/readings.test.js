/**
 * A node reading's lines as the screens draw them (#451): read from the
 * threshold set /api/status serves, in the reading's own unit. And the one
 * rule for showing a reading beside them (#450), which the model's reasons and
 * every meter use.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { node } from '../testing/statusFixtures.js';
import {
  atOrOver,
  lineNumber,
  percentOf,
  readingLines,
  shownReading,
  toHundredths,
} from './readings.js';
import { coerceFraction, judgeNode, levelOf } from './rules.js';
import { DEFAULT_THRESHOLDS, resolveThresholds } from './thresholds.js';

test('readingLines: each reading the model judges, in its unit, with the defaults', () => {
  const t = DEFAULT_THRESHOLDS;
  // `band`: how far under its line a level holds (the hysteresis), in the same unit.
  assert.deepEqual(readingLines(t, 'cpu'), { warn: 90, band: 5 });
  assert.deepEqual(readingLines(t, 'mem'), { warn: 90, band: 5 });
  assert.deepEqual(readingLines(t, 'disk'), { warn: 90, crit: 95, band: 5 });
  assert.deepEqual(readingLines(t, 'temp'), { warn: 75, crit: 85, band: 5 });
  // A storage pool feeds the disk rule (spec §6.1), so it has the disk's lines.
  assert.deepEqual(readingLines(t, 'pool:local-lvm'), { warn: 90, crit: 95, band: 5 });
});

test("readingLines: display-config's pushThresholds move them, as the model reads them", () => {
  const t = resolveThresholds({ cpu: 0.8, mem: 0.875, disk: 0.97, hysteresis: 0.025 });
  assert.deepEqual(readingLines(t, 'cpu'), { warn: 80, band: 2.5 });
  assert.deepEqual(readingLines(t, 'mem'), { warn: 87.5, band: 2.5 });
  // A warn line above the crit line moves the crit line up to it.
  assert.deepEqual(readingLines(t, 'disk'), { warn: 97, crit: 97, band: 2.5 });
  assert.deepEqual(readingLines(t, 'pool:tank'), { warn: 97, crit: 97, band: 2.5 });
  // The temperature's hysteresis is in °C, and not set by pushThresholds.
  assert.deepEqual(readingLines(t, 'temp'), { warn: 75, crit: 85, band: 5 });
});

test('readingLines: the served JSON reads the same as the object the model was given', () => {
  const t = resolveThresholds({ mem: 0.57, disk: 0.86 });
  const served = JSON.parse(JSON.stringify(t));
  for (const reading of ['cpu', 'mem', 'disk', 'temp', 'pool:x']) {
    assert.deepEqual(readingLines(served, reading), readingLines(t, reading), reading);
  }
  // 0.57 × 100 is 56.99999999999999 in floating point; the line is 57.
  assert.deepEqual(readingLines(t, 'mem'), { warn: 57, band: 5 });
});

test('readingLines: no lines for a reading the table has none for, or with no thresholds', () => {
  for (const reading of ['uptime', 'charge', 'pool', '', undefined]) {
    assert.deepEqual(readingLines(DEFAULT_THRESHOLDS, reading), {}, String(reading));
  }
  for (const thresholds of [null, undefined, {}, 'junk', { disk: null }]) {
    assert.deepEqual(readingLines(thresholds, 'disk'), {}, JSON.stringify(thresholds));
  }
  // A line that isn't a number is left out, never NaN; so is a band without one.
  assert.deepEqual(readingLines({ disk: { warn: 0.9, crit: '0.95' } }, 'disk'), { warn: 90 });
});

test('percentOf: a line as a percentage, to a hundredth', () => {
  assert.deepEqual(
    [0.9, 0.95, 0.875, 0.57, 0.9125, 0.12346, 0, 1].map(percentOf),
    [90, 95, 87.5, 57, 91.25, 12.35, 0, 100]
  );
});

// ── The one rule for showing a reading (#450) ────────────────────────────

const DISK = { warn: 90, crit: 95, band: 5 };

test('shownReading: rounded down, so a reading never shows at or over a line it is under', () => {
  const rows = [
    [94.6, 94], // under the 95 % crit line: 94, never 95
    [94.99, 94],
    [95, 95], // on the line: at it
    [95.4, 95],
    [89.9, 89],
    [90, 90],
    [33.6, 33],
    [0, 0],
    [100, 100],
    [130, 130],
  ];
  for (const [value, shown] of rows) assert.equal(shownReading(value, DISK), shown, `${value}`);
  // Floating-point noise is not a reading under the line: 0.29 × 100 is
  // 28.999999999999996, and the model reads usage as a fraction.
  assert.equal(shownReading(0.29 * 100, DISK), 29);
  assert.equal(shownReading(0.95 * 100, DISK), 95);
  // Without lines, the same: whole and rounded down.
  assert.equal(shownReading(99.6), 99);
  assert.equal(shownReading(43.5, {}), 43);
  // In °C, by the temperature's lines.
  assert.equal(shownReading(74.6, { warn: 75, crit: 85, band: 5 }), 74);
  assert.equal(shownReading(85, { warn: 75, crit: 85, band: 5 }), 85);
});

test('shownReading: beside a line with a fraction, to its decimals, so a reading over it never reads under it', () => {
  // pushThresholds.disk 0.875: the warn line is 87.5 %.
  const half = { warn: 87.5, crit: 95, band: 5 };
  const rows = [
    [87.4, 87.4],
    [87.49, 87.4],
    [87.5, 87.5], // on the line, not "87"
    [87.6, 87.6],
    [94.6, 94.6],
    [95, 95],
    [40, 40],
  ];
  for (const [value, shown] of rows) assert.equal(shownReading(value, half), shown, `${value}`);
  // A line to a hundredth (0.9125): two decimals.
  assert.equal(shownReading(91.24, { warn: 91.25 }), 91.24);
  // Finer than a hundredth, a reading is on the grid first, as the model judges it.
  assert.equal(shownReading(91.249, { warn: 91.25 }), 91.25);
  assert.equal(shownReading(91.244, { warn: 91.25 }), 91.24);
  assert.equal(shownReading(91.25, { warn: 91.25 }), 91.25);
  // A hysteresis with a fraction (0.025) puts the clear line on a half: a
  // reading held over it must not read under it.
  assert.equal(shownReading(87.6, { warn: 90, crit: 95, band: 2.5 }), 87.6);
  assert.equal(shownReading(87.5, { warn: 90, crit: 95, band: 2.5 }), 87.5);
});

test('shownReading: a reading under 0 shows 0, as the model reads it (#450)', () => {
  // CPU is 100 − the idle rate, which can come out a little under 0; the model
  // reads usage clamped to 0 (rules.js coerceFraction).
  assert.equal(shownReading(-0.3, { warn: 90, band: 5 }), 0);
  assert.equal(shownReading(-0.3), 0);
  assert.equal(shownReading(-12, { warn: 87.5 }), 0);
  assert.equal(coerceFraction('-0.3'), 0);
  const v = judgeNode(node({ cpu: '-0.3' }), {
    prometheusOk: true,
    thresholds: DEFAULT_THRESHOLDS,
  });
  assert.equal(v.conditions.cpu, 'ok');
});

test('atOrOver: a reading and a line compared on one grid, whole hundredths of the unit (#450)', () => {
  // 91.3 % read as a fraction is 0.9129999999999999 in floating point; the
  // line 0.913 is not: on the grid both are 9130.
  assert.ok(91.3 / 100 < 0.913, 'the float error this guards against');
  assert.equal(atOrOver(91.3 / 100, 0.913, 100), true);
  assert.equal(atOrOver(91.29 / 100, 0.913, 100), false);
  assert.equal(atOrOver(91.3, 91.3), true);
  assert.equal(atOrOver(75, 75), true);
  assert.equal(atOrOver(74.99, 75), false);
  // A clear line is on the grid too: 0.95 − 0.05 is 0.8999999999999999.
  assert.equal(atOrOver(0.9, 0.95 - 0.05, 100), true);
  assert.deepEqual([91.3, 0.29 * 100, -0.3, 12.345].map(toHundredths), [9130, 2900, -30, 1235]);
});

// Every one-decimal line from 0.1 % to 99.9 %, as display-config.json holds it
// (a fraction, 0.913) and /api/status serves it, with readings as discovery
// formats them (percent strings): exactly on the line and a hundredth either
// side, through the model as the loop runs it (judgeNode) and the meter's own
// number and comparison, against the decimal truth.
const TENTHS = Array.from({ length: 999 }, (_, i) => i + 1);
const lineOf = (tenths) => Number(`0.${String(tenths).padStart(3, '0')}`);
const reading = (hundredths) => (hundredths / 100).toFixed(2);

test('every one-decimal line: a reading on it, or a hundredth either side, is judged as the meter shows it (#450)', () => {
  const wrong = [];
  for (const tenths of TENTHS) {
    const served = JSON.parse(JSON.stringify(resolveThresholds({ mem: lineOf(tenths) })));
    const lines = readingLines(served, 'mem');
    if (lines.warn !== tenths / 10) wrong.push(`line ${lineOf(tenths)} served as ${lines.warn}`);
    for (const delta of [-1, 0, 1]) {
      const r = reading(tenths * 10 + delta);
      const over = delta >= 0;
      const model = judgeNode(node({ memPercent: r }), { prometheusOk: true, thresholds: served });
      const shown = shownReading(Number(r), lines);
      const at = `${r} % by a ${lines.warn} % line`;
      if ((model.conditions.mem === 'warn') !== over)
        wrong.push(`${at}: model ${model.conditions.mem}`);
      if (atOrOver(Number(r), lines.warn) !== over) wrong.push(`${at}: meter's state`);
      if (atOrOver(shown, lines.warn) !== over) wrong.push(`${at}: meter shows ${shown}`);
      if (over && model.metric?.value !== shown)
        wrong.push(`${at}: reason ${model.metric?.value}, meter ${shown}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('every one-decimal line: a level held over its clear line, or a hundredth either side, reads as it is held (#450)', () => {
  const wrong = [];
  for (const [hysteresis, bandTenths] of [
    [0.05, 50],
    [0.025, 25],
  ]) {
    for (const tenths of TENTHS.filter((t) => t > bandTenths)) {
      const served = JSON.parse(
        JSON.stringify(resolveThresholds({ mem: lineOf(tenths), hysteresis }))
      );
      const lines = readingLines(served, 'mem');
      const clear = lineNumber(lines.warn - lines.band);
      for (const delta of [-1, 0, 1]) {
        const r = reading((tenths - bandTenths) * 10 + delta);
        const held = delta >= 0;
        const memo = { levels: { mem: 'warn' }, streak: {} };
        const model = judgeNode(node({ memPercent: r }), {
          prometheusOk: true,
          thresholds: served,
          memo,
        });
        const shown = shownReading(Number(r), lines);
        const at = `${r} % by a ${clear} % clear line`;
        if ((model.conditions.mem === 'warn') !== held)
          wrong.push(`${at}: model ${model.conditions.mem}`);
        if (atOrOver(shown, clear) !== held) wrong.push(`${at}: shows ${shown}`);
        if (held && !model.reason.startsWith(`Memory ${shown} % (warning until below ${clear} %)`))
          wrong.push(`${at}: ${model.reason}`);
      }
    }
  }
  assert.deepEqual(wrong, []);
});

test('every line to a hundredth: the model and the meter agree on its side, on it and a hundredth either side (#450)', () => {
  const wrong = [];
  for (let hundredths = 1; hundredths < 10000; hundredths += 1) {
    const line = Number(`0.${String(hundredths).padStart(4, '0')}`);
    const lines = readingLines(resolveThresholds({ disk: line }), 'disk');
    for (const delta of [-1, 0, 1]) {
      const r = reading(hundredths + delta);
      const over = delta >= 0;
      const v = Number(r) / 100;
      if ((levelOf(v, undefined, { warn: line }, 0.05) === 'warn') !== over)
        wrong.push(`${r} by ${line}: model`);
      if (atOrOver(shownReading(Number(r), lines), lines.warn) !== over)
        wrong.push(`${r} by ${lines.warn}: shown ${shownReading(Number(r), lines)}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('lineNumber: a line in its unit, to a hundredth, without floating-point noise', () => {
  assert.deepEqual(
    [90, 95 - 5, 0.95 * 100 - 5, 87.5, 91.25, 75 - 5, 56.99999999999999].map(lineNumber),
    [90, 90, 90, 87.5, 91.25, 70, 57]
  );
});
