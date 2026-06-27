/**
 * Vanished-container presence memory for the breadcrumb feature.
 *
 * Keyed by container NAME globally (so a container that legitimately moves nodes
 * is never falsely "missing" — running anywhere ⇒ present). For each name we
 * remember when it was first seen (to gate out ephemeral one-shot jobs), when it
 * was last seen, and on which node (to place the breadcrumb under its panel).
 *
 * getMissing returns the names that are ESTABLISHED (ran long enough to matter)
 * and currently in the ABSENT WINDOW (gone long enough to not be a scrape blip,
 * but not so long they're a decommission). prune() decommission-cleans past TTL.
 *
 * Thin wrapper over the shared createPresenceStore core.
 */
import { join } from 'path';
import { createPresenceStore } from './presenceStore.js';
import { DATA_DIR } from './util/dataDir.js';

const DEFAULT_PATH = join(DATA_DIR, 'container-registry.json');

// Deterministic, env-overridable (JAGHELM_* convention). Only a finite, positive
// override wins — a typo'd / Infinity / negative value falls back to the default
// rather than silently disabling prune (which would let the registry grow unbounded).
function positiveMs(envVal, def) {
  const n = Number(envVal);
  return Number.isFinite(n) && n > 0 ? n : def;
}
export const PRESENCE_GRACE_MS = positiveMs(process.env.JAGHELM_PRESENCE_GRACE_MS, 90_000);        // 90s ≈ 3 refreshes
export const PRESENCE_TTL_MS = positiveMs(process.env.JAGHELM_PRESENCE_TTL_MS, 86_400_000);        // 24h decommission fade
export const PRESENCE_ESTABLISH_MS = positiveMs(process.env.JAGHELM_PRESENCE_ESTABLISH_MS, 60_000); // 60s min run span

function sanitizeContainerEntry(v) {
  if (v && typeof v === 'object' && typeof v.lastSeenNode === 'string') {
    return {
      lastSeenNode: v.lastSeenNode,
      firstSeenAt: Number(v.firstSeenAt) || 0,
      lastSeenAt: Number(v.lastSeenAt) || 0,
    };
  }
  return null;
}

export function createContainerRegistry({ path = DEFAULT_PATH, now = Date.now } = {}) {
  const core = createPresenceStore({ path, now, sanitize: sanitizeContainerEntry });

  function recordSeen(name, nodeKey, at = core.now()) {
    if (!name || !nodeKey) return;
    const key = String(name);
    const prev = core.get(key);
    const firstSeenAt = prev ? prev.firstSeenAt : at;
    core.set(key, { lastSeenNode: nodeKey, firstSeenAt, lastSeenAt: at });
    core.markDirty();
  }

  function getMissing({
    now: nowMs = core.now(),
    graceMs = PRESENCE_GRACE_MS,
    ttlMs = PRESENCE_TTL_MS,
    establishMs = PRESENCE_ESTABLISH_MS,
  } = {}) {
    const out = [];
    for (const [name, rec] of core.entries()) {
      const established = rec.lastSeenAt - rec.firstSeenAt >= establishMs;
      const ageMs = nowMs - rec.lastSeenAt;
      if (established && ageMs >= graceMs && ageMs <= ttlMs) {
        out.push({ container: name, lastSeenNode: rec.lastSeenNode, lastSeenAt: rec.lastSeenAt, ageMs });
      }
    }
    return out;
  }

  function prune(ttlMs = PRESENCE_TTL_MS, nowMs = core.now()) {
    for (const [name, rec] of core.entries()) {
      if (nowMs - rec.lastSeenAt > ttlMs) {
        core.delete(name);
        core.markDirty();
      }
    }
  }

  function save() {
    core.save();
  }

  return { recordSeen, getMissing, prune, save, snapshot: core.snapshot };
}

export const containerRegistry = createContainerRegistry();
