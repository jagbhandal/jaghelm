/**
 * A node reading's lines as the screens draw them (#451): read from the
 * threshold set /api/status serves, in the reading's own unit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { percentOf, readingLines } from './readings.js';
import { DEFAULT_THRESHOLDS, resolveThresholds } from './thresholds.js';

test('readingLines: each reading the model judges, in its unit, with the defaults', () => {
  const t = DEFAULT_THRESHOLDS;
  assert.deepEqual(readingLines(t, 'cpu'), { warn: 90 });
  assert.deepEqual(readingLines(t, 'mem'), { warn: 90 });
  assert.deepEqual(readingLines(t, 'disk'), { warn: 90, crit: 95 });
  assert.deepEqual(readingLines(t, 'temp'), { warn: 75, crit: 85 });
  // A storage pool feeds the disk rule (spec §6.1), so it has the disk's lines.
  assert.deepEqual(readingLines(t, 'pool:local-lvm'), { warn: 90, crit: 95 });
});

test("readingLines: display-config's pushThresholds move them, as the model reads them", () => {
  const t = resolveThresholds({ cpu: 0.8, mem: 0.875, disk: 0.97 });
  assert.deepEqual(readingLines(t, 'cpu'), { warn: 80 });
  assert.deepEqual(readingLines(t, 'mem'), { warn: 87.5 });
  // A warn line above the crit line moves the crit line up to it.
  assert.deepEqual(readingLines(t, 'disk'), { warn: 97, crit: 97 });
  assert.deepEqual(readingLines(t, 'pool:tank'), { warn: 97, crit: 97 });
});

test('readingLines: the served JSON reads the same as the object the model was given', () => {
  const t = resolveThresholds({ mem: 0.57, disk: 0.86 });
  const served = JSON.parse(JSON.stringify(t));
  for (const reading of ['cpu', 'mem', 'disk', 'temp', 'pool:x']) {
    assert.deepEqual(readingLines(served, reading), readingLines(t, reading), reading);
  }
  // 0.57 × 100 is 56.99999999999999 in floating point; the line is 57.
  assert.deepEqual(readingLines(t, 'mem'), { warn: 57 });
});

test('readingLines: no lines for a reading the table has none for, or with no thresholds', () => {
  for (const reading of ['uptime', 'charge', 'pool', '', undefined]) {
    assert.deepEqual(readingLines(DEFAULT_THRESHOLDS, reading), {}, String(reading));
  }
  for (const thresholds of [null, undefined, {}, 'junk', { disk: null }]) {
    assert.deepEqual(readingLines(thresholds, 'disk'), {}, JSON.stringify(thresholds));
  }
  // A line that isn't a number is left out, never NaN.
  assert.deepEqual(readingLines({ disk: { warn: 0.9, crit: '0.95' } }, 'disk'), { warn: 90 });
});

test('percentOf: a line as a percentage, to a hundredth', () => {
  assert.deepEqual(
    [0.9, 0.95, 0.875, 0.57, 0.9125, 0.12346, 0, 1].map(percentOf),
    [90, 95, 87.5, 57, 91.25, 12.35, 0, 100]
  );
});
