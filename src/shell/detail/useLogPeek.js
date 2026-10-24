/**
 * The recent errors an open detail shows (#672): `target`'s last error-ish
 * lines from GET /api/logs, read as the detail opens (never before: a null
 * `target` reads nothing) and then on an answer of the header's status poll
 * (`updated`) once a minute has passed since the last read, so an open node
 * or container detail adds at most one request a minute, beside its history's
 * (useHistory.js). The poll pauses in a hidden tab, so this does too.
 * `paused` (a phone's sheet covered by another) reads nothing, the last
 * answer kept drawn.
 *
 * Returns `{ state, lines, reason }`: `loading` before the first answer of
 * this target; then the server's `ok`, `none` or `unavailable`. A read that
 * fails (the server unreachable, an older server without the route) is
 * `unavailable` too, in words; it never throws, and nothing toasts. Another
 * target starts afresh, so one entity's lines never show under another's name.
 */
import { useEffect, useState } from 'react';
import { getLogs } from '../../hooks/useData.js';

/** The least time between two reads of one open detail. */
export const LOG_READ_EVERY_MS = 60_000;

const LOADING = Object.freeze({ state: 'loading', lines: [], reason: null });
const STATES = new Set(['ok', 'none', 'unavailable']);

/** A server answer as the detail draws it, else `unavailable`. */
function shapeOf(body) {
  if (!body || typeof body !== 'object' || !STATES.has(body.state)) {
    return { state: 'unavailable', lines: [], reason: null };
  }
  return {
    state: body.state,
    lines: Array.isArray(body.lines) ? body.lines : [],
    reason: typeof body.reason === 'string' ? body.reason : null,
  };
}

/**
 * @param {{ kind: string, entity: string } | null} target
 * @param {{ subscribe: (listener: () => void) => () => void } | null | undefined} updated
 * @param {{ paused?: boolean }} [options]
 */
export function useLogPeek(target, updated, { paused = false } = {}) {
  const entity = target?.entity ?? null;
  const [held, setHeld] = useState({ entity: null, ...LOADING });

  useEffect(() => {
    if (!entity || paused) return undefined;
    let live = true;
    let inflight = false;
    let lastAt = -Infinity;
    const read = () => {
      if (inflight) return;
      inflight = true;
      lastAt = Date.now();
      getLogs({ entity })
        .then(shapeOf, () => ({ state: 'unavailable', lines: [], reason: null }))
        .then((next) => {
          if (live) setHeld({ entity, ...next });
        })
        .finally(() => {
          inflight = false;
        });
    };
    read();
    const stop = updated?.subscribe?.(() => {
      if (Date.now() - lastAt >= LOG_READ_EVERY_MS) read();
    });
    return () => {
      live = false;
      stop?.();
    };
  }, [entity, updated, paused]);

  if (!entity || held.entity !== entity) return LOADING;
  return { state: held.state, lines: held.lines, reason: held.reason };
}
