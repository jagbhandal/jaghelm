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
import { envValue } from './env.js';

const DEFAULT_PATH = join(DATA_DIR, 'container-registry.json');

// Deterministic, env-overridable (JAGHELM_* convention; defaults in env.js). Only
// a finite, positive override is valid: the boot refuses a typo'd / Infinity /
// negative value rather than let it disable prune (unbounded registry growth).
export const PRESENCE_GRACE_MS = envValue('JAGHELM_PRESENCE_GRACE_MS'); // 90s ≈ 3 refreshes
export const PRESENCE_TTL_MS = envValue('JAGHELM_PRESENCE_TTL_MS'); // 24h decommission fade
export const PRESENCE_ESTABLISH_MS = envValue('JAGHELM_PRESENCE_ESTABLISH_MS'); // 60s min run span

// A change to what getMissing can answer (a new container, a node move, one
// becoming established, a prune) is written the cycle it happens. A running
// container's advancing lastSeenAt only matters after a restart, so it is
// written at most this often, and by flush() on shutdown.
export const PRESENCE_FLUSH_MS = 5 * 60_000;

function sanitizeContainerEntry(v) {
  if (v && typeof v === 'object' && typeof v.lastSeenNode === 'string') {
    const out = {
      lastSeenNode: v.lastSeenNode,
      firstSeenAt: Number(v.firstSeenAt) || 0,
      lastSeenAt: Number(v.lastSeenAt) || 0,
    };
    // The Compose project it ran in (#642), so a stopped member still belongs to its stack.
    if (typeof v.project === 'string' && v.project) out.project = v.project;
    // Whether its own Kuma monitor checked a web address when it last ran (#642).
    if (v.web === true) out.web = true;
    return out;
  }
  return null;
}

export function createContainerRegistry({ path = DEFAULT_PATH, now = Date.now, write } = {}) {
  const core = createPresenceStore({ path, now, sanitize: sanitizeContainerEntry, write });
  let pending = false; // a lastSeenAt advanced since the last write
  let lastWriteAt = core.now();

  function recordSeen(name, nodeKey, at = core.now(), project, web) {
    if (!name || !nodeKey) return;
    const key = String(name);
    const prev = core.get(key);
    const firstSeenAt = prev ? prev.firstSeenAt : at;
    // A sighting with no project keeps the one remembered: a cAdvisor that
    // stops labelling must not unhook a stopped member from its stack.
    const kept = typeof project === 'string' && project ? project : prev?.project;
    const entry = { lastSeenNode: nodeKey, firstSeenAt, lastSeenAt: at };
    if (kept) entry.project = kept;
    // Kept like the project: a sighting that doesn't say leaves what is remembered.
    const keptWeb = typeof web === 'boolean' ? web : prev?.web === true;
    if (keptWeb) entry.web = true;
    core.set(key, entry);
    const wasEstablished = prev && prev.lastSeenAt - prev.firstSeenAt >= PRESENCE_ESTABLISH_MS;
    const established = at - firstSeenAt >= PRESENCE_ESTABLISH_MS;
    if (
      !prev ||
      prev.lastSeenNode !== nodeKey ||
      prev.project !== kept ||
      (prev.web === true) !== keptWeb ||
      established !== wasEstablished
    )
      core.markDirty();
    else pending = true;
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
        const missing = {
          container: name,
          lastSeenNode: rec.lastSeenNode,
          lastSeenAt: rec.lastSeenAt,
          ageMs,
        };
        if (rec.project) missing.project = rec.project;
        if (rec.web) missing.web = true;
        out.push(missing);
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

  /**
   * Forget a container now (#688), written at once rather than on the next
   * cycle, so a restart straight after doesn't bring it back. True when a
   * record was removed. Discovery makes a new record if it ever runs again.
   */
  function forget(name) {
    const key = String(name);
    if (!core.has(key)) return false;
    core.delete(key);
    core.markDirty();
    persist();
    return true;
  }

  // A failed write leaves the store dirty, so the next save retries it.
  function persist() {
    if (!core.isDirty()) return;
    core.save();
    if (core.isDirty()) return;
    pending = false;
    lastWriteAt = core.now();
  }

  /** Called every refresh cycle: writes changes, and a refreshed lastSeenAt every PRESENCE_FLUSH_MS. */
  function save() {
    if (pending && core.now() - lastWriteAt >= PRESENCE_FLUSH_MS) core.markDirty();
    persist();
  }

  /** Writes a refreshed lastSeenAt now, without waiting for the interval (shutdown). */
  function flush() {
    if (pending) core.markDirty();
    persist();
  }

  return { recordSeen, getMissing, forget, prune, save, flush, snapshot: core.snapshot };
}

export const containerRegistry = createContainerRegistry();
