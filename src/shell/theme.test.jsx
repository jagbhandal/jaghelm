import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_THEME,
  LEGACY_THEMES,
  THEME_PREF,
  THEMES,
  migrateTheme,
  readTheme,
  useTheme,
} from './theme.js';

/** A matchMedia whose `(prefers-color-scheme: light)` answer the test flips, as the OS would. */
function fakeSystem(light = false) {
  const listeners = new Set();
  const query = {
    get matches() {
      return light;
    },
    media: '(prefers-color-scheme: light)',
    addEventListener: (type, fn) => type === 'change' && listeners.add(fn),
    removeEventListener: (type, fn) => type === 'change' && listeners.delete(fn),
  };
  vi.stubGlobal('matchMedia', (q) =>
    q === query.media
      ? query
      : { matches: false, media: q, addEventListener() {}, removeEventListener() {} }
  );
  return {
    set(next) {
      light = next;
      for (const fn of [...listeners]) fn({ matches: light, media: query.media });
    },
    listening: () => listeners.size,
  };
}

const html = () => document.documentElement;

beforeEach(() => {
  localStorage.clear();
  html().removeAttribute('data-theme');
});

afterEach(() => {
  localStorage.clear();
  html().removeAttribute('data-theme');
});

describe('the themes', () => {
  it('are dark, light and system, dark first', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['dark', 'light', 'system']);
    expect(DEFAULT_THEME).toBe('dark');
  });
});

describe('migrateTheme: each of the ten old themes, and the rest', () => {
  // Every theme JagHelm offered before #304, by what it drew.
  const OLD = [
    ['dark', 'dark'], // One Dark Pro
    ['dracula', 'dark'],
    ['night-owl', 'dark'],
    ['github-dark', 'dark'],
    ['catppuccin', 'dark'],
    ['material', 'dark'],
    ['github-light', 'light'],
    ['catppuccin-latte', 'light'],
    ['solarized-light', 'light'],
    ['one-light', 'light'],
  ];

  it.each(OLD)('%s becomes %s', (old, now) => {
    expect(migrateTheme(old)).toBe(now);
  });

  it('knows exactly those ten', () => {
    expect(Object.entries(LEGACY_THEMES).sort()).toEqual([...OLD].sort());
  });

  it.each(['dark', 'light', 'system'])('keeps %s', (theme) => {
    expect(migrateTheme(theme)).toBe(theme);
  });

  it.each(['solarized-dark', 'DRACULA', 'nord', '  ', 42, {}])(
    'follows the system for a value it does not know (%j)',
    (value) => {
      expect(migrateTheme(value)).toBe('system');
    }
  );

  it.each([null, undefined, ''])(
    'gives the default, dark, when nothing was saved (%j)',
    (value) => {
      expect(migrateTheme(value)).toBe('dark');
    }
  );
});

describe('readTheme', () => {
  it('reads an old theme as its new one and saves that back, once', () => {
    localStorage.setItem(THEME_PREF, 'catppuccin-latte');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    expect(readTheme()).toBe('light');
    expect(localStorage.getItem(THEME_PREF)).toBe('light');
    expect(setItem).toHaveBeenCalledTimes(1);
    setItem.mockClear();
    expect(readTheme()).toBe('light');
    expect(setItem).not.toHaveBeenCalled();
  });

  it('saves nothing when nothing was saved', () => {
    expect(readTheme()).toBe('dark');
    expect(localStorage.getItem(THEME_PREF)).toBeNull();
  });

  it('gives the default when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readTheme()).toBe('dark');
  });
});

describe('useTheme', () => {
  it('draws the saved theme on the page, an old one migrated', () => {
    fakeSystem(false);
    localStorage.setItem(THEME_PREF, 'solarized-light');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
    expect(result.current.shown).toBe('light');
    expect(html()).toHaveAttribute('data-theme', 'light');
  });

  it('switches and keeps the choice in this browser', () => {
    fakeSystem(false);
    const { result } = renderHook(() => useTheme());
    expect(html()).toHaveAttribute('data-theme', 'dark');
    act(() => result.current.setTheme('light'));
    expect(result.current.shown).toBe('light');
    expect(html()).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem(THEME_PREF)).toBe('light');
    // A new page load starts where this one left off.
    const again = renderHook(() => useTheme());
    expect(again.result.current.theme).toBe('light');
  });

  it('maps an old name it is handed (a config from before #304) to its new one', () => {
    fakeSystem(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('github-light'));
    expect(result.current.theme).toBe('light');
    expect(localStorage.getItem(THEME_PREF)).toBe('light');
  });

  it('on system, follows the OS live, both ways', () => {
    const os = fakeSystem(false);
    localStorage.setItem(THEME_PREF, 'system');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('system');
    expect(result.current.shown).toBe('dark');
    expect(html()).toHaveAttribute('data-theme', 'dark');

    act(() => os.set(true));
    expect(result.current.theme).toBe('system');
    expect(result.current.shown).toBe('light');
    expect(html()).toHaveAttribute('data-theme', 'light');

    act(() => os.set(false));
    expect(result.current.shown).toBe('dark');
    expect(html()).toHaveAttribute('data-theme', 'dark');
    // What is saved is the choice, not what the OS said.
    expect(localStorage.getItem(THEME_PREF)).toBe('system');
  });

  it('on dark or light, ignores the OS', () => {
    const os = fakeSystem(false);
    localStorage.setItem(THEME_PREF, 'dark');
    const { result } = renderHook(() => useTheme());
    act(() => os.set(true));
    expect(result.current.shown).toBe('dark');
    expect(html()).toHaveAttribute('data-theme', 'dark');
  });

  it('stops listening to the OS when unmounted', () => {
    const os = fakeSystem(false);
    localStorage.setItem(THEME_PREF, 'system');
    const { unmount } = renderHook(() => useTheme());
    expect(os.listening()).toBe(1);
    unmount();
    expect(os.listening()).toBe(0);
  });

  it('is dark on system where the browser has no matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    localStorage.setItem(THEME_PREF, 'system');
    const { result } = renderHook(() => useTheme());
    expect(result.current.shown).toBe('dark');
  });
});
