/**
 * The theme (#304; spec §2, §5.2): dark, light, or system, which follows the
 * device's `prefers-color-scheme` as it changes. One accent, violet, for all
 * three (src/ui/accents.js; the picker for the other two is #321).
 *
 * The choice is kept per browser (`prefs`, key `jaghelm-theme`). A browser that
 * saved one of the ten themes from before #304 has it read once as dark or
 * light, by what it drew, and the new value saved back; a value nobody wrote
 * (hand-edited, a later version's) reads as system. With nothing saved the
 * theme is dark.
 *
 * `useTheme()` holds it for the app: the choice (`theme`), what is drawn
 * (`shown`, dark or light), and `setTheme`. It puts `shown` on <html> as
 * `data-theme`, where today's stylesheet reads it (src/styles/global.css), and
 * the shell hands it to its `.jh-ui` roots (AppShell's `switches`).
 */
import { useCallback, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { prefs } from '../storage/index.js';

/** Where the choice is kept, per browser. */
export const THEME_PREF = 'jaghelm-theme';

/** The theme with nothing saved. */
export const DEFAULT_THEME = 'dark';

/** The choices, in the order Settings → Appearance and the command palette list them. */
export const THEMES = Object.freeze([
  Object.freeze({ id: 'dark', label: 'Dark', description: 'Graphite with a violet accent' }),
  Object.freeze({ id: 'light', label: 'Light', description: 'For bright rooms' }),
  Object.freeze({ id: 'system', label: 'System', description: 'Follows the device' }),
]);

const IDS = new Set(THEMES.map((t) => t.id));

/** The ten themes before #304, each as the theme it becomes. */
export const LEGACY_THEMES = Object.freeze({
  dark: 'dark', // One Dark Pro
  dracula: 'dark',
  'night-owl': 'dark',
  'github-dark': 'dark',
  catppuccin: 'dark',
  material: 'dark',
  'github-light': 'light',
  'catppuccin-latte': 'light',
  'solarized-light': 'light',
  'one-light': 'light',
});

/**
 * A saved value as one of today's themes: kept when it is one, an old theme as
 * dark or light, nothing saved as the default, anything else as system.
 */
export function migrateTheme(value) {
  if (value == null || value === '') return DEFAULT_THEME;
  if (IDS.has(value)) return value;
  return Object.hasOwn(LEGACY_THEMES, value) ? LEGACY_THEMES[value] : 'system';
}

/** The saved theme, migrated; a migrated value is saved back, so this happens once. */
export function readTheme() {
  const saved = prefs.get(THEME_PREF);
  const theme = migrateTheme(saved);
  if (saved != null && saved !== theme) prefs.set(THEME_PREF, theme);
  return theme;
}

const LIGHT_QUERY = '(prefers-color-scheme: light)';

const lightQuery = () =>
  typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(LIGHT_QUERY) : null;

/** What the device asks for: light when it says so, else dark. */
function systemTheme() {
  return lightQuery()?.matches ? 'light' : 'dark';
}

function subscribeSystem(onChange) {
  const query = lightQuery();
  query?.addEventListener?.('change', onChange);
  return () => query?.removeEventListener?.('change', onChange);
}

const serverTheme = () => DEFAULT_THEME;

/** The theme for the app; see the top of this file. */
export function useTheme() {
  const [theme, setChoice] = useState(readTheme);
  const system = useSyncExternalStore(subscribeSystem, systemTheme, serverTheme);
  const shown = theme === 'system' ? system : theme;

  // Before paint, so a switch never shows a frame of the old theme.
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', shown);
  }, [shown]);

  const setTheme = useCallback((next) => {
    const value = migrateTheme(next);
    prefs.set(THEME_PREF, value);
    setChoice(value);
  }, []);

  return useMemo(() => ({ theme, shown, setTheme }), [theme, shown, setTheme]);
}
