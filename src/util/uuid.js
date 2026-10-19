/**
 * A random UUID v4 that works on a plain-HTTP origin too.
 *
 * `crypto.randomUUID()` exists only in secure contexts (HTTPS or localhost), so
 * on the default `http://<lan-ip>:3099` deployment it is undefined. Use it when
 * present, otherwise build the same RFC 9562 v4 layout from
 * `crypto.getRandomValues()`, which every browser exposes in any context.
 * Never falls back to Math.random.
 */
export function uuidV4() {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
