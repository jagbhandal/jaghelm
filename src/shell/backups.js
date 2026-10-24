/**
 * The Backups section (#675): when each backup last ran well, and the B2
 * bucket's size, read from /api/backups (server/backups.js) and drawn on the
 * Overview and the phone's. The server gives the times and the numbers; this
 * judges only the age, against the lines Settings → Nodes & Services keeps
 * (`backupAgeHours`, default amber after 36 h and red after 72 h).
 *
 * A row per marked backup job, by what it last reported to JagHelm:
 *  - never reported (or the cron store lost it): unknown, never green;
 *  - its last run failed: red, with the reporter's words and the last good run;
 *  - its last good run is older than the red line: red, but amber when the
 *    host is not known to be up (the NAS or MS-S1 may be off or asleep);
 *  - older than the amber line: amber; otherwise green.
 *
 * The B2 row is the bucket's size from the daily background read, with the
 * week's change and a sparkline once there is a week of history. It is amber
 * for a rejected key, hidden versions beyond HIDDEN_WARN (the old "keep all
 * versions" bloat), or a sample over two days old, and unknown before the first
 * one. Below it, per top-level folder, when data last arrived: shown as a
 * fact, not judged, since a folder that rarely changes is not a failing backup.
 * Nothing here alerts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { backupAgeLines } from '../../server/backupAgeLines.js';
import { agoText } from '../ui/lib/ago.js';
import { getBackups } from '../hooks/useData.js';

/** The jobs report daily; the server reads local files, so a poll is cheap. */
export const BACKUPS_POLL_MS = 5 * 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Hidden versions are amber from this many bytes AND this share of the live size. */
export const HIDDEN_WARN_BYTES = 10e9;
export const HIDDEN_WARN_SHARE = 0.1;
/** A B2 sample older than this is stale: the daily read has stopped working. */
export const B2_STALE_MS = 2 * DAY;

/** "210 GB", "3.4 GB", "820 MB", "0 B": decimal units, as Backblaze bills. */
export function bytesText(n) {
  const v = Math.abs(Number(n)) || 0;
  if (v >= 1e12) return `${(v / 1e12).toFixed(v >= 1e13 ? 0 : 1)} TB`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)} GB`;
  if (v >= 1e6) return `${Math.round(v / 1e6)} MB`;
  if (v >= 1e3) return `${Math.round(v / 1e3)} kB`;
  return `${Math.round(v)} B`;
}

const ago = (at, now) => agoText(now - at);

/** The state an age in hours is drawn in against the lines. */
export function ageState(hours, { warn, crit }) {
  if (hours >= crit) return 'crit';
  if (hours >= warn) return 'warn';
  return 'ok';
}

/** The word beside the lamp for an age's state. */
export const AGE_WORD = Object.freeze({ ok: 'OK', warn: 'Late', crit: 'Stale' });

/** One job's row: `{ id, name, where, state, word, detail, meta, muted }`. */
export function jobRow(job, lines, now) {
  const base = { id: `backup/${job.key}`, name: job.job, where: job.node };
  if (!job.seen || !job.last) {
    return {
      ...base,
      state: 'unknown',
      word: 'Unknown',
      detail: 'Nothing has reported yet',
      meta: null,
      muted: false,
    };
  }
  const good = job.lastGood == null ? null : ago(job.lastGood, now);
  if (job.last.status !== 'success') {
    return {
      ...base,
      state: 'crit',
      word: 'Failed',
      detail: `Failed ${ago(job.last.at, now)}${job.last.error ? `: ${job.last.error}` : ''}`,
      meta: good ? `last good ${good}` : `no good run in the last ${job.runs}`,
      muted: false,
    };
  }
  const ageH = (now - job.lastGood) / HOUR;
  const aged = ageState(ageH, lines);
  // An old report from a host that may simply be off is amber at most.
  const capped = aged === 'crit' && !job.hostUp;
  const state = capped ? 'warn' : aged;
  const note = capped ? ' · host not reachable now' : '';
  return {
    ...base,
    state,
    word: AGE_WORD[aged],
    detail: `Last good run ${good}${note}`,
    meta: null,
    muted: state === 'ok',
  };
}

/** The B2 part for the section, or null when it is not set up. */
export function b2View(b2, now) {
  if (!b2 || b2.configured !== true) return null;
  const name = typeof b2.bucket === 'string' ? b2.bucket : 'B2';
  const rejected = b2.error === 'key-rejected';
  if (typeof b2.liveBytes !== 'number') {
    return {
      kind: 'pending',
      name,
      state: rejected ? 'warn' : 'unknown',
      word: rejected ? 'Key rejected' : 'Waiting',
      detail: rejected
        ? 'B2 key rejected: check the read-only key in the environment'
        : b2.error
          ? 'The first check could not reach Backblaze yet'
          : 'Waiting for the first daily check',
    };
  }
  const live = b2.liveBytes;
  const hidden = typeof b2.hiddenBytes === 'number' ? b2.hiddenBytes : 0;
  const bloat = hidden >= HIDDEN_WARN_BYTES && hidden >= live * HIDDEN_WARN_SHARE;
  const stale = now - (b2.checkedAt ?? 0) > B2_STALE_MS;
  const change = typeof b2.weekChangeBytes === 'number' ? b2.weekChangeBytes : null;
  const changeText =
    change == null
      ? null
      : `${change < 0 ? '−' : '+'}${bytesText(change)} in 7 d`;
  const history = (Array.isArray(b2.history) ? b2.history : [])
    .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map(([time, value]) => ({ time, value }));
  const notes = [];
  if (changeText) notes.push(changeText);
  if (rejected) notes.push('B2 key rejected');
  else if (b2.error) notes.push('last check failed');
  if (stale) notes.push(`checked ${ago(b2.checkedAt, now)}`);
  const state = rejected || bloat || stale ? 'warn' : 'ok';
  return {
    kind: 'size',
    name,
    state,
    word: rejected ? 'Key rejected' : bloat ? 'Hidden versions' : stale ? 'Stale' : 'OK',
    size: bytesText(live),
    detail: [bytesText(live), ...notes].join(' · '),
    hidden: bloat
      ? { state: 'warn', text: `${bytesText(hidden)} hidden versions` }
      : hidden > 0
        ? { state: 'ok', text: `${bytesText(hidden)} in older versions` }
        : null,
    history,
    folders: (Array.isArray(b2.prefixes) ? b2.prefixes : [])
      .filter((p) => p && typeof p.name === 'string')
      .map((p) => ({
        name: p.name,
        size: bytesText(p.bytes),
        last: p.lastUpload > 0 ? `${ago(p.lastUpload, now)}` : 'no uploads',
      })),
  };
}

const WORST = ['crit', 'warn', 'unknown', 'ok'];

/**
 * What to draw for the server's answer: null (no section), or `{ rows, b2,
 * count, state }`. `config` is the display config (the lines).
 */
export function backupsView(body, config, now = Date.now()) {
  if (!body || typeof body !== 'object') return null;
  const jobs = Array.isArray(body.jobs) ? body.jobs.filter((j) => j && typeof j === 'object') : [];
  const lines = backupAgeLines(config?.backupAgeHours);
  const rows = jobs.map((j) => jobRow(j, lines, now));
  const b2 = b2View(body.b2, now);
  if (rows.length === 0 && !b2) return null;
  const states = [...rows.map((r) => r.state), b2?.state].filter(Boolean);
  const count = (s) => states.filter((x) => x === s).length;
  const bits = [`${rows.length} ${rows.length === 1 ? 'backup' : 'backups'}`];
  if (count('crit')) bits.push(`${count('crit')} failed or stale`);
  if (count('warn')) bits.push(`${count('warn')} late`);
  if (count('unknown')) bits.push(`${count('unknown')} unknown`);
  if (!count('crit') && !count('warn') && !count('unknown')) bits.push('all fresh');
  if (rows.length === 0) bits.splice(0, 1, 'B2 bucket');
  return {
    rows,
    b2,
    count: bits.join(' · '),
    state: WORST.find((s) => states.includes(s)) ?? 'ok',
  };
}

/**
 * /api/backups, read when `active` and again every `intervalMs` (not while the
 * browser tab is hidden): the answer, or null before the first one. A failed
 * request keeps the last answer.
 */
export function useBackups({ active = true, intervalMs = BACKUPS_POLL_MS } = {}) {
  const [body, setBody] = useState(null);
  const seq = useRef(0);
  const readAt = useRef(0);
  const read = useCallback(async () => {
    const mine = ++seq.current;
    readAt.current = Date.now();
    try {
      const next = await getBackups();
      if (mine === seq.current && next && typeof next === 'object') setBody(next);
    } catch {
      // Keep the last answer; the jobs report daily.
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
