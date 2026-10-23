/**
 * The thresholds as Settings → Notifications edits them (#320): the checks a
 * table passes before it is saved or used, and how saved lines lay over the
 * defaults (and over display-config.json's hand-edited `pushThresholds`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_THRESHOLDS, resolveThresholds } from './thresholds.js';
import {
  fractionOf,
  linesInUnits,
  readThresholdTable,
  savedTable,
  thresholdView,
} from './thresholdTable.js';

const pct = (warn, crit) => (crit === undefined ? { warn, unit: '%' } : { warn, crit, unit: '%' });
const celsius = (warn, crit) => ({ warn, crit, unit: '°C' });

test('readThresholdTable: a table of lines, a metric each, null or left out for its defaults', () => {
  assert.deepEqual(readThresholdTable({}), { lines: {} });
  assert.deepEqual(
    readThresholdTable({ cpu: pct(85), mem: null, disk: pct(88, 94), temp: celsius(70, 80) }),
    { lines: { cpu: { warn: 85 }, disk: { warn: 88, crit: 94 }, temp: { warn: 70, crit: 80 } } }
  );
  // Lines to a hundredth of their unit, as the model writes them.
  assert.deepEqual(readThresholdTable({ mem: pct(87.504) }), { lines: { mem: { warn: 87.5 } } });
  // CPU and memory have no critical line: null says so too.
  assert.deepEqual(readThresholdTable({ cpu: { warn: 80, crit: null, unit: '%' } }), {
    lines: { cpu: { warn: 80 } },
  });
});

test('readThresholdTable refuses a table it would not judge by, saying why and for which metric', () => {
  const rows = [
    // warn at or above crit
    [
      { disk: pct(95, 95) },
      'disk',
      /disk's warning line \(95 %\) must be under its critical line \(95 %\)/,
    ],
    [{ temp: celsius(90, 80) }, 'temp', /under its critical line/],
    // out of range
    [{ cpu: pct(101) }, 'cpu', /cpu's warning line must be from 10 to 100 %/],
    [{ mem: pct(5) }, 'mem', /from 10 to 100 %/],
    [{ disk: pct(80, 120) }, 'disk', /disk's critical line must be from 10 to 100 %/],
    [{ temp: celsius(20, 80) }, 'temp', /from 30 to 120 °C/],
    // the wrong unit, or none
    [
      { temp: { warn: 70, crit: 80, unit: '°F' } },
      'temp',
      /temp's unit is °C \(Celsius\): send "unit": "°C"/,
    ],
    [{ cpu: { warn: 0.9, unit: 'fraction' } }, 'cpu', /cpu's unit is %/],
    [{ disk: { warn: 90, crit: 95 } }, 'disk', /disk's unit is %/],
    // an unknown metric
    [
      { gpu: pct(90) },
      'gpu',
      /There is no threshold for "gpu": the metrics are cpu, mem, disk and temp/,
    ],
    // a line that is no number, a crit where there is none, a missing crit, an extra key
    [{ cpu: { warn: '90', unit: '%' } }, 'cpu', /must be a number/],
    [{ cpu: pct(80, 90) }, 'cpu', /cpu has no critical line: leave crit out/],
    [{ disk: pct(80) }, 'disk', /disk's critical line must be a number/],
    [
      { mem: { warn: 80, unit: '%', hysteresis: 5 } },
      'mem',
      /mem takes warn and unit only, not "hysteresis"/,
    ],
    [{ cpu: 90 }, 'cpu', /cpu must be \{ warn and unit \}, or null for its default/],
  ];
  for (const [body, metric, error] of rows) {
    const read = readThresholdTable(body);
    assert.ok('error' in read, JSON.stringify(body));
    assert.match(read.error, error, JSON.stringify(body));
    assert.equal(read.metric, metric, JSON.stringify(body));
  }
  for (const body of [null, [], 'cpu=90', 90]) {
    const read = readThresholdTable(body);
    assert.ok('error' in read && !read.metric, JSON.stringify(body));
    assert.match(read.error, /a JSON object/);
  }
});

test('resolveThresholds: saved lines over the defaults, in its fractions; pushThresholds then only for hysteresis', () => {
  // No saved lines: the hand edit counts, as before #320.
  assert.equal(resolveThresholds({ cpu: 0.7 }).cpu.warn, 0.7);
  const t = resolveThresholds(
    { cpu: 0.7, disk: 0.8, hysteresis: 0.03 },
    { mem: { warn: 91.3 }, disk: { warn: 87.5, crit: 93 }, temp: { warn: 70, crit: 80 } }
  );
  assert.deepEqual(t, {
    cpu: { warn: 0.9, cycles: 2 }, // pushThresholds.cpu no longer counts
    mem: { warn: 0.913 }, // never 0.9129999999999999
    disk: { warn: 0.875, crit: 0.93 },
    temp: { warn: 70, crit: 80 },
    hysteresis: { fraction: 0.03, celsius: 5 },
    pending: { cycles: 2 },
  });
  // An empty table saved (every row reset): the defaults, the hand edit's lines gone.
  assert.deepEqual(resolveThresholds({ cpu: 0.7 }, {}), DEFAULT_THRESHOLDS);
  assert.equal(fractionOf(91.3), 0.913);
});

test('thresholdView: each metric in order, in its unit, with its defaults and whether it is custom', () => {
  const view = thresholdView(
    resolveThresholds(null, { disk: { warn: 88, crit: 94 } }),
    DEFAULT_THRESHOLDS
  );
  assert.deepEqual(
    view.map((r) => [r.metric, r.unit, r.warn, r.crit, r.defaults, r.custom]),
    [
      ['cpu', '%', 90, null, { warn: 90, crit: null }, false],
      ['mem', '%', 90, null, { warn: 90, crit: null }, false],
      ['disk', '%', 88, 94, { warn: 90, crit: 95 }, true],
      ['temp', '°C', 75, 85, { warn: 75, crit: 85 }, false],
    ]
  );
  assert.deepEqual(
    view.map((r) => [r.min, r.max]),
    [
      [10, 100],
      [10, 100],
      [10, 100],
      [30, 120],
    ]
  );
  // A hand-edited line (no saved file) shows as custom, at its percent.
  const legacy = thresholdView(resolveThresholds({ mem: 0.875 }), DEFAULT_THRESHOLDS);
  assert.deepEqual(legacy[1], { ...legacy[1], warn: 87.5, custom: true });
  assert.deepEqual(linesInUnits(DEFAULT_THRESHOLDS).temp, { warn: 75, crit: 85 });
});

test('savedTable keeps only the metrics away from their defaults, each with its unit', () => {
  assert.deepEqual(
    savedTable(
      { cpu: { warn: 90 }, disk: { warn: 88, crit: 94 }, temp: { warn: 75, crit: 80 } },
      DEFAULT_THRESHOLDS
    ),
    { disk: { warn: 88, crit: 94, unit: '%' }, temp: { warn: 75, crit: 80, unit: '°C' } }
  );
  assert.deepEqual(savedTable({ cpu: { warn: 90 } }, DEFAULT_THRESHOLDS), {});
  // What it keeps reads back as the same lines.
  const kept = savedTable({ mem: { warn: 80 } }, DEFAULT_THRESHOLDS);
  assert.deepEqual(readThresholdTable(kept), { lines: { mem: { warn: 80 } } });
});
