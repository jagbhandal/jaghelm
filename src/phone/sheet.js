import { createContext, useContext, useId } from 'react';

/**
 * Where a detail screen is drawn on the web (#303): over its tab, as a
 * full-screen sheet (src/shell/PhoneView.jsx), a dialog named by the
 * screen's own title. The sheet gives the id its title takes; drawn anywhere
 * else (the gallery, a test, the Android app) the title has an id of its own.
 */
export const SheetContext = createContext(null);

/** The id a detail screen's title takes: the sheet's, which names it, or one of its own. */
export function useSheetTitleId() {
  const own = useId();
  return useContext(SheetContext)?.titleId ?? own;
}
