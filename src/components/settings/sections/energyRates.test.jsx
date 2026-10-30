import { describe, expect, it } from 'vitest';
import { sanitizeEnergy } from '../../../../server/energy.js';
import { draftOf, energyProblems, energyValue, parsePrice } from './energyRates.js';

// The editor says what the server would drop: the same rules, in words.
const draft = (rates, currency = '$') => ({
  currency,
  rates: rates.map(([from, price], key) => ({ key, from, price })),
});

describe('parsePrice', () => {
  it.each([
    ['0.14', 0.14],
    ['.5', 0.5],
    ['2', 2],
    ['0,14', 0.14],
    [' 1.25 ', 1.25],
  ])('%s reads as %s', (text, n) => expect(parsePrice(text)).toBe(n));
  it.each(['', 'abc', '1e3', '-1', '1.2.3', '1 2', '0x10', '.'])('%j is no price', (text) =>
    expect(parsePrice(text)).toBeNull()
  );
});

describe('energyProblems', () => {
  it('a clean draft has none', () => {
    const p = energyProblems(draft([['2026-01-01', '0.14']]));
    expect(p.currency).toBeUndefined();
    expect(p.rates).toEqual([{}]);
  });

  it('says a date that is not on the calendar, an empty one, and a repeat (the later row)', () => {
    const p = energyProblems(
      draft([
        ['2026-02-30', '0.1'],
        ['', '0.1'],
        ['2026-03-01', '0.1'],
        ['2026-03-01', '0.2'],
      ])
    );
    expect(p.rates[0].from).toMatch(/not a real date/);
    expect(p.rates[1].from).toMatch(/Pick the day/);
    expect(p.rates[2].from).toBeUndefined();
    expect(p.rates[3].from).toMatch(/already starts on this day/);
  });

  it('says a price that is empty, not a number, 0, or over 10; 10 itself is fine', () => {
    const p = energyProblems(
      draft([
        ['2026-01-01', ''],
        ['2026-01-02', 'abc'],
        ['2026-01-03', '0'],
        ['2026-01-04', '10.01'],
        ['2026-01-05', '10'],
      ])
    );
    expect(p.rates.map((r) => !!r.price)).toEqual([true, true, true, true, false]);
    expect(p.rates[2].price).toMatch(/above 0/);
    expect(p.rates[3].price).toMatch(/at most 10/);
  });

  it('says a symbol that is empty or over 3 characters; 3 characters (even emoji) are fine', () => {
    expect(energyProblems(draft([], '')).currency).toMatch(/1 to 3/);
    expect(energyProblems(draft([], '   ')).currency).toMatch(/1 to 3/);
    expect(energyProblems(draft([], 'CHFS')).currency).toMatch(/1 to 3/);
    expect(energyProblems(draft([], 'CHF')).currency).toBeUndefined();
    expect(energyProblems(draft([], '€€€')).currency).toBeUndefined();
  });

  // The UI and the server agree: a clean draft is kept whole by sanitizeEnergy,
  // a draft with a problem has a row the server would drop.
  it.each([
    [[['2026-01-01', '0.14'], ['2026-06-01', '0.2']], true],
    [[['2026-01-01', '0.14'], ['2026-01-01', '0.2']], false],
    [[['2026-13-01', '0.14']], false],
    [[['2026-01-01', '11']], false],
    [[['2026-01-01', '0']], false],
  ])('agrees with sanitizeEnergy on %j', (rows, ok) => {
    const d = draft(rows);
    const clean = energyProblems(d).rates.every((r) => !r.from && !r.price);
    expect(clean).toBe(ok);
    const kept = sanitizeEnergy(energyValue(d));
    expect(kept?.rates.length === rows.length).toBe(ok);
  });
});

describe('energyValue and draftOf', () => {
  it('sorts by date, trims the symbol and reads the price as a number', () => {
    expect(energyValue(draft([['2026-06-01', '0,2'], ['2026-01-01', '0.14']], ' £ '))).toEqual({
      currency: '£',
      rates: [
        { from: '2026-01-01', perKwh: 0.14 },
        { from: '2026-06-01', perKwh: 0.2 },
      ],
    });
  });
  it('is nothing with no row, so the key is cleared', () => {
    expect(energyValue(draft([], '£'))).toBeUndefined();
  });
  it('a saved value comes back as the same draft', () => {
    const saved = { currency: '£', rates: [{ from: '2026-01-01', perKwh: 0.14 }] };
    expect(energyValue(draftOf(saved))).toEqual(saved);
    expect(draftOf(undefined)).toEqual({ currency: '$', rates: [] });
  });
});
