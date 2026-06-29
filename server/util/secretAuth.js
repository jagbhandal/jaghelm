// server/util/secretAuth.js
import { createHash, timingSafeEqual } from 'crypto';

export function constantTimeEquals(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

/** True iff a non-empty configured secret matches the provided value. */
export function secretOk(configured, provided) {
  if (!configured) return false;
  return constantTimeEquals(configured, provided || '');
}
