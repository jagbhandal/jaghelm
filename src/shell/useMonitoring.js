/**
 * The Monitoring page's read (#751): GET /api/monitoring's charts for `range`,
 * as the page opens and when the range changes, then again on an answer of the
 * header's status poll (`updated`) once the range's step has passed since its
 * last read (a minute at 1 h, up to 2 hours at 30 d): before then the server
 * has nothing newer. That is the page's one extra request per refresh
 * (tickBudget.js); its read sends the last ETag, so an unchanged answer is a
 * 304. The page is only mounted while it is open, and the status poll pauses
 * in a hidden tab, so this does too. A read that failed is asked again on the
 * poll's next answer, without waiting for a step.
 *
 * Returns `{ body, range, error, busy }`: the last answer (null before the
 * first), the range it is of, why the last read failed (null once one
 * answers), and `busy` while a switched range is read, the last range's
 * answer still drawn. Per-chart failures are in the body (each chart's
 * `ok: false`, with its sentence); `error` is the read itself failing.
 *
 * @param {string} range  '1h', '24h', '7d' or '30d'
 * @param {{ subscribe: (listener: () => void) => () => void } | null | undefined} updated
 */
import { useEffect, useState } from 'react';
import { NOT_MODIFIED_NO_BODY, getMonitoring } from '../hooks/useData.js';
import { monitoringRangeOf } from './monitoring.js';

const EMPTY = Object.freeze({ range: null, body: null, error: null });

/** What a failed read says of an answer that is not the page's. */
export const NOT_MONITORING = 'Not an answer of /api/monitoring';

const isMonitoring = (body) => Array.isArray(body?.charts);

export function useMonitoring(range, updated) {
  const [state, setState] = useState(EMPTY);

  useEffect(() => {
    let live = true;
    let inflight = false;
    let lastAt = -Infinity;
    let failed = false;
    const { stepMs } = monitoringRangeOf(range);
    const read = () => {
      if (inflight) return;
      inflight = true;
      lastAt = Date.now();
      getMonitoring({ range })
        .then((body) => {
          if (body !== NOT_MODIFIED_NO_BODY && body != null && !isMonitoring(body)) {
            throw new Error(NOT_MONITORING);
          }
          return body;
        })
        .then(
          (body) => {
            failed = false;
            if (!live) return;
            setState((s) => {
              const kept =
                body === NOT_MODIFIED_NO_BODY || body == null
                  ? s.range === range
                    ? s.body
                    : null
                  : body;
              if (s.range === range && s.body === kept && s.error === null) return s;
              return { range, body: kept, error: null };
            });
          },
          (err) => {
            failed = true;
            if (!live) return;
            const error = String(err?.message || err || 'failed');
            // The last answer stays drawn, whichever range it is of, and says so (`busy`).
            setState((s) => ({ ...s, error, range: s.body ? s.range : range }));
          }
        )
        .finally(() => {
          inflight = false;
        });
    };
    read();
    const stop = updated?.subscribe?.(() => {
      if (failed || Date.now() - lastAt >= stepMs) read();
    });
    return () => {
      live = false;
      stop?.();
    };
  }, [range, updated]);

  const settled = state.range === range;
  return {
    body: state.body,
    range: state.range ?? range,
    error: state.error,
    // A switched range's read is out, and the last range's answer is still drawn.
    busy: state.body !== null && !settled && state.error === null,
  };
}
