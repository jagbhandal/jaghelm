/**
 * Last-seen-node memory for the dashboard, keyed by Kuma monitor id.
 *
 * When a service's container is running we record which node it was on. When
 * that container later disappears but its Uptime Kuma monitor reports DOWN, the
 * board synthesises a red "down" card and places it under this remembered node
 * (its panel), so an outage shows where the service normally lives. Source of
 * truth for up/down stays Kuma; this only answers "which panel".
 *
 * Now a thin wrapper over the shared createPresenceStore core (persistence +
 * corruption-safe load + dirty-flag save), with a monitor-id record shape.
 */
import { join } from 'path';
import { createPresenceStore } from './presenceStore.js';
import { DATA_DIR } from './util/dataDir.js';

const DEFAULT_PATH = join(DATA_DIR, 'service-registry.json');

function sanitizeServiceEntry(v) {
  if (v && typeof v === 'object' && typeof v.lastSeenNode === 'string') {
    return { lastSeenNode: v.lastSeenNode, lastSeenAt: Number(v.lastSeenAt) || 0 };
  }
  return null;
}

export function createServiceRegistry({ path = DEFAULT_PATH, now = Date.now } = {}) {
  const core = createPresenceStore({ path, now, sanitize: sanitizeServiceEntry });

  function recordSeen(monitorId, nodeKey) {
    if (monitorId == null || !nodeKey) return;
    const key = String(monitorId);
    const prev = core.get(key);
    // Only the NODE changing is a meaningful write — a refreshed lastSeenAt for
    // the same node never dirties the store (keeps disk churn off the hot loop).
    if (!prev || prev.lastSeenNode !== nodeKey) core.markDirty();
    core.set(key, { lastSeenNode: nodeKey, lastSeenAt: core.now() });
  }

  function getLastSeenNode(monitorId) {
    const e = core.get(monitorId);
    return e ? e.lastSeenNode : null;
  }

  return { recordSeen, getLastSeenNode, save: core.save, snapshot: core.snapshot };
}

export const serviceRegistry = createServiceRegistry();
