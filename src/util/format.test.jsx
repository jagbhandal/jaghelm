import { afterEach, describe, expect, it } from 'vitest';
import {
  dateTimeFormat,
  formatDay,
  formatTemperature,
  setFormatting,
  unitsOf,
  localeOf,
  unitsFromConfig,
} from './format.js';

afterEach(() => setFormatting({}));

describe('the one formatting module (#322, #260)', () => {
  it('defaults to metric and the browser locale', () => {
    setFormatting({});
    expect(unitsOf()).toBe('metric');
    expect(localeOf()).toBeUndefined();
  });

  it('takes the shared units and locale settings from a display config', () => {
    setFormatting({ units: 'imperial', locale: 'en-GB' });
    expect(unitsOf()).toBe('imperial');
    expect(localeOf()).toBe('en-GB');
  });

  it('ignores a value it does not know', () => {
    setFormatting({ units: 'furlongs', locale: 'not a locale!!' });
    expect(unitsOf()).toBe('metric');
    expect(localeOf()).toBeUndefined();
  });

  it('reads an old tempUnit as the units it meant', () => {
    expect(unitsFromConfig({ tempUnit: 'F' })).toBe('imperial');
    expect(unitsFromConfig({ tempUnit: 'C' })).toBe('metric');
    expect(unitsFromConfig({ units: 'metric', tempUnit: 'F' })).toBe('metric');
  });

  it('prints a temperature from celsius in the chosen units', () => {
    expect(formatTemperature(20)).toBe('20°C');
    setFormatting({ units: 'imperial' });
    expect(formatTemperature(20)).toBe('68°F');
    expect(formatTemperature(100)).toBe('212°F');
    expect(formatTemperature(48.5, { from: 'F' })).toBe('49°F');
    expect(formatTemperature(48.2, { from: 'F', units: 'metric' })).toBe('9°C');
  });

  it('never prints a negative zero', () => {
    expect(formatTemperature(-0.2)).toBe('0°C');
  });

  it('formats a day in the chosen locale, not always en-US', () => {
    const day = new Date(2026, 9, 20);
    setFormatting({ locale: 'en-US' });
    expect(formatDay(day)).toBe('Oct 20');
    setFormatting({ locale: 'en-GB' });
    expect(formatDay(day)).toBe('20 Oct');
  });

  it('keeps one formatter per locale and options', () => {
    const a = dateTimeFormat({ hour: 'numeric' });
    expect(dateTimeFormat({ hour: 'numeric' })).toBe(a);
    setFormatting({ locale: 'de-DE' });
    expect(dateTimeFormat({ hour: 'numeric' })).not.toBe(a);
  });
});
