import { describe, expect, it } from 'vitest';
import { ACCENTS } from '../../../ui/accents.js';
import {
  ACCENT_SET,
  OLD_DEFAULT_ACCENT,
  hexToOklab,
  migrateAccent,
  nearestAccent,
} from './accentSet.js';

// The accent set (#321): what Settings → Appearance offers, and a colour the
// free picker saved before #304 mapped, once, onto the nearest of it.
// scripts/accent-set.test.mjs holds each fill to tokens.css and runs the
// contrast check on every accent.

describe('the accent set', () => {
  it('is src/ui/accents.js’s list, in its order, each with its hue', () => {
    expect(ACCENT_SET.map((a) => [a.id, a.label])).toEqual(ACCENTS.map((a) => [a.id, a.label]));
    expect(ACCENT_SET.map((a) => a.hue)).toEqual([293, 328, 215]);
  });
});

describe('a colour as OKLab', () => {
  it('reads #rgb and #rrggbb, and nothing else', () => {
    const white = hexToOklab('#fff');
    expect(white[0]).toBeCloseTo(1, 4);
    expect(hexToOklab('#ffffff')).toEqual(white);
    // Tailwind's #3b82f6, oklch(0.623 0.188 259.8) by CSS Color 4.
    const [l, a, b] = hexToOklab('#3b82f6');
    expect(l).toBeCloseTo(0.623, 3);
    expect(Math.hypot(a, b)).toBeCloseTo(0.188, 3);
    for (const bad of ['red', '#12', '#12345', 'rgb(0 0 0)', '', null, undefined, 42])
      expect(hexToOklab(bad)).toBeNull();
  });
});

describe('the nearest accent', () => {
  it.each([
    ['#ec4899', 'fuchsia'], // pink
    ['#ef4444', 'fuchsia'], // red: the nearest hue offered (no accent is a status hue)
    ['#f59e0b', 'fuchsia'], // amber
    ['#22c55e', 'cyan'], // green
    ['#14b8a6', 'cyan'], // teal
    ['#0ea5e9', 'cyan'], // sky
    ['#3b82f6', 'violet'], // blue: 33° from violet, 45° from cyan
    ['#8b5cf6', 'violet'],
    ['#a855f7', 'violet'],
  ])('%s is %s, by hue', (hex, id) => {
    expect(nearestAccent(hex)).toBe(id);
  });

  it('a grey, black or white has no hue: the default, Violet', () => {
    for (const hex of ['#888888', '#000', '#ffffff', '#1e1e1e'])
      expect(nearestAccent(hex)).toBe('violet');
  });

  it('is null for what isn’t a colour', () => {
    expect(nearestAccent('nope')).toBeNull();
  });
});

describe('an old accent colour, mapped once', () => {
  it('a picked colour becomes the nearest accent, says so, and goes', () => {
    const config = { title: 'Home', accentColor: '#ec4899' };
    const out = migrateAccent(config);
    expect(out).toEqual({
      title: 'Home',
      accent: 'fuchsia',
      accentNotice: { from: '#ec4899', to: 'fuchsia' },
    });
    expect(config.accentColor).toBe('#ec4899'); // not mutated
    // Once: the result has nothing left to map.
    expect(migrateAccent(out)).toBe(out);
  });

  it('the old default was nobody’s choice: it goes quietly and the accent stays Violet', () => {
    expect(migrateAccent({ accentColor: OLD_DEFAULT_ACCENT })).toEqual({});
    expect(migrateAccent({ accentColor: '#6366F1' })).toEqual({});
  });

  it('a grey, white or black maps to Violet without a notice: it has no hue to be near', () => {
    for (const hex of ['#808080', '#fff', '#000000'])
      expect(migrateAccent({ accentColor: hex })).toEqual({ accent: 'violet' });
  });

  it('a config with an accent of its own keeps it; the old colour just goes', () => {
    expect(migrateAccent({ accent: 'cyan', accentColor: '#ec4899' })).toEqual({ accent: 'cyan' });
  });

  it('a value that isn’t a colour goes, and nothing is said', () => {
    expect(migrateAccent({ accentColor: 'tomato' })).toEqual({});
    expect(migrateAccent({ accentColor: null })).toEqual({});
  });

  it('a config without one comes back as it is', () => {
    const config = { accent: 'fuchsia' };
    expect(migrateAccent(config)).toBe(config);
    expect(migrateAccent(null)).toBeNull();
  });
});
