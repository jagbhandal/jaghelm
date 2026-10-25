/**
 * Config drift (#674): what the hosts' pushed drift reports (server/driftStore.js,
 * /api/drift) are drawn as on the Overview and the phone's. The server stores
 * the latest report per host and the time it received it; this judges them,
 * with the stale-hours setting (`driftStaleHours`, default 36).
 *
 * The row's state:
 *  - none     reports never arrived: grey "No reports", never green;
 *  - drift    any host's latest report says drift: amber;
 *  - error    any host's check could not run or read a file: amber;
 *  - unknown  no host says drift or error but ANY host's report is older than
 *             the setting (its timer died, or the host is off): amber, never
 *             green, naming the host and its age;
 *  - ok       every host's report is ok and fresh: green.
 * Hosts come from the store, one cron job each, so one silent host must show.
 * A host's entry is dropped after DRIFT_PRUNE_DAYS (server), so a removed host
 * is Unknown for that long and then gone.
 * Age is the server's receive time against the server's clock, not the
 * host's. Nothing here sends an alert.
 *
 * Read when the Overview draws it and every DRIFT_POLL_MS after (not while the
 * tab is hidden), on a clock of its own, outside the refresh tick.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDrift } from '../hooks/useData.js';
import { staleHours } from '../../server/driftReports.js';

export const DRIFT_POLL_MS = 5 * 60_000;

const HOUR = 3_600_000;
const STATUS_WORDS = { ok: 'No drift', drift: 'Drift', error: 'Check failed' };

/** "12 min ago", "5 h ago", "3 days ago". */
export function ageText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  if (ms < 90_000) return 'just now';
  if (ms < 90 * 60_000) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < 48 * HOUR) return `${Math.round(ms / HOUR)} h ago`;
  return `${Math.round(ms / (24 * HOUR))} days ago`;
}

const names = (hosts) => hosts.map((h) => h.host).join(', ');

/**
 * What to draw for the server's answer, or null (no row: the feature is off, or
 * nothing was read yet). `nowMs` is the server's clock, moved on to now.
 *
 * @returns {null | { state: 'none'|'ok'|'drift'|'error'|'unknown', label: string, detail: string, hosts: object[] }}
 */
export function driftView(body, config, nowMs) {
  if (!body || typeof body !== 'object' || body.configured !== true) return null;
  const limit = staleHours(config?.driftStaleHours) * HOUR;
  const hosts = (Array.isArray(body.reports) ? body.reports : [])
    .filter((r) => r && typeof r === 'object' && typeof r.host === 'string')
    .map((r) => {
      const received = Date.parse(r.receivedAt);
      const age = Number.isFinite(received) ? Math.max(0, nowMs - received) : Infinity;
      const status = r.status in STATUS_WORDS ? r.status : 'error';
      return {
        host: r.host,
        status,
        word: STATUS_WORDS[status],
        items: (Array.isArray(r.items) ? r.items : []).filter((i) => i && typeof i === 'object'),
        age,
        ageText: Number.isFinite(age) ? ageText(age) : 'unknown time',
        checkedAt: typeof r.checkedAt === 'string' ? r.checkedAt : null,
        old: age > limit,
      };
    });
  if (hosts.length === 0) {
    return { state: 'none', label: 'No reports', detail: 'No host has sent a drift report yet.', hosts };
  }
  const drifted = hosts.filter((h) => h.status === 'drift');
  const failed = hosts.filter((h) => h.status === 'error');
  if (drifted.length) {
    return { state: 'drift', label: 'Drift', detail: `Drift on ${names(drifted)}`, hosts };
  }
  if (failed.length) {
    return { state: 'error', label: 'Check failed', detail: `Check failed on ${names(failed)}`, hosts };
  }
  const silent = hosts.filter((h) => h.old);
  if (silent.length) {
    const detail = silent.map((h) => `${h.host}: last report ${h.ageText}`).join('; ');
    return { state: 'unknown', label: 'Unknown', detail, hosts };
  }
  return { state: 'ok', label: 'No drift', detail: `${hosts.length} ${hosts.length === 1 ? 'host' : 'hosts'} reporting`, hosts };
}

/**
 * /api/drift, read when `active` and again every `intervalMs` (not while the
 * tab is hidden): `{ body, nowMs }`, nowMs the server's clock moved on to now,
 * or null before the first answer. A failed request keeps the last answer.
 */
export function useDrift({ active = true, intervalMs = DRIFT_POLL_MS } = {}) {
  const [got, setGot] = useState(null);
  const seq = useRef(0);
  const readAt = useRef(0);
  const read = useCallback(async () => {
    const mine = ++seq.current;
    readAt.current = Date.now();
    try {
      const body = await getDrift(true);
      if (mine === seq.current && body && typeof body === 'object') {
        setGot({ body, serverNow: Date.parse(body.now), localAt: Date.now() });
      }
    } catch {
      // Keep the last answer; the reports move over hours.
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
  return got;
}
