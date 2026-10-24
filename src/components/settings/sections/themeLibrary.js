import { useMemo } from 'react';
import { validateThemes } from '../../../../server/themes.js';

/**
 * `{ valid, rejected }` for a display config's `themes` (#331, server/themes.js:
 * the contrast rules run again here, when the config loads, whatever the server
 * said). Checked again only when the list changes.
 */
export function useThemeLibrary(themes) {
  const text = JSON.stringify(themes ?? null);
  return useMemo(() => validateThemes(JSON.parse(text)), [text]);
}
