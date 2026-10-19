import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseLocalDate, localDateKey, isPastLocalDate, formatLocalDate } from './localDate.js';

// Pin a west-of-UTC zone: a date-only string read as UTC midnight lands on the
// previous day here, which is the bug these helpers exist to avoid.
let savedTz;
beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = 'America/Toronto';
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

describe('local date helpers in America/Toronto', () => {
  it('runs in a zone west of UTC (guards the tests below)', () => {
    expect(new Date(2026, 9, 20).getTimezoneOffset()).toBe(240);
  });

  describe('parseLocalDate', () => {
    it('reads YYYY-MM-DD as local midnight of that calendar day', () => {
      const d = parseLocalDate('2026-10-20');
      expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 20]);
      expect([d.getHours(), d.getMinutes()]).toEqual([0, 0]);
    });

    it('keeps the day across a DST change (Nov 1 2026 in Toronto)', () => {
      const d = parseLocalDate('2026-11-01');
      expect([d.getMonth(), d.getDate(), d.getHours()]).toEqual([10, 1, 0]);
    });

    it('handles years below 100 without the 19xx shift', () => {
      expect(parseLocalDate('0050-03-04').getFullYear()).toBe(50);
    });

    it('returns null for anything that is not a real date-only value', () => {
      for (const v of [
        null,
        undefined,
        '',
        'soon',
        '2026-10-20T10:00:00Z',
        '2026-1-5',
        '2026-02-30',
        '2026-13-01',
        20261020,
      ]) {
        expect(parseLocalDate(v)).toBeNull();
      }
    });
  });

  describe('localDateKey', () => {
    it('formats the local calendar day, not the UTC one', () => {
      // 21:30 on Oct 20 in Toronto is already Oct 21 in UTC.
      const lateEvening = new Date(2026, 9, 20, 21, 30);
      expect(lateEvening.toISOString().slice(0, 10)).toBe('2026-10-21');
      expect(localDateKey(lateEvening)).toBe('2026-10-20');
    });

    it('round-trips with parseLocalDate', () => {
      expect(localDateKey(parseLocalDate('2026-01-09'))).toBe('2026-01-09');
    });
  });

  describe('isPastLocalDate', () => {
    it('is false on the day itself, morning to late evening', () => {
      expect(isPastLocalDate('2026-10-20', new Date(2026, 9, 20, 0, 0))).toBe(false);
      expect(isPastLocalDate('2026-10-20', new Date(2026, 9, 20, 12, 0))).toBe(false);
      expect(isPastLocalDate('2026-10-20', new Date(2026, 9, 20, 23, 59))).toBe(false);
    });

    it('is true from the next local day', () => {
      expect(isPastLocalDate('2026-10-20', new Date(2026, 9, 21, 0, 0))).toBe(true);
    });

    it('is false for a future day and for an unparseable value', () => {
      expect(isPastLocalDate('2026-10-21', new Date(2026, 9, 20, 23, 59))).toBe(false);
      expect(isPastLocalDate('soon', new Date(2026, 9, 20))).toBe(false);
      expect(isPastLocalDate(null, new Date(2026, 9, 20))).toBe(false);
    });
  });

  describe('formatLocalDate', () => {
    it('shows the calendar day as written', () => {
      expect(formatLocalDate('2026-10-20')).toBe('Oct 20');
      expect(formatLocalDate('2026-01-01')).toBe('Jan 1');
    });

    it('returns null for an unparseable value', () => {
      expect(formatLocalDate('soon')).toBeNull();
      expect(formatLocalDate(null)).toBeNull();
    });
  });
});
