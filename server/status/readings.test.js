/**
 * A node reading's lines as the screens draw them (#451): read from the
 * threshold set /api/status serves, in the reading's own unit. And the one
 * rule for showing a reading beside them (#450), which the model's reasons and
 * every meter use.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lineNumber, percentOf, readingLines, shownReading } from './readings.js';
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
  assert.equal(shownReading(91.249, { warn: 91.25 }), 91.24);
  assert.equal(shownReading(91.25, { warn: 91.25 }), 91.25);
  // A hysteresis with a fraction (0.025) puts the clear line on a half: a
  // reading held over it must not read under it.
  assert.equal(shownReading(87.6, { warn: 90, crit: 95, band: 2.5 }), 87.6);
  assert.equal(shownReading(87.5, { warn: 90, crit: 95, band: 2.5 }), 87.5);
});

test('shownReading: on either side of any line to a hundredth, the reading shown is on the same side', () => {
  const lines = [57, 80, 87.5, 90, 91.25, 95, 99.9];
  for (const line of lines) {
    for (const band of [5, 2.5, 0.75]) {
      const set = { warn: line, band };
      const clear = lineNumber(line - band);
      for (let step = -300; step <= 300; step += 1) {
        // Readings as discovery formats them (one decimal), and to a hundredth.
        const near = [(line + step / 100).toFixed(2), (line + step / 10).toFixed(1)];
        for (const value of near.map(Number)) {
          const shown = shownReading(value, set);
          assert.equal(shown >= line, value >= line, `${value} beside ${line}: shown ${shown}`);
          assert.equal(shown >= clear, value >= clear, `${value} beside ${clear}: shown ${shown}`);
          assert.ok(shown <= value + 1e-9, `${value} shown as ${shown}: never above the reading`);
        }
      }
    }
  }
});

test('lineNumber: a line in its unit, to a hundredth, without floating-point noise', () => {
  assert.deepEqual(
    [90, 95 - 5, 0.95 * 100 - 5, 87.5, 91.25, 75 - 5, 56.99999999999999].map(lineNumber),
    [90, 90, 90, 87.5, 91.25, 70, 57]
  );
});
