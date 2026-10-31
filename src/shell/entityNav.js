/**
 * Entity URLs (#309, spec §7): every thing the status model watches has an
 * address, its model id in the query of whatever page it is opened over:
 *
 *   /?entity=services/apps:jellyfin            a service, over the Overview
 *   /alerts?entity=backups/storage:nightly-backup   a backup, over Alerts
 *   /services?entity=nodes/storage             a node, over a phone's Services
 *
 * A query, not a path of its own, because the detail is drawn over the page
 * it was opened from (the desktop's Drawer, the phone's sheet), which stays as
 * it was under it: a reload, Back and Forward, a link pasted into another
 * tab, and a sign-in (the sign-in screen leaves the URL alone) each draw the
 * page and the detail over it. The id is the model's (stable across refreshes
 * and restarts, docs/ARCHITECTURE.md §4.7), written with its `/` and `:` as
 * they are, so the address reads as the id. A push names the same id
 * (server/push/entity.js), and src/phone/nav/entityRoute.js says which
 * detail shows it.
 *
 * Opening an entity in the page pushes an entry that holds the details it
 * shows (SHEETS, the phone's stack of sheets, the desktop's one), which marks
 * it as opened here: closing it goes back, so Back and Close agree. An entity
 * opened from its URL (a reload of a link, a tab of its own) has no entry
 * before it in this app: closing it replaces the URL with the page's.
 */
import { useMemo } from 'react';
import {
  navigate,
  useLocationPath,
  useLocationSearch,
  useSearchParam,
} from '../router/useRoute.js';
import { backOnce, clearBackPending } from './historyBack.js';
import { entityOfRoute, entityRoute } from '../phone/nav/entityRoute.js';

/** The query parameter that names the open entity. */
export const ENTITY = 'entity';

/**
 * The query parameter that names a drive in the open node (drive health,
 * #728): `/alerts?entity=nodes/nas&drive=sdb` opens the node's detail with
 * that drive's row open and marked. It means something only beside the node's
 * own entity, and goes with it.
 */
export const DRIVE = 'drive';

/** Where a history entry keeps the details it shows, [{ screen, params }]. */
export const SHEETS = 'jaghelmSheets';

/** The details `state` (a history entry's) shows: [{ screen, params }], none by default. */
export function sheetsOf(state) {
  const list = state?.[SHEETS];
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && typeof e.screen === 'string')
    .map((e) => ({ screen: e.screen, params: e.params ?? {} }));
}

/** The entity id `search` (a URL's query) names, or null. */
export function entityIn(search) {
  const id = new URLSearchParams(search).get(ENTITY);
  return id ? id : null;
}

/**
 * The details the history entry at `state` and `search` shows: the stack it
 * holds when its top is the URL's entity (opened in the page), else the URL's
 * entity alone (opened from its URL), and none without one. The URL decides.
 */
export function sheetsAt(state, search) {
  const id = entityIn(search);
  if (!id) return [];
  const held = sheetsOf(state);
  if (held.length > 0 && entityOfRoute(held[held.length - 1]) === id) return held;
  const route = entityRoute(id);
  return route ? [route] : [{ screen: 'incident', params: { id } }];
}

/** An id as the URL writes it: encoded, but its `/` and `:` as they are. */
const written = (id) => encodeURIComponent(id).replace(/%2F/giu, '/').replace(/%3A/giu, ':');

/**
 * The URL of entity `id` over the page at `where` (the window's location by
 * default): its path, its other query parameters (the Overview's filter), then
 * the entity.
 *
 * @param {string} id
 * @param {{ pathname: string, search: string }} [where]
 * @param {{ drive?: string | null }} [options]  `drive`: a drive of this node to open and mark in it
 */
export function entityHref(id, where = window.location, { drive = null } = {}) {
  const params = new URLSearchParams(where.search);
  params.delete(ENTITY);
  params.delete(DRIVE);
  const rest = params.toString();
  const marked = drive ? `&${DRIVE}=${encodeURIComponent(drive)}` : '';
  return `${where.pathname}?${rest ? `${rest}&` : ''}${ENTITY}=${written(id)}${marked}`;
}

/** The URL of the page at `where` with no entity open. */
export function pageHref(where = window.location) {
  const params = new URLSearchParams(where.search);
  params.delete(ENTITY);
  params.delete(DRIVE);
  const rest = params.toString();
  return `${where.pathname}${rest ? `?${rest}` : ''}${where.hash ?? ''}`;
}

/** The open entity's id (the URL's), or null; re-renders when it changes. */
export function useEntityParam() {
  return useSearchParam(ENTITY);
}

/**
 * The drive the URL marks in node entity `id` (#728), or null: only while that
 * node is the open entity, so another sheet under it is left alone.
 *
 * @param {string | null | undefined} id
 */
export function useDriveParam(id) {
  const open = useSearchParam(ENTITY);
  const drive = useSearchParam(DRIVE);
  return id && open === id ? drive : null;
}

// What had focus when the entity was opened in the page: where focus goes back
// when it closes (the desktop's Drawer; the phone's sheets keep their own).
let opener = null;

/** The element that opened the entity now open, while it is still on the page; else null. */
export function entityOpener() {
  return opener?.isConnected ? opener : null;
}

/**
 * Where focus goes when the entity now open closes, in place of what opened
 * it: a Remove takes the row that opened it off the page (#578).
 *
 * @param {Element | null} el
 */
export function returnFocusTo(el) {
  if (el) opener = el;
}

/**
 * Opens entity `id` over the page: a history entry of its own, holding
 * `sheets` (the details over the page, the entity's on top; just the entity's
 * by default). The page doesn't scroll.
 *
 * @param {string} id
 * @param {{ sheets?: Array<{ screen: string, params: object }>, drive?: string | null }} [options]
 *   `drive`: a drive of this node to open and mark in its detail (#728)
 */
export function openEntity(id, { sheets, drive = null } = {}) {
  const active = document.activeElement;
  opener = active && active !== document.body ? active : null;
  clearBackPending();
  const stack = sheets ?? [entityRoute(id) ?? { screen: 'incident', params: { id } }];
  navigate(entityHref(id, window.location, { drive }), {
    scroll: false,
    state: { ...(window.history.state ?? {}), [SHEETS]: stack },
  });
}

/**
 * Closes the open entity: back to the entry it was opened from, when it was
 * opened in the page; else (opened from its URL) the URL becomes the page's.
 * A second close before the first one's `popstate` does nothing (#837,
 * historyBack.js), so a double tap on Back cannot go back past the page.
 */
export function closeEntity() {
  if (sheetsOf(window.history.state).length > 0) backOnce();
  else navigate(pageHref(), { replace: true, scroll: false });
}

/**
 * A row's link to entity `id` (IssueRow and EntityRow's `href` and `onOpen`):
 * its URL over this page, for a new tab, and on a plain click, opening it
 * here.
 *
 * @param {string} id
 * @param {{ drive?: string | null }} [options]
 */
export function entityLink(id, { drive = null } = {}) {
  return {
    href: entityHref(id, window.location, { drive }),
    onOpen: () => openEntity(id, { drive }),
  };
}

/**
 * entityLink for a list that keeps its rows (a memo): a new function only when
 * the page under an entity changes (its path, the Overview's filter), not when
 * an entity opens or closes, so each row's `href` stays the URL it opens.
 */
export function useEntityLink() {
  const pathname = useLocationPath();
  const search = useLocationSearch();
  const page = pageHref({ pathname, search, hash: '' });
  return useMemo(() => {
    const [path, query = ''] = page.split('?');
    const where = { pathname: path, search: query ? `?${query}` : '' };
    return (id, { drive = null } = {}) => ({
      href: entityHref(id, where, { drive }),
      onOpen: () => openEntity(id, { drive }),
    });
  }, [page]);
}
