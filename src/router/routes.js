/**
 * The app's routes (#296): one table, matched on the History API's path
 * (useRoute.js). No router dependency: a path is a list of segments, `:name`
 * reads a param and `:name?` an optional last one, ready for Phase 2's entity
 * URLs (`/services/:id`).
 *
 * A route whose page isn't built yet can be `hidden`: it stays in the table,
 * so the card that builds its page only unhides it, but it is left out of the
 * nav, and a visit to it lands on the Overview, as a path no route matches
 * does. No placeholder pages. A hidden route that is also `phone` has a page
 * on a phone already (the shared phone screens, src/phone/), and from 768px
 * is hidden. None is hidden now: /services and /infrastructure (#313) are a
 * page at every width, the phone's tab below 768px (#303) and the wide page
 * from it, so a window crossing 768px keeps the path, and its query.
 * /monitoring (#751, #755) is the same, its phone page reached from the More
 * sheet; `phone` marks that it has one.
 */

/**
 * @typedef {{ id: string, path: string, title?: string, hidden?: boolean, phone?: boolean }} Route
 */

/** @type {ReadonlyArray<Readonly<Route>>} */
export const ROUTES = Object.freeze(
  [
    { id: 'overview', path: '/', title: 'Overview' },
    { id: 'alerts', path: '/alerts', title: 'Alerts' },
    { id: 'app', path: '/apps/:id' },
    { id: 'settings', path: '/settings/:section?', title: 'Settings' },
    { id: 'launch', path: '/launch', title: 'Launch' },
    { id: 'services', path: '/services', title: 'Services' },
    { id: 'infrastructure', path: '/infrastructure', title: 'Infrastructure' },
    // /monitoring (#751): the wide page from 768px, the phone's page (#755)
    // below, reached from the More sheet; no tab of the five.
    // `phone` is read only for a hidden route (resolveRoute); here it records that
    // the address has a phone page.
    { id: 'monitoring', path: '/monitoring', title: 'Monitoring', phone: true },
  ].map((r) => Object.freeze(r))
);

/** The ids of the routes the nav leaves out until their page exists. */
export const NAV_HIDDEN = new Set(ROUTES.filter((r) => r.hidden).map((r) => r.id));

const segments = (path) => {
  const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return trimmed.split('/').slice(1);
};

/**
 * The params of `pathname` under `pattern`, or null when it doesn't match.
 * A param is URI-decoded; one that can't be decoded doesn't match.
 *
 * @param {string} pattern such as '/apps/:id' or '/settings/:section?'
 * @param {string} pathname
 * @returns {Record<string, string> | null}
 */
export function matchPath(pattern, pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return null;
  const want = segments(pattern);
  const got = segments(pathname);
  if (pattern === '/') return pathname === '/' ? {} : null;
  const optional = want.length > 0 && want[want.length - 1].endsWith('?');
  if (got.length > want.length || got.length < want.length - (optional ? 1 : 0)) return null;
  const params = {};
  for (let i = 0; i < want.length; i++) {
    const w = want[i];
    const g = got[i];
    if (w.startsWith(':')) {
      if (g === undefined) continue; // the optional last one
      if (g === '') return null;
      let value;
      try {
        value = decodeURIComponent(g);
      } catch {
        return null;
      }
      params[w.slice(1).replace(/\?$/, '')] = value;
    } else if (w !== g) {
      return null;
    }
  }
  return params;
}

/**
 * The route `pathname` opens, and its params. A path no route matches, or a
 * hidden route's, opens the Overview with `redirect` set: the caller replaces
 * the URL with the Overview's. On a `phone` (below 768px), a hidden route
 * that is a phone's opens.
 *
 * @param {string} pathname
 * @param {ReadonlyArray<Route>} [routes]
 * @param {{ phone?: boolean }} [at]
 */
export function resolveRoute(pathname, routes = ROUTES, { phone = false } = {}) {
  for (const route of routes) {
    const params = matchPath(route.path, pathname);
    if (params && (!route.hidden || (phone && route.phone))) {
      return { route, params, redirect: false };
    }
  }
  const overview = routes.find((r) => r.id === 'overview');
  return { route: overview, params: {}, redirect: true };
}

/**
 * The path of route `id` with `params`, each URI-encoded. Throws on an unknown
 * route or a missing param: a link to nowhere is a bug, not a fallback.
 *
 * @param {string} id
 * @param {Record<string, string>} [params]
 */
export function pathTo(id, params = {}) {
  const route = ROUTES.find((r) => r.id === id);
  if (!route) throw new Error(`No route "${id}"`);
  const out = [];
  for (const s of segments(route.path)) {
    if (!s.startsWith(':')) {
      out.push(s);
      continue;
    }
    const name = s.slice(1).replace(/\?$/, '');
    const value = params[name];
    if (value == null || value === '') {
      if (s.endsWith('?')) continue;
      throw new Error(`Route "${id}" needs its "${name}"`);
    }
    out.push(encodeURIComponent(String(value)));
  }
  return `/${out.join('/')}`;
}
