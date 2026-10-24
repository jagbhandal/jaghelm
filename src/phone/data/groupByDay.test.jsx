import { afterEach, describe, expect, it } from 'vitest';
import { formatDayLabel } from './groupByDay.js';
import { resetFormatting, setFormatting } from '../../util/format.js';

// The day label is shared with the Android app (#322): it follows the device's
// locale now, not a fixed en-US. A device in en-US reads exactly what it did.
afterEach(() => resetFormatting());

describe('formatDayLabel', () => {
  it('Today and Yesterday are as they were', () => {
    expect(formatDayLabel('2026-06-27', '2026-06-27')).toBe('Today');
    expect(formatDayLabel('2026-06-26', '2026-06-27')).toBe('Yesterday');
  });

  it('on an en-US device an older day reads "Jun 25", unchanged', () => {
    setFormatting({ locale: 'en-US' });
    expect(formatDayLabel('2026-06-25', '2026-06-27')).toBe('Jun 25');
  });

  it('with no config handed over (the Android app, Phase 4) it is the old en-US text', () => {
    expect(formatDayLabel('2026-06-25', '2026-06-27')).toBe('Jun 25');
  });

  it('on another locale it reads that locale’s way', () => {
    setFormatting({ locale: 'en-GB' });
    expect(formatDayLabel('2026-06-25', '2026-06-27')).toBe('25 Jun');
  });
});
