/**
 * useStatus — the status model, as the shell's header reads it (#296): one
 * GET /api/status a refresh interval, with the last ETag (fetchJson), so a
 * steady board costs a 304, keeps the same object and re-renders nothing.
 * Nothing is asked while the browser tab is hidden; on return it asks at once.
 *
 * Returns `{ status, reach, updated }`:
 *
 *   status   the last status the server sent (docs/ARCHITECTURE.md §4.7), or
 *            null before the first; kept while the server can't be reached,
 *            so a page can still show what it last said
 *   reach    'loading' before the first answer; 'ok'; 'waiting' when the
 *            server has no status yet (a 503 before its first cycle, or a body
 *            without one); 'down' when it can't be reached (a network error,
 *            any other failure). Anything but 'ok' is "No signal" in the header.
 *   updated  when the last answer came (ms since the epoch), as a store
 *            (`get`, `subscribe`): each answer moves it, a 304 too, without
 *            re-rendering the caller, so only what shows it (UpdatedAgo)
 *            re-renders.
 *
 * @param {{ intervalMs: number, enabled?: boolean }} options
 */
import { useEffect, useRef, useState } from 'react';
import { getStatus, NOT_MODIFIED_NO_BODY } from './useData.js';
import { usePageVisible } from './usePageVisible.js';

/** Whether `body` is the status model's shape: what the header reads, at least. */
function isStatus(body) {
  return (
    body != null &&
    typeof body === 'object' &&
    body.overall != null &&
    typeof body.overall.state === 'string' &&
    Array.isArray(body.issues)
  );
}

/** A tiny store of one value, for useSyncExternalStore. */
function createStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    set(next) {
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStatus({ intervalMs, enabled = true }) {
  const [status, setStatus] = useState(null);
  const [reach, setReach] = useState('loading');
  const [updated] = useState(() => createStore(null));
  // What the caller last rendered, so an unchanged answer sets no state at all:
  // even an equal setState can run the caller once more.
  const shown = useRef({ status: null, reach: 'loading' });
  const polling = useRef(false);
  const inflight = useRef(false);
  const visible = usePageVisible();
  const on = enabled && visible;

  useEffect(() => {
    if (!on) {
      polling.current = false;
      return undefined;
    }
    // Asks at once when polling starts (mount, or back on screen); a new
    // interval only moves the next tick. An answer is applied whenever it
    // comes, so StrictMode's second run of this effect doesn't ask again.
    const starting = !polling.current;
    polling.current = true;
    const show = (next) => {
      const was = shown.current;
      if (next.status === was.status && next.reach === was.reach) return;
      shown.current = next;
      setStatus(next.status);
      setReach(next.reach);
    };
    const poll = async () => {
      // A slow answer isn't asked for twice; the next tick asks again.
      if (inflight.current) return;
      inflight.current = true;
      try {
        const body = await getStatus();
        if (body === NOT_MODIFIED_NO_BODY) {
          // Unchanged, and nothing held to show: the next answer brings it.
          updated.set(Date.now());
          return;
        }
        if (isStatus(body)) show({ status: body, reach: 'ok' });
        else show({ status: null, reach: 'waiting' });
        updated.set(Date.now());
      } catch (err) {
        const reachNow = /HTTP 503/.test(String(err?.message)) ? 'waiting' : 'down';
        show({ status: shown.current.status, reach: reachNow });
      } finally {
        inflight.current = false;
      }
    };
    if (starting) poll();
    const id = setInterval(poll, intervalMs);
    return () => clearInterval(id);
  }, [on, intervalMs, updated]);

  return { status, reach, updated };
}
