/**
 * The anchors of the places that draw an entity on the Overview (#297): each
 * place carries, as its `id`, the anchor of the entity it draws, by the status
 * model's id (docs/ARCHITECTURE.md §4.7), so a page can link to it and focus
 * it:
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
 * Each place, as it mounts, puts its anchor on a list (usePlace, usePlaces)
 * and takes it off as it unmounts. Issue rows led to these places until
 * entities had URLs of their own; since #309 a row opens its entity's detail
 * (entityNav.js), and nothing reads the list. #306 removes it with today's
 * board, whose panels are most of its places.
 */
import { useEffect } from 'react';

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

// The anchors of the places the board draws now, each with how many places
// carry it, and a snapshot of them, replaced on each change.
const counts = new Map();
let drawn = new Set();

function changed() {
  drawn = new Set(counts.keys());
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
