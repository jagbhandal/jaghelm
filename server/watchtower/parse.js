// server/watchtower/parse.js
// Parse Watchtower's structured notification body into a fixed-schema object.
// Grammar (one record per line, pipe-delimited):
//   updated|<name>|<fromImageId>|<toImageId>
//   failed|<name>|<error>
// Unknown/malformed lines are ignored (never throw on operator/registry text).
// Records are plain objects with FIXED keys only — parsed tokens are never used
// as object keys (prototype-pollution guard).
//
// Cap records so a pathological body (bounded to 1 MB by express.json, but still
// up to ~65k lines) can't blow up the downstream push/Discord/dedup work. A real
// Watchtower run touches a handful of containers; 500 is generous headroom.
const MAX_RECORDS = 500;

export function parseWatchtowerReport(message) {
  const updated = [];
  const failed = [];
  if (typeof message !== 'string') return { updated, failed };
  for (const rawLine of message.split('\n')) {
    if (updated.length + failed.length >= MAX_RECORDS) break;
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
