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
    const out = { lastSeenNode: v.lastSeenNode, lastSeenAt: Number(v.lastSeenAt) || 0 };
    // Optional: the container name this monitor was last matched to, so an
    // outage's synthesized down card can reuse the SAME uid the running card had.
    if (typeof v.lastSeenContainer === 'string') out.lastSeenContainer = v.lastSeenContainer;
    return out;
  }
  return null;
}

export function createServiceRegistry({ path = DEFAULT_PATH, now = Date.now } = {}) {
  const core = createPresenceStore({ path, now, sanitize: sanitizeServiceEntry });

  function recordSeen(monitorId, nodeKey, containerName) {
    if (monitorId == null || !nodeKey) return;
    const key = String(monitorId);
    const prev = core.get(key);
    // Keep any previously-remembered container if this call omits it (backward
    // compatible with 2-arg callers).
    const container = typeof containerName === 'string' ? containerName : prev?.lastSeenContainer;
    // A changed NODE or CONTAINER is a meaningful write — a refreshed lastSeenAt
    // for the same (node, container) never dirties the store (keeps disk churn
    // off the hot loop).
    if (!prev || prev.lastSeenNode !== nodeKey || prev.lastSeenContainer !== container) core.markDirty();
    const record = { lastSeenNode: nodeKey, lastSeenAt: core.now() };
    if (container != null) record.lastSeenContainer = container;
    core.set(key, record);
  }

  function getLastSeenNode(monitorId) {
    const e = core.get(monitorId);
    return e ? e.lastSeenNode : null;
  }

  function getLastSeenContainer(monitorId) {
    const e = core.get(monitorId);
    return e && typeof e.lastSeenContainer === 'string' ? e.lastSeenContainer : null;
  }

  return { recordSeen, getLastSeenNode, getLastSeenContainer, save: core.save, snapshot: core.snapshot };
}

export const serviceRegistry = createServiceRegistry();
