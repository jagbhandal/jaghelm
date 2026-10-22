/**
 * Whether the window matches a media query, following it as it changes, for a
 * part of the shell that changes its markup at a width rather than only its
 * look: the Overview's phone split at `PHONE_WIDTH` (#484) and its utilities
 * rail at `RAIL_WIDTH` (#301), both from @ui/app-shell. Read with matchMedia
 * through useSyncExternalStore, so a resize across the width re-renders at
 * once; false where there is no matchMedia (and on the server).
 */
import { useCallback, useSyncExternalStore } from 'react';

const queryOf = (query) =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query)
    : null;

/** Whether the window matches `query`, such as '(width >= 90rem)'. */
export function useMediaQuery(query) {
  const subscribe = useCallback(
    (onChange) => {
      const list = queryOf(query);
      list?.addEventListener('change', onChange);
      return () => list?.removeEventListener('change', onChange);
    },
    [query]
  );
  const matches = useCallback(() => queryOf(query)?.matches ?? false, [query]);
  return useSyncExternalStore(subscribe, matches, () => false);
}
