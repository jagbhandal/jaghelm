/**
 * The Overview's arrangement (#330, spec §8 "Edit layout mode"): which order
 * its sections come in, and which services are pinned to the top of the
 * Services section. Kept in the display config as `overviewLayout`:
 *
 *   { order: ['services', 'jobs', ...], pinned: ['pi-1:adguard-home', ...] }
 *
 * An arrangement, never a position: ids and uids in order, nothing in pixels,
 * so the reflowing layout (#306) lays it out at any width. It goes through the
 * same versioned save as every other setting (#233, #547): both lists are
 * leaves, so two devices that change different ones both keep theirs.
 *
 * What is NOT in it:
 *  - hidden sections: `overviewSections.<id>` (overviewSections.js), the
 *    switches Settings → Appearance edits. One source of truth: the Edit
 *    layout mode flips the same keys.
 *  - groups: the custom groups of Settings → Nodes & Services (`customGroups`,
 *    customGroups.js). "Group" in Edit layout means those.
 *  - the attention panel and the subsystem strip, which always come first
 *    (the incident-first order is not an arrangement), and the utilities rail,
 *    which sits beside the sections: they can be switched, not moved.
 *
 * The Overview reads this with readLayout, which never throws: a value of the
 * wrong shape reads as unset, an id no section has is ignored, a section the
 * stored order lacks (a newer build's) comes after the stored ones in the
 * default order, and a duplicate is read once. A config with no arrangement
 * reads as the default, which draws the Overview as it always was.
 */

/** The sections an arrangement can move, in their default order. */
export const REORDERABLE = Object.freeze([
  'infrastructure',
  'power',
  'jobs',
  'services',
  'hostActions',
]);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The distinct, non-empty strings of `v` (an array), or none. */
const strings = (v) =>
  Array.isArray(v)
    ? [...new Set(v.filter((s) => typeof s === 'string' && s !== '' && s.length <= 200))]
    : [];

/**
 * The arrangement `config` holds: `{ order, pinned }`, `order` every
 * reorderable section exactly once, `pinned` the pinned uids, in order.
 */
export function readLayout(config) {
  const raw = config?.overviewLayout;
  const stored = isObject(raw) ? strings(raw.order).filter((id) => REORDERABLE.includes(id)) : [];
  return {
    order: [...stored, ...REORDERABLE.filter((id) => !stored.includes(id))],
    pinned: isObject(raw) ? strings(raw.pinned) : [],
  };
}

/** Whether `layout` is the default arrangement (what the Overview was before Edit layout). */
export function isDefaultLayout(layout) {
  return layout.pinned.length === 0 && layout.order.every((id, i) => id === REORDERABLE[i]);
}

/**
 * What to save for `layout`: `{ order?, pinned? }` with only what differs from
 * the default, or undefined for the default (the key then goes from the
 * file, so an untouched config stays as it was).
 */
export function layoutValue(layout) {
  if (isDefaultLayout(layout)) return undefined;
  const out = {};
  if (layout.order.some((id, i) => id !== REORDERABLE[i])) out.order = layout.order;
  if (layout.pinned.length > 0) out.pinned = layout.pinned;
  return out;
}

/** `list` with `id` moved to `index` (clamped); the same array when it doesn't move. */
export function moveTo(list, id, index) {
  const from = list.indexOf(id);
  if (from < 0) return list;
  const to = Math.max(0, Math.min(list.length - 1, index));
  if (to === from) return list;
  const next = list.filter((x) => x !== id);
  next.splice(to, 0, id);
  return next;
}

/** `list` with `id` one place up (-1) or down (1). */
export const moveBy = (list, id, delta) => moveTo(list, id, list.indexOf(id) + delta);

/** `pinned` with `uid` added at the end, or the same array when it is there. */
export const pin = (pinned, uid) => (pinned.includes(uid) ? pinned : [...pinned, uid]);

/** `pinned` without `uid`. */
export const unpin = (pinned, uid) =>
  pinned.includes(uid) ? pinned.filter((u) => u !== uid) : pinned;

/**
 * `layout` without the pins `isGone(uid)` says are gone. With no `isGone` (the
 * services not read yet) nothing is pruned, so a slow start never loses a pin.
 * A pin goes only by an explicit unpin, or when the service is really gone
 * (serviceGone), never because it can't be seen right now.
 */
export function pruneLayout(layout, isGone) {
  if (!isGone) return layout;
  const pinned = layout.pinned.filter((uid) => !isGone(uid));
  return pinned.length === layout.pinned.length ? layout : { ...layout, pinned };
}

/**
 * Whether a service is really gone, as a function of its uid, or null when
 * that can't be told yet (the status or /api/services not read). A pin is
 * gone only when the model has no such service AND its node answered in full
 * (reachable, every read in) and doesn't list it. A node that is down, hidden
 * or unknown (a restart with a node still down, a Prometheus gap) never makes
 * its pins gone: the service is just not visible.
 *
 * @param {any} status the model's /api/status
 * @param {any} services /api/services
 */
export function serviceGone(status, services) {
  const entities = Array.isArray(status?.entities) ? status.entities : null;
  const nodes = isObject(services?.nodes) ? services.nodes : null;
  if (!entities || !nodes) return null;
  const known = new Set();
  for (const e of entities) {
    if (e?.subsystem === 'services' && typeof e.id === 'string') {
      known.add(e.id.startsWith('services/') ? e.id.slice('services/'.length) : e.id);
    }
  }
  return (uid) => {
    if (known.has(uid)) return false;
    const at = uid.indexOf(':');
    const node = at > 0 ? nodes[uid.slice(0, at)] : null;
    if (!isObject(node) || node.reachable === false) return false;
    if (Array.isArray(node.failedReads) && node.failedReads.length > 0) return false;
    return true;
  };
}

/** "1 of 4": where `id` is in `list`, for an announcement. */
export const placeOf = (list, id) => `${list.indexOf(id) + 1} of ${list.length}`;

/**
 * The Services section's groups with the pinned services in a group of their
 * own first, titled "Pinned", in the pinned order and not in the group they
 * would have been in. A pinned uid with no row (the service is gone, on a
 * hidden node, or folded into a stack) draws nothing. A pinned stack is its
 * lead's row, so it stays one row. With none to draw, the groups as they are.
 *
 * @param {Array<{ key: string, rows: any[] }>} groups serviceGroups'
 * @param {string[]} pinned
 * @param {(rows: any[]) => string} count a group's count line ("2 / 3 up")
 */
export function withPinned(groups, pinned, count) {
  if (pinned.length === 0) return groups;
  const byUid = new Map();
  for (const g of groups) for (const r of g.rows) if (!byUid.has(r.uid)) byUid.set(r.uid, r);
  const rows = pinned
    .map((uid) => byUid.get(uid))
    .filter(Boolean)
    .map((r) => ({ ...r, where: r.nodeName ?? null }));
  if (rows.length === 0) return groups;
  const taken = new Set(rows.map((r) => r.id));
  const rest = groups
    .map((g) => {
      const kept = g.rows.filter((r) => !taken.has(r.id));
      return kept.length === g.rows.length ? g : { ...g, rows: kept, count: count(kept) };
    })
    .filter((g) => g.rows.length > 0);
  return [{ key: 'pinned', title: 'Pinned', host: null, count: count(rows), rows }, ...rest];
}

/**
 * The custom group (`customGroups`' element) that holds `uid`, the first, as
 * the Services section groups (servicesView.js serviceGroups), and whether it
 * holds it only through a bare container name (saved before #517), which
 * Edit layout can't take it out of: Settings → Nodes & Services does.
 *
 * @param {Array<any>} groups
 * @param {string} uid
 * @param {(group: any) => string[]} held the uids a group holds
 * @param {(group: any) => string[]} heldByName the uids it holds through a name
 */
export function groupOf(groups, uid, held, heldByName) {
  for (const g of groups) {
    if (held(g).includes(uid)) return { group: g, byName: heldByName(g).includes(uid) };
  }
  return { group: null, byName: false };
}

/**
 * `groups` with the service `uid` in group `to` (an id, or null for none) and
 * in no other: the exact entry taken out of the groups that name it. The same
 * array when nothing changes.
 */
export function assignGroup(groups, uid, to) {
  const next = groups.map((g) => {
    const entries = Array.isArray(g.containers) ? g.containers : [];
    const has = entries.includes(uid);
    if (g.id === to) return has ? g : { ...g, containers: [...entries, uid] };
    return has ? { ...g, containers: entries.filter((e) => e !== uid) } : g;
  });
  return next.some((g, i) => g !== groups[i]) ? next : groups;
}
