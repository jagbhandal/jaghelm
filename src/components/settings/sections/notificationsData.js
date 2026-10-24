/**
 * Settings → Notifications' data (#320): the threshold lines it edits (GET
 * and PUT /api/thresholds, saved over the version read) and the phones push
 * sends to (GET /api/push/devices, DELETE /api/push/devices/:id, POST
 * /api/push/test), read when the section opens. The server checks a table and
 * says why it refuses one; the page checks the same things first (draftErrors,
 * from the bounds the server gives each row), so every row's problem shows at
 * once.
 *
 * While a test push is on its way, the phones are read again every 2 seconds,
 * for at most a minute, until each phone's outcome is known. The read-only
 * demo sends nothing: the section says so.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, isReadOnlyServer } from '../../../api/client.js';

export const THRESHOLDS_URL = '/api/thresholds';
export const DEVICES_URL = '/api/push/devices';
export const TEST_URL = '/api/push/test';

/** How often the phones are read again while a test push is on its way, and for how long. */
export const TEST_POLL_MS = 2000;
export const TEST_POLL_FOR_MS = 60_000;

/** Each metric's name and what it covers, in the editor's words. */
export const METRIC_WORDS = Object.freeze({
  cpu: { label: 'CPU', hint: 'Warns after 2 refreshes in a row at or over its line' },
  mem: { label: 'Memory', hint: 'Used memory' },
  disk: { label: 'Disk', hint: 'A node’s disk, and each Proxmox storage pool' },
  temp: { label: 'Temperature', hint: 'The node’s hottest sensor, in °C' },
});

/** A line as a field shows it: "90", "87.5"; '' for none. */
const text = (n) => (n == null ? '' : String(n));

/** The fields' text for each row, from the lines (GET's rows, or their defaults). */
export function draftOf(rows, { defaults = false } = {}) {
  return Object.fromEntries(
    rows.map((r) => {
      const lines = defaults ? r.defaults : r;
      return [r.metric, { warn: text(lines.warn), crit: r.crit == null ? null : text(lines.crit) }];
    })
  );
}

/** Whether two drafts hold the same text. */
export function sameDraft(a, b) {
  return Object.keys(a).every((k) => a[k].warn === b[k]?.warn && a[k].crit === b[k]?.crit);
}

/** A field's text as a number, or NaN ("90", " 87.5 ", "87,5" are numbers). */
const numberOf = (s) =>
  /^\s*\d+(?:[.,]\d+)?\s*$/.test(s) ? Number(s.trim().replace(',', '.')) : NaN;

/**
 * Each row's problem, by metric, as the server would say it (it checks the
 * same: a number, in the row's range, a warning line under its critical one).
 */
export function draftErrors(rows, draft) {
  const out = {};
  for (const r of rows) {
    const d = draft[r.metric];
    if (!d) continue;
    const range = `from ${r.min} to ${r.max} ${r.unit}`;
    const warn = numberOf(d.warn);
    const crit = d.crit == null ? null : numberOf(d.crit);
    if (Number.isNaN(warn)) out[r.metric] = `The warning line must be a number, ${range}`;
    else if (warn < r.min || warn > r.max) out[r.metric] = `The warning line must be ${range}`;
    else if (crit != null && Number.isNaN(crit))
      out[r.metric] = `The critical line must be a number, ${range}`;
    else if (crit != null && (crit < r.min || crit > r.max))
      out[r.metric] = `The critical line must be ${range}`;
    else if (crit != null && warn >= crit)
      out[r.metric] =
        `The warning line (${warn} ${r.unit}) must be under the critical line (${crit} ${r.unit})`;
  }
  return out;
}

/**
 * What PUT /api/thresholds is sent for a draft: each metric's lines with its
 * unit, or null where they are its defaults.
 */
export function tableOf(rows, draft) {
  return Object.fromEntries(
    rows.map((r) => {
      const d = draft[r.metric];
      const warn = numberOf(d.warn);
      const crit = d.crit == null ? undefined : numberOf(d.crit);
      const isDefault = warn === r.defaults.warn && (crit ?? null) === r.defaults.crit;
      if (isDefault) return [r.metric, null];
      return [r.metric, { warn, ...(crit !== undefined ? { crit } : {}), unit: r.unit }];
    })
  );
}

/** The server's words for a refusal, else a sentence with its status. */
async function reasonOf(r, what) {
  const body = await r.json().catch(() => null);
  return {
    body,
    reason: typeof body?.error === 'string' ? body.error : `${what} (HTTP ${r.status})`,
  };
}

/**
 * The threshold lines: `{ rows, loading, error, version, readOnly, reload,
 * save(table) }`. `save` answers `{ ok: true }`, or `{ error, metric? }`
 * (the server's 400, or why it couldn't save), or `{ conflict: true }` after
 * a 409 (the rows are read again).
 */
export function useThresholds() {
  const [state, setState] = useState({ rows: null, loading: true, error: null, version: null });
  const readOnly = isReadOnlyServer();

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const r = await apiFetch(THRESHOLDS_URL, { cache: 'no-store' });
      const version = r.headers.get('ETag');
      if (r.ok) {
        const body = await r.json();
        if (!Array.isArray(body?.thresholds)) throw new Error('no thresholds in the answer');
        setState({ rows: body.thresholds, loading: false, error: null, version });
        return;
      }
      const { reason } = await reasonOf(r, "Couldn't read the thresholds");
      setState({ rows: null, loading: false, error: reason, version });
    } catch {
      setState({
        rows: null,
        loading: false,
        error: "Couldn't reach JagHelm to read the thresholds",
        version: null,
      });
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const save = useCallback(
    async (table) => {
      if (readOnly) return { error: 'This is a read-only demo: nothing is saved' };
      let r;
      try {
        r = await apiFetch(THRESHOLDS_URL, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(state.version ? { 'If-Match': state.version } : {}),
          },
          body: JSON.stringify(table),
        });
      } catch {
        return { error: "Couldn't reach JagHelm: nothing was saved" };
      }
      if (r.ok) {
        const body = await r.json();
        setState({
          rows: body.thresholds,
          loading: false,
          error: null,
          version: r.headers.get('ETag'),
        });
        return { ok: true };
      }
      if (r.status === 409 || r.status === 428) {
        await reload();
        return { conflict: true };
      }
      const { body, reason } = await reasonOf(r, "Couldn't save the thresholds");
      return {
        error: reason,
        ...(typeof body?.metric === 'string' ? { metric: body.metric } : {}),
      };
    },
    [readOnly, reload, state.version]
  );

  return { ...state, readOnly, reload, save };
}

/**
 * The phones: `{ data, loading, error, busy, notice, readOnly, now, reload,
 * remove(id), test(id | null) }`. `data` is GET /api/push/devices' answer.
 * A test push reads the phones again until its outcome is known (above).
 */
export function usePushDevices() {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const poll = useRef(null);
  const readOnly = isReadOnlyServer();

  const reload = useCallback(async () => {
    try {
      const r = await apiFetch(DEVICES_URL, { cache: 'no-store' });
      if (!r.ok) {
        const { reason } = await reasonOf(r, "Couldn't read the phones");
        setState({ data: null, loading: false, error: reason });
        return null;
      }
      const data = await r.json();
      setState({ data, loading: false, error: null });
      setNow(Date.now());
      return data;
    } catch {
      setState((s) => ({
        ...s,
        loading: false,
        error: "Couldn't reach JagHelm to read the phones",
      }));
      return null;
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (poll.current) clearTimeout(poll.current.timer);
    poll.current = null;
    setBusy(false);
  }, []);

  useEffect(() => {
    reload();
    return () => {
      if (poll.current) clearTimeout(poll.current.timer);
      poll.current = null;
    };
  }, [reload]);

  const follow = useCallback(
    (until) => {
      const step = async () => {
        if (!poll.current) return;
        const data = await reload();
        if (!poll.current) return;
        if (!data?.test || data.test.done || Date.now() >= until) {
          stopPolling();
          return;
        }
        poll.current.timer = setTimeout(step, TEST_POLL_MS);
      };
      poll.current = { timer: setTimeout(step, TEST_POLL_MS) };
    },
    [reload, stopPolling]
  );

  const test = useCallback(
    async (device) => {
      if (readOnly) return;
      setNotice(null);
      setBusy(true);
      let r;
      try {
        r = await apiFetch(TEST_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(device ? { device } : {}),
        });
      } catch {
        setBusy(false);
        setNotice({ tone: 'error', text: "Couldn't reach JagHelm: no test push was sent" });
        return;
      }
      if (r.status === 202) {
        const testView = await r.json();
        setState((s) => (s.data ? { ...s, data: { ...s.data, test: testView } } : s));
        if (testView.done) setBusy(false);
        else follow(Date.now() + TEST_POLL_FOR_MS);
        return;
      }
      setBusy(false);
      const { reason } = await reasonOf(r, "Couldn't send a test push");
      setNotice({ tone: r.status === 429 ? 'info' : 'error', text: reason });
      if (r.status === 404) reload();
    },
    [follow, readOnly, reload]
  );

  const remove = useCallback(
    async (id) => {
      if (readOnly) return;
      setNotice(null);
      try {
        const r = await apiFetch(`${DEVICES_URL}/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!r.ok && r.status !== 404) {
          const { reason } = await reasonOf(r, "Couldn't remove the phone");
          setNotice({ tone: 'error', text: reason });
        }
      } catch {
        setNotice({ tone: 'error', text: "Couldn't reach JagHelm: the phone wasn't removed" });
      }
      reload();
    },
    [readOnly, reload]
  );

  return { ...state, busy, notice, readOnly, now, reload, remove, test };
}
