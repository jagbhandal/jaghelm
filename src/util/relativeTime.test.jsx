import { describe, it, expect } from 'vitest';
import { formatAge, lastSeenLabel } from './relativeTime.js';

describe('formatAge', () => {
  it('formats seconds, minutes, hours, days compactly', () => {
    expect(formatAge(5_000)).toBe('5s');
    expect(formatAge(45_000)).toBe('45s');
    expect(formatAge(12 * 60_000)).toBe('12m');
    expect(formatAge(3 * 60 * 60_000)).toBe('3h');
    expect(formatAge(5 * 24 * 60 * 60_000)).toBe('5d');
  });
  it('clamps negatives to 0s', () => {
    expect(formatAge(-100)).toBe('0s');
  });
});

describe('lastSeenLabel', () => {
  it('renders "last seen N ago" relative to now', () => {
    expect(lastSeenLabel(1000, 1000 + 120_000)).toBe('last seen 2m ago');
  });
  it('falls back gracefully when lastSeenAt is missing', () => {
    expect(lastSeenLabel(0, 123)).toBe('last seen recently');
    expect(lastSeenLabel(null, 123)).toBe('last seen recently');
  });
});
