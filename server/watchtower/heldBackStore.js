/**
 * Per-node held-back (monitor-only "stale") container store.
 *
 * "Held back" is STATE, not an event: a monitor-only container stays stale on
 * EVERY Watchtower run until it is manually pulled. So we persist the last-known
 * stale set per node and surface only TRANSITIONS — newly held back, or caught
 * up — which is what stops a daily monitor-only run from re-pinging the same
 * backlog forever (the known Watchtower footgun, containrrr/watchtower#1962).
 *
 * Mirrors tokenStore's persistence idiom: a tolerant JSON load() that never
 * throws on a missing/corrupt file, a null-prototype map (node and container
 * names are untrusted and used as object keys), and atomicWriteFileSync on every
 * mutation. Persisted shape: { [node]: Array<{ name, current, latest }> }.
 *
 * State is PERSISTED, not in-memory, on purpose: a JagHelm restart must not
 * re-announce the standing backlog as if it were newly held back.
 */
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { atomicWriteFileSync } from '../util/atomicWrite.js';
import { DATA_DIR } from '../util/dataDir.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('held-back');

const DEFAULT_PATH = join(DATA_DIR, 'held-back.json');

// Defense-in-depth against a flood from a node (or a leaked secret): bound both
// the per-field length and the number of retained node keys, so a crafted body
// can't grow data/held-back.json (and its synchronous rewrite cost) without
// bound. Generous for a homelab — real use is a handful of nodes, few stale each.
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

export function createHeldBackStore({ path = DEFAULT_PATH } = {}) {
  /** Tolerant load: missing/corrupt => null-proto map; non-array values dropped. */
  function load() {
    try {
      if (!existsSync(path)) return Object.create(null);
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
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

  function save(data) {
    try {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      atomicWriteFileSync(path, JSON.stringify(data, null, 2));
    } catch (err) {
      log.error({ err }, 'Failed to save held-back state');
    }
  }

  let store = load();

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
      save(store);
    }
    return { newlyHeldBack, cleared, current };
  }

  /** Current standing held-back set for a node (defensive copy). */
  function getNode(node) {
    return Object.prototype.hasOwnProperty.call(store, node) ? store[node].slice() : [];
  }

  return { diffAndSet, getNode };
}

// Process-wide singleton: the watchtower route is the only writer, but a single
// instance keeps the in-memory map authoritative between webhook calls without a
// reload-from-disk per request.
let singleton = null;
export function getHeldBackStore() {
  if (!singleton) singleton = createHeldBackStore({});
  return singleton;
}
