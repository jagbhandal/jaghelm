import { renderHook, act, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { DENSITIES, appearanceOf, hasOldAccent, useAppearance } from './appearance.js';

// The accent and density the display config picks, for the shell's roots
// (#321), and an old picker's colour mapped once the server's copy is in.

describe('what the config picks', () => {
  it('its accent and density, each the default when it picks none offered', () => {
    expect(appearanceOf({})).toEqual({ accent: 'violet', density: 'comfortable' });
    expect(appearanceOf(null)).toEqual({ accent: 'violet', density: 'comfortable' });
    expect(appearanceOf({ accent: 'cyan', density: 'compact' })).toEqual({
      accent: 'cyan',
      density: 'compact',
    });
    // Blue was dropped (it reads as maintenance); a later build's density isn't offered.
    expect(appearanceOf({ accent: 'blue', density: 'cosy' })).toEqual({
      accent: 'violet',
      density: 'comfortable',
    });
    expect(DENSITIES.map((d) => d.id)).toEqual(['comfortable', 'compact']);
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
    expect(first).toEqual({ accent: 'violet', density: 'compact' });
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
