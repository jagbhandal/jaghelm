/**
 * The pending host steps (#673): the unticked rows of homelab-infra #848, read
 * by the server (server/hostActions.js, /api/host-actions) and drawn on the
 * Overview and the phone's. The client judges nothing: it counts and links
 * what the server lists.
 *
 * What is drawn (`hostActionsView`):
 *  - nothing: no Gitea set up (`configured: false`), the list not read yet, or
 *    no step open. Zero is quiet, not "0 pending";
 *  - a list: "Pending host steps" with the count, a row per step (its
 *    reference and a few words, linking to the PR or issue in Gitea), and "+ N
 *    more" past the rows the server lists, with the link to #848;
 *  - the list couldn't be read or understood (`ok: false`): one quiet row
 *    linking to #848, never an error and never a count.
 *
 * It is read when the Overview or the phone's Overview draws it and every
 * HOST_ACTIONS_POLL_MS after (not while the browser tab is hidden), on a clock
 * of its own, outside the refresh tick (tickBudget.js).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getHostActions } from '../hooks/useData.js';
import { safeUrl } from '../utils/safeUrl.js';

/** Gitea's list changes a few times a week; the server keeps one answer 5 minutes. */
export const HOST_ACTIONS_POLL_MS = 5 * 60_000;

/**
 * What to draw for the server's answer: null (no tile), `{ kind: 'unreadable',
 * href }`, or `{ kind: 'list', count, rows, more, href, stale }`.
 */
export function hostActionsView(body) {
  if (!body || typeof body !== 'object' || body.configured !== true) return null;
  const href = safeUrl(body.href);
  if (body.ok !== true) {
    return { kind: 'unreadable', href };
  }
  const count = Number.isFinite(body.count) ? Math.max(0, Math.floor(body.count)) : 0;
  if (count === 0) return null;
  const rows = (Array.isArray(body.items) ? body.items : [])
    .filter((r) => r && typeof r === 'object')
    .map((r, i) => ({
      key: `${i}-${r.ref ?? ''}`,
      ref: typeof r.ref === 'string' ? r.ref : null,
      title: typeof r.title === 'string' ? r.title : '',
      href: safeUrl(r.href) ?? href,
    }));
  const more = Math.max(0, count - rows.length);
  const stale = body.stale === true;
  return {
    kind: 'list',
    count,
    rows,
    more,
    href,
    stale,
  };
}

/**
 * /api/host-actions, read when `active` and again every `intervalMs` (not
 * while the browser tab is hidden; on return, if one is due): the answer, or
 * null before the first one. A failed request keeps the last answer.
 */
export function useHostActions({ active = true, intervalMs = HOST_ACTIONS_POLL_MS } = {}) {
  const [body, setBody] = useState(null);
  const seq = useRef(0);
  const readAt = useRef(0);
  const read = useCallback(async () => {
    const mine = ++seq.current;
    readAt.current = Date.now();
    try {
      const next = await getHostActions();
      if (mine === seq.current && next && typeof next === 'object') setBody(next);
    } catch {
      // Keep the last answer; the list moves over days.
    }
  }, []);
  useEffect(() => {
    if (!active) return undefined;
    const due = () => !document.hidden && Date.now() - readAt.current >= intervalMs;
    if (Date.now() - readAt.current >= intervalMs) read();
    const id = setInterval(() => due() && read(), Math.min(intervalMs, 60_000));
    const onShow = () => due() && read();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onShow);
      seq.current += 1;
    };
  }, [active, intervalMs, read]);
  return body;
}
