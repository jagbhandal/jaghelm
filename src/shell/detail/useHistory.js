/**
 * The history an open detail reads (#311): `target`'s series over `range`
 * from GET /api/history, all of its kind's in one request (historySeries.js
 * seriesFor: a node's four, a container's two), as the detail opens and when
 * the range changes, then again on an answer of the header's status poll
 * (`updated`) once the range's step has passed since its last read (a minute
 * for 1 h, 5 minutes for 24 h, 30 for 7 d): before then the server has
 * nothing newer. Its read sends the last ETag, so an unchanged answer is a
 * 304. Nothing is read while closed (`target` null), and the poll pauses in a
 * hidden tab, so this does too.
 *
 * Returns `{ body, range, error, busy }`: the last answer for this target
 * (null before the first), the range it is of, why the last read failed
 * (null once one answers), and `busy` while a switched range is read, the
 * last range's answer still drawn. Another target starts afresh, so one
 * entity's lines never show under another's name.
 */
import { useEffect, useState } from 'react';
import { NOT_MODIFIED_NO_BODY, getHistory } from '../../hooks/useData.js';
import { rangeOf, seriesFor } from '../historySeries.js';

const EMPTY = Object.freeze({ key: '', who: '', body: null, range: null, error: null });

/**
 * @param {{ kind: string, entity: string } | null} target
 * @param {string} range  '1h', '24h' or '7d'
 * @param {{ subscribe: (listener: () => void) => () => void } | null | undefined} updated
 */
export function useHistory(target, range, updated) {
  const kind = target?.kind ?? null;
  const entity = target?.entity ?? null;
  const who = kind ? `${kind}|${entity}` : '';
  const key = who ? `${who}|${range}` : '';
  const [state, setState] = useState(EMPTY);

  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    let inflight = false;
    let lastAt = -Infinity;
    const series = seriesFor(kind).join(',');
    const { stepMs } = rangeOf(range);
    const read = () => {
      if (inflight) return;
      inflight = true;
      lastAt = Date.now();
      getHistory({ series, entity, range })
        .then(
          (body) => {
            if (!live) return;
            setState((s) => {
              const mine = s.who === who;
              const kept =
                body === NOT_MODIFIED_NO_BODY || body == null ? (mine ? s.body : null) : body;
              if (s.key === key && s.body === kept && s.error === null) return s;
              return { key, who, body: kept, range, error: null };
            });
          },
          (err) => {
            if (!live) return;
            const error = String(err?.message || err || 'failed');
            setState((s) =>
              s.who === who
                ? { ...s, key, error, ...(s.key === key ? {} : { body: null, range }) }
                : { key, who, body: null, range, error }
            );
          }
        )
        .finally(() => {
          inflight = false;
        });
    };
    read();
    const stop = updated?.subscribe?.(() => {
      if (Date.now() - lastAt >= stepMs) read();
    });
    return () => {
      live = false;
      stop?.();
    };
  }, [key, who, kind, entity, range, updated]);

  if (!key || state.who !== who) return { body: null, range, error: null, busy: false };
  if (state.key !== key) return { body: state.body, range: state.range, error: null, busy: true };
  return { body: state.body, range: state.range, error: state.error, busy: false };
}
