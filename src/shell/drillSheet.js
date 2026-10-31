/**
 * The phone's drill-down sheet of a Monitoring chart (#833): the sheet a row
 * of CPU's or memory's list opens (a tap, or the banner's View graph), a
 * PhoneSheet like #303's row sheets rather than the wide page's Drawer. It is
 * a history entry of its own, so the browser's Back closes it and Forward
 * opens it again; it holds `{ chart, node }` in `history.state` under DRILL
 * (the address is the page's own, `?focus=` and all). When it closes, focus
 * returns to the row of its node, which is what a tap opened it from and what
 * a View graph ringed. The sheet itself is src/phone/components/DrillSheet.jsx
 * (the shell's files write no utility classes, the phone's do).
 */
import { backOnce, clearBackPending } from './historyBack.js';
import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';

/** Where a history entry keeps the chart drill-down it shows, `{ chart, node }`. */
export const DRILL = 'jaghelmDrill';

/**
 * Where an entry marks that a View graph already opened its sheet (`{ chart, node }`):
 * coming back to that entry (the sheet closed by Back) must not open it again.
 */
export const DRILLED = 'jaghelmDrilled';

const listeners = new Set();
const subscribe = (listener) => {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
};

/** The node the open history entry shows chart `chart` drilled to, or null. */
const nodeIn = (chart) => {
  const held = window.history.state?.[DRILL];
  return held?.chart === chart && typeof held.node === 'string' ? held.node : null;
};

/** The row of `node` in the list `chart` draws (SmallMultiples' `data-rows`), or null. */
const rowOf = (chart, node) =>
  [...document.querySelectorAll(`[data-rows="${chart}"] [data-slot="small-multiples-cell"]`)]
    .find((cell) => cell.getAttribute('data-key') === node)
    ?.querySelector('button') ?? null;

/**
 * The drill-down of chart `chart` (a DRAWINGS id) on a phone: `node` is the
 * node whose sheet is open (null when closed), `open(node)` pushes the entry
 * that opens it, `close()` goes back to the one before it. `focus` is the
 * page's (`{ node, drill }`): a View graph that drills opens its node's sheet,
 * when `known(node)` says the chart has a row for it (else the sheet would
 * open empty).
 *
 */
export function useDrillSheet(chart, { enabled = true, focus, known = () => true } = {}) {
  const node = useSyncExternalStore(subscribe, () => nodeIn(chart), () => null);

  const open = useCallback(
    (next) => {
      if (nodeIn(chart) === next) return;
      clearBackPending();
      window.history.pushState(
        { ...(window.history.state ?? {}), [DRILL]: { chart, node: next } },
        '',
        window.location.href
      );
      for (const listener of [...listeners]) listener();
    },
    [chart]
  );
  const close = useCallback(() => {
    // Once per Back: a double tap would otherwise leave the page (#837).
    if (nodeIn(chart) !== null) backOnce();
  }, [chart]);

  const wanted = Boolean(enabled && focus?.drill && focus.node && known(focus.node));
  useEffect(() => {
    if (!wanted || !focus?.node) return;
    // The entry the View graph landed on is marked first, so Back to it finds the
    // sheet already shown for this node and leaves it closed.
    const done = window.history.state?.[DRILLED];
    if (done?.chart === chart && done.node === focus.node) return;
    window.history.replaceState(
      { ...(window.history.state ?? {}), [DRILLED]: { chart, node: focus.node } },
      '',
      window.location.href
    );
    open(focus.node);
  }, [wanted, focus?.node, focus?.drill, open, chart]);

  // A sheet that unmounts leaves no close waiting (#837).
  useEffect(() => clearBackPending, []);

  // Focus back on the row of the node whose sheet closed, wherever the close came from.
  const was = useRef(node);
  useLayoutEffect(() => {
    const before = was.current;
    was.current = node;
    if (before && !node) rowOf(chart, before)?.focus();
  }, [node, chart]);

  return { node, open, close };
}
