import { describe, it, expect } from 'vitest';
import { tooManyAttempts } from './retryAfter.js';

describe('tooManyAttempts (#257)', () => {
  it('says the wait from Retry-After: seconds under a minute, minutes rounded up after', () => {
    expect(tooManyAttempts('30')).toBe('Too many attempts. Try again in 30 s.');
    expect(tooManyAttempts('59')).toBe('Too many attempts. Try again in 59 s.');
    expect(tooManyAttempts('60')).toBe('Too many attempts. Try again in 1 min.');
    expect(tooManyAttempts('61')).toBe('Too many attempts. Try again in 2 min.');
    expect(tooManyAttempts('900')).toBe('Too many attempts. Try again in 15 min.');
    expect(tooManyAttempts(' 7 ')).toBe('Too many attempts. Try again in 7 s.');
  });

  it('a zero wait is still a second, never "0 s"', () => {
    expect(tooManyAttempts('0')).toBe('Too many attempts. Try again in 1 s.');
  });

  it('no header, or one it cannot read, says later', () => {
    for (const value of [null, undefined, '', 'soon', '-5', '1.5', 'Wed, 21 Oct 2026 07:28:00 GMT', '9'.repeat(12)]) {
      expect(tooManyAttempts(value)).toBe('Too many attempts. Try again later.');
    }
  });
});
