/**
 * A lazy chunk's default export, drawn as soon as it is in, with no Suspense
 * (#578): `[value, settled]`. `load` is a loader from lazyViews.js; asking
 * starts its import. Until it settles, `[null, false]`; then its default
 * export and true, or, if the import failed, `[null, true]`, so the page draws
 * without it rather than wait. A chunk already in is there on the first
 * render. React.lazy would suspend that first render even for a chunk in, and
 * draw the page without it for a frame; a view that sits above others (the
 * Overview's Jobs section) would then move them down as it comes.
 *
 * @param {() => Promise<{ default: any }>} load
 */
import { useEffect, useState } from 'react';

/** loader -> { value } once settled */
const settled = new Map();

export function useChunk(load) {
  const [, rerender] = useState(0);
  const known = settled.get(load);
  useEffect(() => {
    if (known) return undefined;
    let live = true;
    const settle = (value) => {
      settled.set(load, { value });
      if (live) rerender((n) => n + 1);
    };
    load().then(
      (mod) => settle(mod?.default ?? null),
      () => settle(null)
    );
    return () => {
      live = false;
    };
  }, [load, known]);
  return known ? [known.value, true] : [null, false];
}
