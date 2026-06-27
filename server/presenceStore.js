/**
 * Generic persisted key→record map shared by serviceRegistry + containerRegistry.
 *
 * Both registries are "last-seen memory" stores: a prototype-free map persisted
 * to data/ as JSON, loaded corruption-safely, written atomically. The only thing
 * that differs is the record SHAPE, so the per-entry `sanitize(raw) → record|null`
 * hook is supplied by the caller (returning null drops a malformed entry).
 *
 * Conventions preserved from the original serviceRegistry.js:
 *   - Object.create(null) prototype-free map (no __proto__ collision)
 *   - explicit dirty flag — save() is a no-op unless markDirty() was called, so
 *     unchanged cycles never touch the disk
 *   - atomicWriteFileSync for crash-safety
 *   - injectable `path` + `now` for test isolation
 */
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { atomicWriteFileSync } from './util/atomicWrite.js';
import { createLogger } from './util/logger.js';

const log = createLogger('presenceStore');

export function createPresenceStore({ path, now = Date.now, sanitize = (v) => v } = {}) {
  function load() {
    try {
      if (!existsSync(path)) return Object.create(null);
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return Object.create(null);
      const safe = Object.create(null);
      for (const k of Object.keys(parsed)) {
        // Belt-and-suspenders: `safe` is already null-proto, but refuse the
        // pollution-prone keys outright so a hand-edited/corrupt file can't seed them.
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        const rec = sanitize(parsed[k]);
        if (rec) safe[k] = rec;
      }
      return safe;
    } catch {
      return Object.create(null);
    }
  }

  let store = load();
  let dirty = false;

  return {
    now,
    get(key) { return store[String(key)]; },
    set(key, record) { store[String(key)] = record; },
    delete(key) { delete store[String(key)]; },
    has(key) { return Object.prototype.hasOwnProperty.call(store, String(key)); },
    keys() { return Object.keys(store); },
    entries() { return Object.keys(store).map((k) => [k, store[k]]); },
    markDirty() { dirty = true; },
    isDirty() { return dirty; },
    save() {
      if (!dirty) return;
      try {
        const dir = dirname(path);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        atomicWriteFileSync(path, JSON.stringify(store, null, 2));
        dirty = false;
      } catch (err) {
        log.error({ err }, 'Failed to save presence store');
      }
    },
    snapshot() { return { ...store }; },
  };
}
