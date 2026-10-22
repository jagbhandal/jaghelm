import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RAIL_WIDTH } from '@ui/app-shell';
import { useMediaQuery } from './useMediaQuery.js';

/** A matchMedia whose answer the test sets, telling its listeners. */
function fakeMedia(initial) {
  let matches = initial;
  const listeners = new Set();
  vi.spyOn(window, 'matchMedia').mockImplementation((media) => ({
    get matches() {
      return matches;
    },
    media,
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
  }));
  return {
    set(next) {
      matches = next;
      for (const fn of [...listeners]) fn();
    },
    listeners,
  };
}

describe('useMediaQuery', () => {
  it('follows the window across the width, and stops listening when unmounted', () => {
    const media = fakeMedia(false);
    const { result, unmount } = renderHook(() => useMediaQuery(RAIL_WIDTH));
    expect(result.current).toBe(false);
    expect(window.matchMedia).toHaveBeenCalledWith('(width >= 90rem)');
    act(() => media.set(true));
    expect(result.current).toBe(true);
    act(() => media.set(false));
    expect(result.current).toBe(false);
    unmount();
    expect(media.listeners.size).toBe(0);
  });

  it('is false without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useMediaQuery(RAIL_WIDTH));
    expect(result.current).toBe(false);
  });
});
