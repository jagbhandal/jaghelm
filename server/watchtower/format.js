// Pure formatters: parsed report -> push event + Discord message. No I/O.

/** Escape Discord markdown + neutralize mass mentions in untrusted text. */
export function escapeDiscord(text) {
  return String(text)
    .replace(/([\\`*_~|<>[\]])/g, '\\$1')
    .replace(/@(everyone|here)/gi, '@​$1')
    .replace(/\r?\n/g, ' ');
}

/** One digest push event per Watchtower run. */
export function buildPushEvent({ node, updated, failed }) {
  const names = updated.map((u) => u.name).join(', ');
  let body = updated.length ? `${updated.length} updated: ${names}` : 'no updates';
  if (failed.length) body += ` · ${failed.length} failed`;
  return {
    type: 'watchtower_update',
    id: `watchtower:${node}`,
    node,
    title: `Watchtower · ${node}`,
    body,
    severity: failed.length ? 'warning' : 'info',
  };
}

/**
 * Push event: monitor-only container(s) now have an update HELD BACK. Fired only
 * for newly-held-back containers (transition), so it never repeats per cycle.
 * Category is `watchtower` (gated by that pref); NOT a recovery, so it is not
 * suppressed by notifyRecoveries — a held-back update is news you want.
 */
export function buildHeldBackPushEvent({ node, heldBack }) {
  const names = heldBack.map((h) => h.name).join(', ');
  return {
    type: 'watchtower_heldback',
    id: `watchtower:${node}:heldback`,
    node,
    title: `Watchtower · ${node}`,
    body: `${heldBack.length} update${heldBack.length === 1 ? '' : 's'} held back: ${names}`,
    severity: 'info',
  };
}

/**
 * Recovery push event: previously held-back container(s) are now caught up.
 * Type is registered in differ.js RECOVERY_TYPES, so it honors notifyRecoveries.
 */
export function buildClearedPushEvent({ node, cleared }) {
  const names = cleared.map((c) => c.name).join(', ');
  return {
    type: 'watchtower_cleared',
    id: `watchtower:${node}:cleared`,
    node,
    title: `Watchtower · ${node}`,
    body: `${cleared.length} caught up: ${names}`,
    severity: 'info',
  };
}

/**
 * One Discord message per run. `heldBack` is the full STANDING set (the digest
 * surface), `cleared` is the just-resolved set; both default empty so existing
 * updated/failed-only callers are unchanged.
 */
export function buildDiscordContent({ node, updated, failed, heldBack = [], cleared = [] }) {
  const lines = [];
  if (updated.length) {
    const parts = updated.map(
      (u) => `${escapeDiscord(u.name)} (${escapeDiscord(u.from)}→${escapeDiscord(u.to)})`,
    );
    lines.push(`🔄 **Watchtower · ${escapeDiscord(node)}** — Updated: ${parts.join(', ')}`);
  }
  if (failed.length) {
    const parts = failed.map((f) => `${escapeDiscord(f.name)} (${escapeDiscord(f.error)})`);
    lines.push(`⚠️ Failed: ${parts.join(', ')}`);
  }
  if (heldBack.length) {
    const parts = heldBack.map(
      (h) => `${escapeDiscord(h.name)} (${escapeDiscord(h.current)}→${escapeDiscord(h.latest)})`,
    );
    lines.push(`⏸️ **Watchtower · ${escapeDiscord(node)}** — Held back (${heldBack.length}): ${parts.join(', ')}`);
  }
  if (cleared.length) {
    const parts = cleared.map((c) => escapeDiscord(c.name));
    lines.push(`✅ **Watchtower · ${escapeDiscord(node)}** — Caught up: ${parts.join(', ')}`);
  }
  return lines.join('\n');
}
