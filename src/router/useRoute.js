/**
 * The router (#296): the History API and routes.js, no dependency. The URL is
 * the page, so a deep link, Back and Forward, and a reload (a chunk reload
 * after a deploy too, chunkReload.js) all land where the URL says.
 *
 *   useRoute({ phone })   the open route and its params; re-renders on a
 *                         navigation or Back and Forward. A path with no page
 *                         is replaced by the Overview's; on a phone (below
 *                         768px) the phone's own pages have one (routes.js).
 *   useSearchParam(name)  a query parameter of the URL (the Overview's
 *                         `?subsystem=` filter, #298), or null; re-renders
 *                         when it changes. useLocationSearch(): the whole
 *                         query.
 *   navigate(to, opts)    push `to` (or replace, with { replace: true });
 *                         nothing when it is the page already open. A push
 *                         starts at the top unless { scroll: false }. The
 *                         entry holds `state` (none by default): an entity
 *                         opened in the page marks its entry (#309,
 *                         src/shell/entityNav.js).
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
const currentSearch = () => window.location.search;

/** The path of the page open now (no query or hash). */
export function useLocationPath() {
  return useSyncExternalStore(subscribe, currentPath, () => '/');
}

/** The query of the URL open now ("?subsystem=nodes", or ""). */
export function useLocationSearch() {
  return useSyncExternalStore(subscribe, currentSearch, () => '');
}

/**
 * The query parameter `name` of the URL, decoded, or null without one. A
 * string, so an unchanged value re-renders nothing.
 *
 * @param {string} name
 * @returns {string | null}
 */
export function useSearchParam(name) {
  return useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).get(name),
    () => null
  );
}

/**
 * Open `to`, a path in this app. A new page starts at the top, unless `scroll`
 * is false (a change within the page, such as the Overview's filter); Back
 * restores where the browser left it. The new entry holds `state`.
 *
 * @param {string} to
 * @param {{ replace?: boolean, scroll?: boolean, state?: any }} [options]
 */
export function navigate(to, { replace = false, scroll = !replace, state = null } = {}) {
  const here = window.location.pathname + window.location.search + window.location.hash;
  if (to === here) return;
  if (replace) window.history.replaceState(state, '', to);
  else window.history.pushState(state, '', to);
  if (scroll) window.scrollTo(0, 0);
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

/**
 * The open route, its params, and the path it was read from. `phone`: the
 * window is a phone's (below 768px), where the phone's tabs have pages of
 * their own (routes.js `phone`).
 */
export function useRoute({ phone = false } = {}) {
  const path = useLocationPath();
  const resolved = useMemo(() => resolveRoute(path, undefined, { phone }), [path, phone]);
  // A path with no page shows the Overview, under the Overview's own URL, so
  // Back never comes back to it. The query stays: an entity open over the
  // page (#309) stays open over the Overview.
  useLayoutEffect(() => {
    if (resolved.redirect) {
      navigate(pathTo(resolved.route.id) + window.location.search, { replace: true });
    }
  }, [resolved]);
  return { ...resolved, path };
}
