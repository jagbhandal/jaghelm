/**
 * The history an open detail reads (#311): `target`'s series over `range`
 * from GET /api/history, all of its kind's in one request (historySeries.js
 * seriesFor: a node's four, five with drive data (#728), a container's two), as the detail opens and when
 * the range changes, then again on an answer of the header's status poll
 * (`updated`) once the range's step has passed since its last read (a minute
 * for 1 h, 5 minutes for 24 h, 30 for 7 d): before then the server has
 * nothing newer. Its read sends the last ETag, so an unchanged answer is a
 * 304. Nothing is read while closed (`target` null), and the poll pauses in a
 * hidden tab, so this does too.
 *
 * `paused` (#602): a phone's sheet covered by another reads nothing, its
 * last answer kept drawn; on top again, it reads at once, then as before.
 *
 * An older server (#602): one from before #311 answers /api/history
 * with the ring buffer's, whatever is asked: an
 * object of number lists keyed "<node>:cpu", "<node>:mem" and
 * "<node>:disk" (`{}` before its first sample). Its first such answer marks
 * that server (by its API base) old for the session: no detail asks it again
 * until a reload, and `old` is true, so nothing is drawn, no error either. An
 * answer of neither shape is a failed read ("Not an answer of
 * /api/history"), asked again as any failed read is. The web, always served
 * by its own server, never meets an older one.
 *
 * Returns `{ body, range, error, busy, old }`: the last answer for this
 * target (null before the first), the range it is of, why the last read
 * failed (null once one answers), `busy` while a switched range is read, the
 * last range's answer still drawn, and `old`. Another target starts afresh,
 * so one entity's lines never show under another's name.
 */
import { useEffect, useState } from 'react';
import { NOT_MODIFIED_NO_BODY, getHistory } from '../../hooks/useData.js';
import { rangeOf, seriesFor } from '../historySeries.js';

const EMPTY = Object.freeze({ key: '', who: '', body: null, range: null, error: null });

/** The servers (by API base) whose /api/history predates #311, found this session. */
let serverIsOld = false;
const knownOld = () => serverIsOld;

/** Forget the servers found old (tests start each case afresh). */
export function forgetOldHistoryServers() {
  serverIsOld = false;
}

/** An answer of the route since #311 (server/promHistory.js) has its series. */
const isHistory = (body) => Array.isArray(body?.series);

/** The ring buffer's keys before #311 (history.js, refresh.js recordSamples). */
const RING_KEY = /^.+:(cpu|mem|disk)$/;

/** An answer of the route before #311: number lists by "<node>:<metric>", or none yet. */
const isRingBuffer = (body) =>
  body != null &&
  typeof body === 'object' &&
  !Array.isArray(body) &&
  Object.entries(body).every(([key, values]) => RING_KEY.test(key) && Array.isArray(values));

/** What a failed read says of an answer of neither shape. */
export const NOT_HISTORY = 'Not an answer of /api/history';

/**
 * @param {{ kind: string, entity: string } | null} target
 * @param {string} range  '1h', '24h' or '7d'
 * @param {{ subscribe: (listener: () => void) => () => void } | null | undefined} updated
 * @param {{ paused?: boolean }} [options]
 */
export function useHistory(target, range, updated, { paused = false } = {}) {
  const kind = target?.kind ?? null;
  const entity = target?.entity ?? null;
  // A node with drive data also reads its drives' temperatures (#728); one
  // without reads what it always did.
  const drives = Array.isArray(target?.drives) && target.drives.length > 0;
  const who = kind ? `${kind}|${entity}` : '';
  const key = who ? `${who}|${range}` : '';
  const [state, setState] = useState(EMPTY);

  useEffect(() => {
    if (!key || paused || knownOld()) return undefined;
    let live = true;
    let inflight = false;
    let lastAt = -Infinity;
    const series = seriesFor(kind, { drives }).join(',');
    const { stepMs } = rangeOf(range);
    const read = () => {
      if (inflight || knownOld()) return;
      inflight = true;
      lastAt = Date.now();
      const answered = (body) => body !== NOT_MODIFIED_NO_BODY && body != null;
      getHistory({ series, entity, range })
        .then((body) => {
          // Neither shape: a failed read, below.
          if (answered(body) && !isHistory(body) && !isRingBuffer(body)) {
            throw new Error(NOT_HISTORY);
          }
          return body;
        })
        .then(
          (body) => {
            if (!live) return;
            if (answered(body) && !isHistory(body)) {
              serverIsOld = true;
              setState({ ...EMPTY, key, who, range });
              return;
            }
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
  }, [key, who, kind, entity, drives, range, updated, paused]);

  if (!key || knownOld()) return { body: null, range, error: null, busy: false, old: knownOld() };
  if (state.who !== who) return { body: null, range, error: null, busy: false, old: false };
  if (state.key !== key) {
    return { body: state.body, range: state.range, error: null, busy: true, old: false };
  }
  return { body: state.body, range: state.range, error: state.error, busy: false, old: false };
}
