/**
 * Keeps keyboard focus on the same row when the window crosses a width that
 * swaps the page's markup (#510): below 768px the phone screens, from it the
 * wide Overview. They are different trees (the phone splits the attention
 * panel around the strip), so the element that had focus is unmounted and
 * focus would fall to the body. A row or tile is named the same in both
 * (IssueRow, SubsystemTile: `data-slot` and `aria-label`), so focus moves to
 * the new element of that name once it is drawn (the phone screens are a
 * lazy chunk, and the rows wait for the status).
 *
 * The element is read on the resize that crosses the width, which is before
 * React draws the other tree. Focus is taken only while it is still on the body: a
 * visitor who moved it meanwhile keeps theirs. It gives up after `WAIT_MS`.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';

const WAIT_MS = 5000;

/** A selector for `el`'s counterpart in the other tree, or null if it has none. */
function selectorOf(el, root) {
  if (!el || !root?.contains(el)) return null;
  const slot = el.getAttribute('data-slot');
  const label = el.getAttribute('aria-label');
  return slot && label
    ? `[data-slot="${CSS.escape(slot)}"][aria-label="${CSS.escape(label)}"]`
    : null;
}

/**
 * @param {boolean} matches  whether it matches now (the render that follows a change)
 * @param {string} rootSelector  where the swapped markup lives
 */
export function useKeepFocusAcrossWidth(matches, rootSelector) {
  const wanted = useRef(null);

  // Before the swap: a resize is handled before the media query's change is
  // reported, and React draws the other tree only after that, so the old
  // element is still focused. Every resize notes it; the last one before
  // the swap is the one used.
  useEffect(() => {
    const onResize = () => {
      wanted.current = selectorOf(document.activeElement, document.querySelector(rootSelector));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [rootSelector]);

  // After it: wait for the counterpart to be drawn, then focus it.
  useLayoutEffect(() => {
    const selector = wanted.current;
    wanted.current = null;
    const root = document.querySelector(rootSelector);
    if (!selector || !root) return undefined;
    let done = false;
    const stop = () => {
      done = true;
      observer.disconnect();
      clearTimeout(timer);
    };
    const attempt = () => {
      if (done) return;
      const active = document.activeElement;
      if (active && active !== document.body) return stop(); // the visitor's own move
      const target = root.querySelector(selector);
      if (!target) return;
      target.focus({ preventScroll: false });
      stop();
    };
    const observer = new MutationObserver(attempt);
    const timer = setTimeout(stop, WAIT_MS);
    observer.observe(root, { childList: true, subtree: true });
    attempt();
    return stop;
  }, [matches, rootSelector]);
}
