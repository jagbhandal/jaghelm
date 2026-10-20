/**
 * The router (#296): the History API and routes.js, no dependency. The URL is
 * the page, so a deep link, Back and Forward, and a reload (a chunk reload
 * after a deploy too, chunkReload.js) all land where the URL says.
 *
 *   useRoute()            the open route and its params; re-renders on a
 *                         navigation or Back and Forward. A path with no page
 *                         is replaced by the Overview's.
 *   navigate(to, opts)    push `to` (or replace, with { replace: true });
 *                         nothing when it is the page already open.
 *   followLink(e, href)   a link's onClick: navigates in the page on a plain
 *                         left click and leaves a modified or middle click to
 *                         the browser, so "open in a new tab" still works.
 */
import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { pathTo, resolveRoute } from './routes.js';

const listeners = new Set();

function subscribe(listener) {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

const currentPath = () => window.location.pathname;

/** The path of the page open now (no query or hash). */
export function useLocationPath() {
  return useSyncExternalStore(subscribe, currentPath, () => '/');
}

/**
 * Open `to`, a path in this app. A new page starts at the top; Back restores
 * where the browser left it.
 *
 * @param {string} to
 * @param {{ replace?: boolean }} [options]
 */
export function navigate(to, { replace = false } = {}) {
  const here = window.location.pathname + window.location.search + window.location.hash;
  if (to === here) return;
  if (replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  if (!replace) window.scrollTo(0, 0);
  for (const listener of [...listeners]) listener();
}

/**
 * A link's click handler: a plain left click navigates in the page; a click
 * with a modifier, or another button, is left to the browser.
 *
 * @param {MouseEvent | import('react').MouseEvent} event
 * @param {string} href
 * @returns {boolean} whether it navigated
 */
export function followLink(event, href) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return false;
  }
  event.preventDefault();
  navigate(href);
  return true;
}

/** The open route, its params, and the path it was read from. */
export function useRoute() {
  const path = useLocationPath();
  const resolved = useMemo(() => resolveRoute(path), [path]);
  // A path with no page shows the Overview, under the Overview's own URL, so
  // Back never comes back to it.
  useLayoutEffect(() => {
    if (resolved.redirect) navigate(pathTo(resolved.route.id), { replace: true });
  }, [resolved]);
  return { ...resolved, path };
}
