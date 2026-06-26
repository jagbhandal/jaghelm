import { describe, it, expect } from 'vitest';
import { groupByDay, formatDayLabel } from './groupByDay.js';

describe('groupByDay', () => {
  it('groups items by calendar day, newest day first', () => {
    const items = [
      { id: 'a', at: '2026-06-26T10:00:00Z' },
      { id: 'b', at: '2026-06-26T18:00:00Z' },
      { id: 'c', at: '2026-06-25T09:00:00Z' },
    ];
    const groups = groupByDay(items, (i) => new Date(i.at));
    expect(groups).toHaveLength(2);
    // newest day first — but group[0].items order depends on UTC→local; sort by id for stable assertion
    expect(groups[0].items.map((i) => i.id).sort()).toEqual(['a', 'b']);
    expect(groups[1].items.map((i) => i.id)).toEqual(['c']);
    expect(new Date(groups[0].day) >= new Date(groups[1].day)).toBe(true);
  });

  it('returns [] for empty input', () => {
    expect(groupByDay([], () => new Date())).toEqual([]);
  });

  it('handles three distinct days, newest day first', () => {
    const items = [
      { id: 'x', at: '2026-06-24T12:00:00Z' },
      { id: 'y', at: '2026-06-25T12:00:00Z' },
      { id: 'z', at: '2026-06-26T12:00:00Z' },
    ];
    const groups = groupByDay(items, (i) => new Date(i.at));
    expect(groups).toHaveLength(3);
    expect(groups[0].items[0].id).toBe('z');
    expect(groups[2].items[0].id).toBe('x');
  });
});

describe('formatDayLabel', () => {
  it('returns "Today" when dayKey === todayKey', () => {
    expect(formatDayLabel('2026-06-26', '2026-06-26')).toBe('Today');
  });

  it('returns "Yesterday" when dayKey is the calendar day before todayKey', () => {
    expect(formatDayLabel('2026-06-25', '2026-06-26')).toBe('Yesterday');
  });

  it('returns a readable date like "Jun 24" for older days', () => {
    expect(formatDayLabel('2026-06-24', '2026-06-26')).toBe('Jun 24');
  });

  it('handles month boundaries correctly (yesterday crosses month)', () => {
    // Today is July 1; yesterday is June 30
    expect(formatDayLabel('2026-06-30', '2026-07-01')).toBe('Yesterday');
  });

  it('returns readable date for a day two days ago', () => {
    const label = formatDayLabel('2026-06-10', '2026-06-26');
    expect(label).toBe('Jun 10');
  });
});
