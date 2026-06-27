/**
 * Last-seen-node memory for the dashboard.
 *
 * When a service's container is running we record which node it was on. When
 * that container later disappears but its Uptime Kuma monitor reports DOWN, the
 * board synthesises a red "down" card and places it under this remembered node
 * (its panel), so an outage shows where the service normally lives. Source of
 * truth for up/down stays Kuma; this only answers "which panel".
 *
 * Persisted to data/ so a service already down at boot still lands on its panel.
 * Keyed by Kuma monitor id (stable). Mirrors push/tokenStore.js conventions.
 */
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { atomicWriteFileSync } from './util/atomicWrite.js';
import { DATA_DIR } from './util/dataDir.js';
import { createLogger } from './util/logger.js';

const log = createLogger('serviceRegistry');
const DEFAULT_PATH = join(DATA_DIR, 'service-registry.json');

export function createServiceRegistry({ path = DEFAULT_PATH, now = Date.now } = {}) {
  function load() {
    try {
      if (!existsSync(path)) return Object.create(null);
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const safe = Object.create(null);
        for (const k of Object.keys(parsed)) {
          const v = parsed[k];
          if (v && typeof v === 'object' && typeof v.lastSeenNode === 'string') {
            safe[k] = { lastSeenNode: v.lastSeenNode, lastSeenAt: Number(v.lastSeenAt) || 0 };
          }
        }
        return safe;
      }
      return Object.create(null);
    } catch {
      return Object.create(null);
    }
  }

  let store = load();
  let dirty = false;

  function recordSeen(monitorId, nodeKey) {
    if (monitorId == null || !nodeKey) return;
    const key = String(monitorId);
    const prev = store[key];
    if (!prev || prev.lastSeenNode !== nodeKey) dirty = true;
    store[key] = { lastSeenNode: nodeKey, lastSeenAt: now() };
  }

  function getLastSeenNode(monitorId) {
    const e = store[String(monitorId)];
    return e ? e.lastSeenNode : null;
  }

  function save() {
    if (!dirty) return;
    try {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      atomicWriteFileSync(path, JSON.stringify(store, null, 2));
      dirty = false;
    } catch (err) {
      log.error({ err }, 'Failed to save service registry');
    }
  }

  function snapshot() {
    return { ...store };
  }

  return { recordSeen, getLastSeenNode, save, snapshot };
}

export const serviceRegistry = createServiceRegistry();
