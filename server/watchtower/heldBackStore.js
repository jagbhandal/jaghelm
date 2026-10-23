/**
 * Per-node held-back (monitor-only "stale") container store.
 *
 * "Held back" is STATE, not an event: a monitor-only container stays stale on
 * EVERY Watchtower run until it is manually pulled. So we persist the last-known
 * stale set per node and surface only TRANSITIONS — newly held back, or caught
 * up — which is what stops a daily monitor-only run from re-pinging the same
 * backlog forever (the known Watchtower footgun, containrrr/watchtower#1962).
 *
 * A tolerant load that never throws, and a null-prototype map (node and
 * container names are untrusted and used as object keys). Shape:
 * { [node]: Array<{ name, current, latest }> }.
 *
 * State is PERSISTED, not only in memory, on purpose: a JagHelm restart must
 * not re-announce the standing backlog as if it were newly held back. The
 * Arcane poller, its one user, persists it with its notices since #581
 * (arcane/notices.js): `toFile()` goes into push-snapshot.json in the write
 * that queues the poll's pushes, `initial` is what that file holds (or, once,
 * the arcane-held-back.json of a JagHelm before #581), and `revision()` counts
 * the changes.
 */

// Defense-in-depth against a flood from a node (or a leaked secret): bound both
// the per-field length and the number of retained node keys, so a crafted body
// can't grow the stored sets (and the rewrite cost of the file they go into)
// without bound. Generous for a homelab — real use is a handful of nodes, few stale each.
const MAX_FIELD = 256; // matches the node-name slice in routes/watchtower.js
const MAX_NODES = 100;

/** Coerce one incoming stale entry to a length-bounded fixed-key record, or null. */
function sanitize(entry) {
  if (!entry || typeof entry.name !== 'string') return null;
  return {
    name: entry.name.slice(0, MAX_FIELD),
    current: String(entry.current ?? '').slice(0, MAX_FIELD),
    latest: String(entry.latest ?? '').slice(0, MAX_FIELD),
  };
}

/**
 * @param {object} [opts]
 * @param {unknown} [opts.initial]  the sets as toFile() gave them (anything else starts empty)
 */
export function createHeldBackStore({ initial } = {}) {
  let revision = 0;

  /** Tolerant load: anything but an object => an empty null-proto map; non-array values dropped. */
  function load(parsed) {
    try {
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const safe = Object.create(null);
        for (const k of Object.keys(parsed)) {
          if (Array.isArray(parsed[k])) safe[k] = parsed[k].map(sanitize).filter(Boolean);
        }
        return safe;
      }
      return Object.create(null);
    } catch {
      return Object.create(null);
    }
  }

  const store = load(initial);

  /**
   * Replace `node`'s held-back set with `staleList` and return the transitions.
   *   - newlyHeldBack: in the new set but NOT previously held back, OR whose
   *     `latest` image changed (a newer update dropped on an already-stale one).
   *   - cleared:       previously held back, now absent from the new set.
   *   - current:       the new full, de-duped, sanitized set (the standing list).
   * The persisted set is advanced only when something actually changed, so a
   * steady-state backlog incurs no disk writes.
   */
  function diffAndSet(node, staleList) {
    const prev = Object.prototype.hasOwnProperty.call(store, node) ? store[node] : [];
    const prevByName = new Map(prev.map((e) => [e.name, e]));

    // Sanitize + de-dup the incoming list by name (last record for a name wins).
    const currentByName = new Map();
    for (const raw of Array.isArray(staleList) ? staleList : []) {
      const e = sanitize(raw);
      if (e) currentByName.set(e.name, e);
    }
    const current = [...currentByName.values()];

    // Newly held back: absent before, or its latest image changed since.
    const newlyHeldBack = current.filter((e) => {
      const before = prevByName.get(e.name);
      return !before || before.latest !== e.latest;
    });
    // Cleared: was held back, now gone from the stale set.
    const cleared = prev.filter((e) => !currentByName.has(e.name));

    if (newlyHeldBack.length || cleared.length) {
      const isNewNode = !Object.prototype.hasOwnProperty.call(store, node);
      // defineProperty so a '__proto__' node name lands as an OWN key on the
      // null-proto map rather than mutating Object.prototype.
      Object.defineProperty(store, node, {
        value: current, writable: true, enumerable: true, configurable: true,
      });
      // Bound the node count: evict oldest-inserted keys (string keys keep
      // insertion order) so a flood of unique node names can't grow the file.
      if (isNewNode) {
        let keys = Object.keys(store);
        while (keys.length > MAX_NODES && keys[0] !== node) {
          delete store[keys[0]];
          keys = Object.keys(store);
        }
      }
      revision += 1;
    }
    return { newlyHeldBack, cleared, current };
  }

  /** Current standing held-back set for a node (defensive copy). */
  function getNode(node) {
    return Object.prototype.hasOwnProperty.call(store, node) ? store[node].slice() : [];
  }

  /** Every node's set, as the file holds it (the shape arcane-held-back.json had); copies. */
  function toFile() {
    // fromEntries defines own properties, so a '__proto__' node stays a plain key.
    return Object.fromEntries(Object.keys(store).map((node) => [node, store[node].map((e) => ({ ...e }))]));
  }

  return { diffAndSet, getNode, toFile, revision: () => revision };
}
