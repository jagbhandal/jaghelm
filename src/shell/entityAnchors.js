/**
 * Where an issue row on the Overview leads (#297), until entities have URLs of
 * their own (#309): an in-page anchor on today's board, the legacy dashboard
 * under the attention panel. A place on the board carries, as its `id`, the
 * anchor of the entity it draws, by the status model's id (docs/ARCHITECTURE.md
 * §4.7):
 *
 *   services/<node>:<container>   a service's row in the Services section
 *                                 (OverviewServices, #300)
 *   nodes/<key>                   a node's card in the Infrastructure section
 *                                 (OverviewInfrastructure, #299), or its row
 *                                 in the table; its NodePanel while a filter
 *                                 hides the section
 *   power/ups                     the UPS panel (UPSCard)
 *   jobs/<node>:<job>             a job's row in Scheduled Jobs (CronJobs)
 *
 * An issue's row leads to the first of its places the board draws: a service
 * to its row, else its node's card (while the Services section is hidden); a
 * backup to its job's row, since the board lists backups as jobs.
 * Integrations, Arcane agents and monitoring sources have no place of their
 * own on the board, so their rows lead nowhere and are plain content.
 *
 * Whether the board draws a place is the board's own say: each place, as it
 * mounts, puts its anchor on a list (usePlace, usePlaces) and takes it off as
 * it unmounts, so the rows follow every rule that hides one (a section
 * switched off, the UPS panel with no UPS, Scheduled Jobs off, a section a
 * filter hides) without restating any. A row whose
 * places are all off the board is plain content too (#279): no link, no
 * chevron, nothing on Enter.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';

/**
 * The anchor of the place that draws `entityId`: the id behind a prefix, every
 * character but letters, digits and `. : / -` written as `_<hex>_`, so it is a
 * valid HTML id and URL fragment, and two ids never share one.
 */
export function entityAnchor(entityId) {
  const safe = String(entityId).replace(
    /[^A-Za-z0-9.:/-]/gu,
    (c) => `_${c.codePointAt(0).toString(16)}_`
  );
  return `entity-${safe}`;
}

/** The anchors an issue's row may lead to, best first; none for a kind with no place. */
export function anchorsOf(entity) {
  switch (entity?.kind) {
    case 'service':
    case 'container':
      return [entityAnchor(entity.id), entity.node && entityAnchor(`nodes/${entity.node}`)].filter(
        Boolean
      );
    case 'node':
    case 'ups':
    case 'job':
      return [entityAnchor(entity.id)];
    case 'backup':
      return [entityAnchor(`jobs/${entity.node}:${entity.name}`)];
    default:
      return [];
  }
}

/**
 * Moves to the first of `anchors` the page draws: focus on it, so the keyboard
 * carries on from there (only from code: a place gets `tabindex="-1"` unless it
 * has one), and its top into view, under the header (`scroll-padding-top` on
 * the page, global.css). Returns whether there was one.
 */
export function openAnchor(anchors) {
  for (const id of anchors) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'start' });
    return true;
  }
  return false;
}

// The anchors of the places the board draws now, each with how many places
// carry it, and a snapshot of them, replaced on each change.
const counts = new Map();
const listeners = new Set();
let drawn = new Set();

function changed() {
  drawn = new Set(counts.keys());
  for (const listener of listeners) listener();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Puts `anchor` on the list of places drawn; returns what takes it off. */
function put(anchor) {
  counts.set(anchor, (counts.get(anchor) ?? 0) + 1);
  changed();
  return () => {
    const left = counts.get(anchor) - 1;
    if (left > 0) counts.set(anchor, left);
    else counts.delete(anchor);
    changed();
  };
}

/** The anchors of the places the board draws now (a snapshot: a new Set on each change). */
export const drawnAnchors = () => drawn;

/**
 * For a component that draws the places of `entityIds` while it is mounted:
 * puts their anchors on the list, and takes them off when it unmounts or
 * draws others.
 */
export function usePlaces(entityIds) {
  const key = entityIds.join('\n');
  useEffect(() => {
    if (!key) return undefined;
    const offs = key.split('\n').map((id) => put(entityAnchor(id)));
    return () => offs.forEach((off) => off());
  }, [key]);
}

/**
 * For a component that draws the place of `entityId`, when `shown`: its
 * anchor, to put as the place's `id` (undefined when not shown), on the list
 * while it is mounted.
 */
export function usePlace(entityId, shown = true) {
  usePlaces(shown ? [entityId] : []);
  return shown ? entityAnchor(entityId) : undefined;
}

/**
 * An issue row's link on the Overview, given the anchors drawn: `href` to the
 * first of its entity's places the board draws and `onOpen` to move there, or
 * nothing when the board draws none of them.
 */
export function rowLink(entity, drawnNow) {
  const anchors = anchorsOf(entity).filter((a) => drawnNow.has(a));
  if (anchors.length === 0) return {};
  return { href: `#${anchors[0]}`, onOpen: () => openAnchor(anchors) };
}

/** rowLink, kept to the places the board draws: a new function each time they change. */
export function useRowLink() {
  const drawnNow = useSyncExternalStore(subscribe, drawnAnchors, drawnAnchors);
  return useMemo(() => (entity) => rowLink(entity, drawnNow), [drawnNow]);
}
