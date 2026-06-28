// Pure formatters: parsed report -> push event + Discord message. No I/O.

/** Escape Discord markdown + neutralize mass mentions in untrusted text. */
export function escapeDiscord(text) {
  return String(text)
    .replace(/([\\`*_~|>])/g, '\\$1')
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

/** One Discord message per run. */
export function buildDiscordContent({ node, updated, failed }) {
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
  return lines.join('\n');
}
