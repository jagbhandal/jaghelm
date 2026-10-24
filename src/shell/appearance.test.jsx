import { renderHook, act, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  DENSITIES,
  LEGACY_FONT_FAMILIES,
  appearanceOf,
  hasOldAccent,
  typefaceOf,
  useAppearance,
} from './appearance.js';
import { DEFAULT_TYPEFACE, TYPEFACES } from '../ui/typefaces.js';

// The accent and density the display config picks, for the shell's roots
// (#321), and an old picker's colour mapped once the server's copy is in.

describe('what the config picks', () => {
  it('its accent and density, each the default when it picks none offered', () => {
    expect(appearanceOf({})).toEqual({
      accent: 'violet',
      density: 'comfortable',
      typeface: 'manrope',
    });
    expect(appearanceOf(null)).toEqual({
      accent: 'violet',
      density: 'comfortable',
      typeface: 'manrope',
    });
    expect(appearanceOf({ accent: 'cyan', density: 'compact', typeface: 'montserrat' })).toEqual({
      accent: 'cyan',
      density: 'compact',
      typeface: 'montserrat',
    });
    // Blue was dropped (it reads as maintenance); a later build's density isn't offered.
    expect(appearanceOf({ accent: 'blue', density: 'cosy' })).toEqual({
      accent: 'violet',
      density: 'comfortable',
      typeface: 'manrope',
    });
    expect(DENSITIES.map((d) => d.id)).toEqual(['comfortable', 'compact']);
  });

  it('the typeface is one of the registry’s; an unknown value falls back to the default (#660)', () => {
    for (const { id } of TYPEFACES) expect(typefaceOf({ typeface: id })).toBe(id);
    for (const odd of ['comic-sans', '', 7, null, {}, '__proto__', 'Manrope'])
      expect(typefaceOf({ typeface: odd })).toBe(DEFAULT_TYPEFACE);
    expect(typefaceOf(undefined)).toBe(DEFAULT_TYPEFACE);
  });

  it('an old fontFamily is read only while there is no typeface: every preset maps to Manrope (#660)', () => {
    expect(Object.keys(LEGACY_FONT_FAMILIES)).toEqual([
      'default',
      'clean',
      'rounded',
      'sharp',
      'system',
    ]);
    for (const preset of Object.keys(LEGACY_FONT_FAMILIES))
      expect(typefaceOf({ fontFamily: preset })).toBe('manrope');
    // A saved typeface wins; the old key is then ignored.
    expect(typefaceOf({ fontFamily: 'system', typeface: 'montserrat' })).toBe('montserrat');
    // A key nobody knows, or one that could hit the prototype, reads as the default.
    for (const odd of ['toString', 'constructor', 'gothic', 4]) {
      expect(typefaceOf({ fontFamily: odd })).toBe(DEFAULT_TYPEFACE);
    }
  });

  it('knows a config that still has the free picker’s colour', () => {
    expect(hasOldAccent({ accentColor: '#ec4899' })).toBe(true);
    expect(hasOldAccent({ accent: 'cyan' })).toBe(false);
    expect(hasOldAccent(null)).toBe(false);
  });
});

/** The hook over a config held in state, as App holds it. */
function useHarness(initial, ready) {
  const [config, setConfig] = useState(initial);
  const switches = useAppearance(config, setConfig, ready);
  return { config, switches };
}

describe('useAppearance', () => {
  it('gives the switches, the same object while they hold', () => {
    const { result, rerender } = renderHook(() => useHarness({ density: 'compact' }, true));
    const first = result.current.switches;
    expect(first).toEqual({ accent: 'violet', density: 'compact', typeface: 'manrope' });
    rerender();
    expect(result.current.switches).toBe(first);
  });

  it('maps an old picker’s colour once the server’s copy is in, and only then', async () => {
    const { result, rerender } = renderHook(
      ({ ready }) => useHarness({ accentColor: '#22c55e' }, ready),
      {
        initialProps: { ready: false },
      }
    );
    // Before the server's copy, this browser's may be stale: nothing is mapped.
    await act(async () => {});
    expect(result.current.config).toEqual({ accentColor: '#22c55e' });
    expect(result.current.switches.accent).toBe('violet');

    rerender({ ready: true });
    await waitFor(() => expect(result.current.switches.accent).toBe('cyan'));
    expect(result.current.config).toEqual({
      accent: 'cyan',
      accentNotice: { from: '#22c55e', to: 'cyan' },
    });
  });
});
