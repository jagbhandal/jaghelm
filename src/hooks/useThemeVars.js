/**
 * useThemeVars — applies the user's display config to the document as CSS
 * custom properties.
 *
 * Extracted verbatim from AppMain so the god-component just composes hooks.
 * Three effects:
 *   1. bg/overlay opacity
 *   2. the old --font-* variables
 *   3. card blur override
 *
 * The per-element font sizes (`fontSizes`) sized the old board's panels and
 * went with it (#306): none is set, whatever a config saved.
 *
 * No accent: there is one, violet, which the theme sets (src/styles/global.css,
 * src/ui/tokens.css; #304). A config's old `accentColor` is not read.
 *
 * The typeface is not set here: Settings → Appearance's Font family is the
 * display config's `typeface`, which the shell gives every `.jh-ui` root as
 * `data-typeface` (src/shell/appearance.js, tokens.css; #660). What this hook
 * still does is point the old `--font-display`, `--font-body` and `--font-mono`
 * variables at the chosen face, because old widgets still read them (the
 * settings-* rules in src/styles/global.css, the node and group editors, the
 * icon picker, the overlays, the error boundary and the iframe view), so those
 * draw in the same face as everything else. The old presets (Inter, Nunito, Rajdhani...)
 * went with the dead Font family cards.
 *
 * Pure side-effects on document.documentElement — returns
 * nothing. Callers pass the live `config` object.
 */

import { useEffect } from 'react';
import { typefaceOf } from '../shell/appearance.js';
import { TYPEFACES } from '../ui/typefaces.js';

const SANS_FALLBACK = 'ui-sans-serif, system-ui, sans-serif';

/** The old variables' sans stack for typeface `id` (the default's when unknown). */
export function sansStack(id) {
  const face = TYPEFACES.find((t) => t.id === id) ?? TYPEFACES[0];
  return `'${face.family}', ${SANS_FALLBACK}`;
}

export function useThemeVars(config) {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--bg-opacity', String(config.bgOpacity ?? 0.3));
    root.style.setProperty('--overlay-opacity', String(config.overlayOpacity ?? 0.75));
  }, [config.bgOpacity, config.overlayOpacity]);

  // The old font variables follow the chosen typeface (see the top).
  const typeface = typefaceOf(config);
  useEffect(() => {
    const root = document.documentElement;
    const sans = sansStack(typeface);
    root.style.setProperty('--font-display', sans);
    root.style.setProperty('--font-body', sans);
    root.style.setProperty('--font-mono', "'JetBrains Mono', monospace");
  }, [typeface]);

  // Card blur override
  useEffect(() => {
    const root = document.documentElement;
    const blur = config.cardBlur;
    if (blur && blur !== 'none') {
      const blurMap = { sm: '4px', md: '12px', lg: '24px' };
      root.style.setProperty('--glass-blur', blurMap[blur] || '24px');
    }
    // When 'none' or unset, don't override — let theme default handle it
  }, [config.cardBlur]);
}
