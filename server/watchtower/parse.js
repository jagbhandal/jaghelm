// server/watchtower/parse.js
// Parse Watchtower's structured notification body into a fixed-schema object.
// Grammar (one record per line, pipe-delimited):
//   updated|<name>|<fromImageId>|<toImageId>
//   failed|<name>|<error>
// Unknown/malformed lines are ignored (never throw on operator/registry text).
// Records are plain objects with FIXED keys only — parsed tokens are never used
// as object keys (prototype-pollution guard).
export function parseWatchtowerReport(message) {
  const updated = [];
  const failed = [];
  if (typeof message !== 'string') return { updated, failed };
  for (const rawLine of message.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split('|');
    if (parts[0] === 'updated' && parts.length >= 4) {
      updated.push({ name: parts[1], from: parts[2], to: parts[3] });
    } else if (parts[0] === 'failed' && parts.length >= 3) {
      failed.push({ name: parts[1], error: parts.slice(2).join('|') });
    }
  }
  return { updated, failed };
}
