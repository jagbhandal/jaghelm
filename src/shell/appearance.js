/**
 * The look the display config picks for the whole app (#321, spec §7): its
 * accent (one of src/ui/accents.js, Violet by default), its density
 * (comfortable or compact) and its typeface (one of src/ui/typefaces.js,
 * Manrope by default; #660), which the shell gives every `.jh-ui` root beside
 * the theme (App.jsx, AppShell's `switches`): the header, the sidebar, the
 * tabs, each page and section of the new UI, and what they portal. Settings →
 * Appearance saves each in the display config (`accent`, `density`, `typeface`), so every
 * device draws the same; the theme stays per browser (theme.js). A value
 * nobody offers reads as the default. A config from before #660 may carry the
 * old font presets (`fontFamily`): until it has a `typeface`, that maps to a
 * face (typefaceOf; every preset to Manrope), and afterwards it is ignored.
 *
 * A config from before #304 may still carry the free picker's colour
 * (`accentColor`). Once the server's copy is in, it is mapped to the nearest
 * accent offered, once (migrateAccent in Settings' accentSet.js, loaded only
 * then, so the first load carries none of it), and Settings → Appearance says
 * so. The change saves like any other edit.
 */
import { useEffect, useMemo } from 'react';
import { ACCENTS, DEFAULT_ACCENT } from '../ui/accents.js';
import { DEFAULT_TYPEFACE, TYPEFACES } from '../ui/typefaces.js';
import { loadAccentSet } from '../lazyViews.js';

/** The densities, in the order Settings → Appearance lists them; the first is the default. */
export const DENSITIES = Object.freeze([
  Object.freeze({ id: 'comfortable', label: 'Comfortable' }),
  Object.freeze({ id: 'compact', label: 'Compact' }),
]);

export const DEFAULT_DENSITY = DENSITIES[0].id;

const ACCENT_IDS = new Set(ACCENTS.map((a) => a.id));
const DENSITY_IDS = new Set(DENSITIES.map((d) => d.id));
const TYPEFACE_IDS = new Set(TYPEFACES.map((t) => t.id));

/**
 * The old Font family presets (`fontFamily`, before #660), each with the
 * typeface it becomes. Every one was the default's sans or a face the redrawn
 * UI no longer has, so all of them read as the default, Manrope (System keeps
 * Manrope too). A config with no `typeface` yet reads its `fontFamily` here;
 * once a `typeface` is saved, the old key is ignored.
 */
export const LEGACY_FONT_FAMILIES = Object.freeze({
  default: DEFAULT_TYPEFACE,
  clean: DEFAULT_TYPEFACE,
  rounded: DEFAULT_TYPEFACE,
  sharp: DEFAULT_TYPEFACE,
  system: DEFAULT_TYPEFACE,
});

/** The typeface `config` picks: its `typeface`, else its old `fontFamily` mapped, else the default. */
export function typefaceOf(config) {
  if (TYPEFACE_IDS.has(config?.typeface)) return config.typeface;
  const old = config?.fontFamily;
  return typeof old === 'string' && Object.hasOwn(LEGACY_FONT_FAMILIES, old)
    ? LEGACY_FONT_FAMILIES[old]
    : DEFAULT_TYPEFACE;
}

/** The accent, density and typeface `config` picks, each the default when it picks none offered. */
export function appearanceOf(config) {
  return {
    accent: ACCENT_IDS.has(config?.accent) ? config.accent : DEFAULT_ACCENT,
    density: DENSITY_IDS.has(config?.density) ? config.density : DEFAULT_DENSITY,
    typeface: typefaceOf(config),
  };
}

/** Whether `config` still has the free picker's colour from before #304. */
export const hasOldAccent = (config) =>
  config != null && typeof config === 'object' && Object.hasOwn(config, 'accentColor');

/**
 * The switches the display config picks, `{ accent, density, typeface }`, for the
 * shell's roots; once `ready` (the server's copy is in), an old picker's
 * colour is mapped (see the top).
 */
export function useAppearance(config, setConfig, ready) {
  const { accent, density, typeface } = appearanceOf(config);
  const old = ready && hasOldAccent(config);
  useEffect(() => {
    if (!old) return undefined;
    let live = true;
    (async () => {
      try {
        const { migrateAccent } = await loadAccentSet();
        if (live) setConfig((prev) => migrateAccent(prev));
      } catch {
        // The chunk didn't load (offline): the next load maps it.
      }
    })();
    return () => {
      live = false;
    };
  }, [old, setConfig]);
  return useMemo(() => ({ accent, density, typeface }), [accent, density, typeface]);
}
