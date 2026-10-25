/**
 * The expiry tracker (#676): TLS certificates and Tailscale node keys, read by
 * the server (server/expiry.js, /api/expiry) and drawn on the Overview, the
 * phone's Overview and Settings. The server states facts (the days left, or
 * why there are none); the colours are judged here against the two lines
 * Settings keeps (`expiryDays`, `{ warn, crit }`; 21 and 7 days).
 *
 * What a row says (`expiryView`), always as an icon and words, never colour
 * alone:
 *  - a date: "N days left", amber (warning) under the first line and red
 *    (critical) under the second; "Expired N days ago" is critical;
 *  - no date: "Unreachable", "Handshake failed", "Refused by network setting"
 *    (JAGHELM_BLOCK_PRIVATE_NETWORKS), "Expiry unknown" or "Checking…". These
 *    are never green, and sort with the amber ones.
 *  A certificate that doesn't cover the typed name is amber ("certificate does not cover …") at best.
 *  Tailscale devices whose key never expires are one line, not rows; one whose key
 *  expired and that has not been seen for 30 days is a muted "offline since" line,
 *  out of the rows.  A key the
 *  API refuses, or an API that doesn't answer, is a notice above the rows.
 *  Nothing is drawn without a TLS target or a Tailscale key.
 *
 * It is read when the Overview (or the phone's, or Settings) shows it and
 * every EXPIRY_POLL_MS after (not while the tab is hidden), on a clock of its
 * own, outside the refresh tick (tickBudget.js); sooner while a new target is
 * still being checked.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { expiryLines } from '../../server/expiryTargets.js';
import { getExpiry } from '../hooks/useData.js';

/** Days move once a day and the server reads every 6 hours: a tab left open asks rarely. */
export const EXPIRY_POLL_MS = 30 * 60_000;
/** While a target is still "checking", the answer is asked again this soon (a few times). */
export const CHECKING_POLL_MS = 3_000;
const CHECKING_TRIES = 10;

export { expiryLines };

/** "12 days left", "1 day left", "Under 1 day left". */
export function daysLeftText(days) {
  if (days < 1) return 'Under 1 day left';
  return `${days} ${days === 1 ? 'day' : 'days'} left`;
}

const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;

const NO_DATE = {
  unreachable: ['Unreachable', "couldn't connect, so the expiry isn't known"],
  handshake_failed: ['Handshake failed', 'connected but no certificate came back, so the expiry isn\'t known'],
  blocked: ['Refused by network setting', 'the private-network setting refused this address, so it was not checked'],
  checking: ['Checking…', 'being checked now'],
  unknown: ['Expiry unknown', 'no usable end date was given'],
};

const RANK = { crit: 0, warn: 1, unknown: 1, checking: 2, ok: 3 };

/** A row's drawn state against the lines: `{ state, text, said }`. */
export function rowNote(item, lines) {
  if (item.state === 'expired') {
    const ago = Number.isFinite(item.daysLeft) ? Math.abs(item.daysLeft) : 0;
    const text = ago < 1 ? 'Expired today' : `Expired ${plural(ago, 'day')} ago`;
    return { state: 'crit', text, said: `${text}, critical` };
  }
  if (item.state === 'ok' && Number.isFinite(item.daysLeft)) {
    const state = item.daysLeft < lines.crit ? 'crit' : item.daysLeft < lines.warn ? 'warn' : 'ok';
    const days = daysLeftText(item.daysLeft);
    // A certificate for another name (a proxy's default) is never fine, whatever its date.
    if (item.mismatch === true) {
      const text = `${days}, certificate does not cover ${item.name}`;
      const out = state === 'crit' ? 'crit' : 'warn';
      return { state: out, text, said: `${text}, ${out === 'crit' ? 'critical' : 'warning'}` };
    }
    const word = state === 'crit' ? ', critical' : state === 'warn' ? ', warning' : '';
    return { state, text: days, said: `${days}${word}` };
  }
  const [text, why] = NO_DATE[item.state] ?? NO_DATE.unknown;
  return {
    state: item.state === 'checking' ? 'checking' : 'unknown',
    text,
    said: `${text}: ${why}`,
  };
}

const NOTICES = {
  rejected:
    'Tailscale key rejected. The API access token was refused or has expired (they last 90 days at most): make a new one and set it as JAGHELM_TAILSCALE_API_KEY.',
  unreachable: "Tailscale didn't answer, so its node keys aren't listed.",
  unreadable: 'Tailscale answered with something JagHelm could not read, so its node keys are not listed.',
};

/**
 * What to draw for the server's answer and the lines: null (no section), or
 * `{ rows, noExpiry, notices, offline, tracked }`. `rows` are `{ key, name, detail,
 * source, state, text, said }` worst first (red, then amber and unknown, then
 * checking, then fine; soonest first within each).
 */
export function expiryView(body, lines = expiryLines(null)) {
  if (!body || typeof body !== 'object' || body.configured !== true) return null;
  const items = (Array.isArray(body.items) ? body.items : []).filter(
    (i) => i && typeof i === 'object' && typeof i.name === 'string'
  );
  const rows = items
    .map((i, idx) => ({
      idx,
      days: Number.isFinite(i.daysLeft) ? i.daysLeft : Number.POSITIVE_INFINITY,
      row: {
        key: typeof i.id === 'string' ? i.id : `${idx}-${i.name}`,
        name: i.name,
        detail: typeof i.detail === 'string' ? i.detail : null,
        source: i.source === 'tailscale' ? 'Tailscale' : 'TLS',
        ...rowNote(i, lines),
      },
    }))
    .sort((a, b) => RANK[a.row.state] - RANK[b.row.state] || a.days - b.days || a.idx - b.idx)
    .map(({ row }) => row);
  const notices = [];
  const ts = body.tailscale;
  if (ts && ts.configured === true) {
    if (NOTICES[ts.state]) notices.push({ key: 'tailscale', text: NOTICES[ts.state] });
    else if (ts.stale === true) {
      notices.push({ key: 'tailscale', text: "Tailscale node keys: last known, Tailscale isn't answering." });
    }
  }
  const offline = (Array.isArray(body.offline) ? body.offline : [])
    .filter((o) => o && typeof o.name === 'string')
    .map((o, i) => ({
      key: `${i}-${o.name}`,
      text: `${o.name}: offline since ${typeof o.lastSeen === 'string' ? o.lastSeen.slice(0, 10) : 'a long time'}, key expired`,
    }));
  const ne = body.noExpiry;
  const noExpiry =
    ne && Number.isFinite(ne.count) && ne.count > 0
      ? {
          count: Math.floor(ne.count),
          names: (Array.isArray(ne.names) ? ne.names : []).filter((n) => typeof n === 'string'),
        }
      : null;
  return { rows, noExpiry, notices, offline, tracked: rows.length };
}

/**
 * /api/expiry, read when `active` and again every `intervalMs` (not while the
 * browser tab is hidden), and every few seconds while a target is still being
 * checked: `{ body, loaded }`, the body null before the first answer. A failed
 * request keeps the last answer.
 */
export function useExpiry({ active = true, intervalMs = EXPIRY_POLL_MS } = {}) {
  const [body, setBody] = useState(null);
  const seq = useRef(0);
  const readAt = useRef(0);
  const tries = useRef(0);
  const read = useCallback(async () => {
    const mine = ++seq.current;
    readAt.current = Date.now();
    try {
      const next = await getExpiry();
      if (mine === seq.current && next && typeof next === 'object') {
        setBody(next);
        const checking = Array.isArray(next.items) && next.items.some((i) => i?.state === 'checking');
        tries.current = checking ? tries.current + 1 : 0;
      }
    } catch {
      // Keep the last answer; days move once a day.
    }
  }, []);
  useEffect(() => {
    if (!active) return undefined;
    const wait = () => (tries.current > 0 && tries.current < CHECKING_TRIES ? CHECKING_POLL_MS : intervalMs);
    const due = () => !document.hidden && Date.now() - readAt.current >= wait();
    if (Date.now() - readAt.current >= intervalMs) read();
    const id = setInterval(() => due() && read(), Math.min(CHECKING_POLL_MS, intervalMs));
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
