/** Monitoring A1 (#742): the `energy` key's sanitiser. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeEnergy, validDay } from './energy.js';

const row = (from, perKwh) => ({ from, perKwh });
const rates = (...r) => ({ currency: '$', rates: r });

test('a valid sample comes back unchanged', () => {
  const v = { currency: '$', rates: [row('2026-01-01', 0.14), row('2026-07-01', 0.17)] };
  assert.deepEqual(sanitizeEnergy(v), v);
});

test('anything that is no object, or holds no valid rate, is undefined (no key written)', () => {
  for (const raw of [
    undefined,
    null,
    5,
    'x',
    [],
    true,
    {},
    { currency: '$' },
    { rates: 'x' },
    { rates: [] },
  ]) {
    assert.equal(sanitizeEnergy(raw), undefined, JSON.stringify(raw));
  }
  assert.equal(sanitizeEnergy({ currency: '€', rates: [row('nope', 1)] }), undefined);
});

test('validDay accepts real dates only', () => {
  for (const d of ['2026-01-01', '2024-02-29', '2026-12-31', '0001-01-01'])
    assert.ok(validDay(d), d);
  for (const d of [
    '2026-02-30',
    '2026-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-04-31',
    '2026-01-00',
    '2026-1-1',
    '26-01-01',
    '2026/01/01',
    '2026-01-01T00:00',
    ' 2026-01-01',
    '',
    'today',
    0,
    null,
    undefined,
    20260101,
    {},
    '0000-01-01',
  ]) {
    assert.equal(validDay(d), false, String(d));
  }
});

test('a row whose from is not a real calendar date is dropped, the others stay', () => {
  const out = sanitizeEnergy(
    rates(
      row('2026-02-30', 0.1),
      row('2026-1-1', 0.1),
      row(20260101, 0.1),
      row(null, 0.1),
      row('2026-03-01', 0.2)
    )
  );
  assert.deepEqual(out.rates, [row('2026-03-01', 0.2)]);
});

test('perKwh at or below 0, above 10, or not a finite number drops the row', () => {
  const bad = [
    0,
    -0.01,
    -5,
    10.01,
    11,
    1e9,
    NaN,
    Infinity,
    -Infinity,
    '0.14',
    null,
    undefined,
    true,
  ];
  for (const perKwh of bad) {
    const out = sanitizeEnergy(rates(row('2026-01-01', perKwh), row('2026-02-01', 0.5)));
    assert.deepEqual(out.rates, [row('2026-02-01', 0.5)], String(perKwh));
  }
});

test('perKwh just above 0 and exactly 10 are kept', () => {
  const out = sanitizeEnergy(rates(row('2026-01-01', 0.0001), row('2026-02-01', 10)));
  assert.deepEqual(out.rates, [row('2026-01-01', 0.0001), row('2026-02-01', 10)]);
});

test('rows that are no objects are dropped', () => {
  const out = sanitizeEnergy(rates(null, 5, 'x', [], row('2026-01-01', 0.1)));
  assert.deepEqual(out.rates, [row('2026-01-01', 0.1)]);
});

test('rates are stored sorted by from', () => {
  const out = sanitizeEnergy(
    rates(row('2026-07-01', 0.3), row('2025-12-31', 0.1), row('2026-01-15', 0.2))
  );
  assert.deepEqual(
    out.rates.map((r) => r.from),
    ['2025-12-31', '2026-01-15', '2026-07-01']
  );
});

test('a duplicate from keeps its first row only', () => {
  const out = sanitizeEnergy(
    rates(row('2026-01-01', 0.1), row('2026-01-01', 0.9), row('2026-02-01', 0.2))
  );
  assert.deepEqual(out.rates, [row('2026-01-01', 0.1), row('2026-02-01', 0.2)]);
});

test('a duplicate whose first row is invalid does not shadow a valid later one', () => {
  const out = sanitizeEnergy(rates(row('2026-01-01', -1), row('2026-01-01', 0.4)));
  assert.deepEqual(out.rates, [row('2026-01-01', 0.4)]);
});

function days(n) {
  return Array.from({ length: n }, (_, i) =>
    row(`${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`, 0.1)
  );
}

test('24 rows are kept, more than 24 are cut to the first 24 valid ones', () => {
  assert.equal(sanitizeEnergy(rates(...days(24))).rates.length, 24);
  const out = sanitizeEnergy(rates(...days(30)));
  assert.equal(out.rates.length, 24);
  assert.deepEqual(out.rates, days(24));
});

test('invalid rows do not count toward the 24', () => {
  const out = sanitizeEnergy(
    rates(
      ...days(5).map((r) => ({ ...r, perKwh: 0 })),
      ...days(24).map((r, i) =>
        row(`2030-${String((i % 12) + 1).padStart(2, '0')}-${i < 12 ? '01' : '02'}`, 0.2)
      )
    )
  );
  assert.equal(out.rates.length, 24);
});

test('currency: 1 to 3 characters kept (trimmed), longer, empty or non-string reads as $', () => {
  const r = [row('2026-01-01', 0.1)];
  const cur = (currency) => sanitizeEnergy({ currency, rates: r }).currency;
  assert.equal(cur('€'), '€');
  assert.equal(cur('CAD'), 'CAD');
  assert.equal(cur(' £ '), '£');
  assert.equal(cur('CAD$'), '$');
  assert.equal(cur('abcd'), '$');
  assert.equal(cur(''), '$');
  assert.equal(cur('   '), '$');
  assert.equal(cur(5), '$');
  assert.equal(cur(undefined), '$');
  assert.equal(cur('💰💰💰'), '💰💰💰'); // counted as characters, not UTF-16 units
});

test('a bad currency does not lose the rates', () => {
  const out = sanitizeEnergy({ currency: 'toolong', rates: [row('2026-01-01', 0.1)] });
  assert.deepEqual(out, { currency: '$', rates: [row('2026-01-01', 0.1)] });
});

test('unknown keys are ignored, on the value and on a row', () => {
  const out = sanitizeEnergy({
    currency: '$',
    extra: 1,
    rates: [{ from: '2026-01-01', perKwh: 0.1, note: 'x', __proto__: { a: 1 } }],
  });
  assert.deepEqual(out, { currency: '$', rates: [row('2026-01-01', 0.1)] });
});

test('it never throws and does not change its input', () => {
  const raw = { currency: '$', rates: [row('2026-02-01', 0.2), row('2026-01-01', 0.1)] };
  const copy = structuredClone(raw);
  sanitizeEnergy(raw);
  assert.deepEqual(raw, copy);
  assert.doesNotThrow(() =>
    sanitizeEnergy({
      rates: [
        {
          get from() {
            return '2026-01-01';
          },
          perKwh: 1,
        },
      ],
    })
  );
});
