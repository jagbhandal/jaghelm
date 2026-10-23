/**
 * useConfigPersistence — owns the display-config save/load machinery that used
 * to live inline in AppMain. Three effects, in this order:
 *   1. Save config: localStorage immediately, server debounced (2s).
 *   2. Flush a pending (debounced-but-unsent) server save on tab hide / unload.
 *   3. Load config from server on mount (authoritative source).
 *
 * A save goes out only over the version this device read (#547): the read's
 * ETag, sent back as If-Match, which each accepted save moves on. Saves go
 * out one at a time, in order, each with the version the one before it
 * answered, and each sends the config as it is when it goes, so edits made
 * meanwhile ride along. A config equal to the server's copy is not sent.
 *
 * A save refused because the server's copy changed since (409, another device
 * saved; or 428, this device has no version, its read having failed) is
 * rebased, not dropped: a switch flipped saves on its own, so dropping it
 * would silently undo what the user just did. The server's copy is read
 * again, and only the leaves this device changed since the copy it read are
 * laid over it (src/utils/rebaseConfig.js); that is shown, kept in
 * localStorage and saved once, over the new version, with a quiet "Merged
 * with changes from another device". Refused again, the server's copy is
 * taken as it is, with "Settings changed on another device; reloaded".
 *
 * Only a copy is ever shown or laid changes over: an object with its version.
 * No file (null) or one that doesn't parse (a 503 `config_unparseable` with
 * the file's version) has none, so this device keeps its own config and its
 * next save sends the whole of it over that version, which rewrites the file.
 * A file the server can't read (503 `config_unreadable`) leaves this device's
 * config as it is, and says why.
 *
 * localStorage keeps, beside this device's config, the copy it descends from
 * and that copy's version (`jaghelm-config-base`). An edit whose save never
 * landed (the tab closed first, or its save was refused as it closed) is
 * still there at the next load: what differs from that copy is laid over the
 * server's copy then, and saved. The unload flush is only a head start.
 *
 * Every copy is read without the keys an older build saved for a custom
 * group that nothing reads (#517, dropDeadGroupKeys in
 * src/shell/customGroups.js): the server's at load and at a rebase, the one
 * kept in localStorage, and this device's own at a load or a rebase, and each
 * save goes without them. Dropping one is never an edit of this device's: a
 * load alone sends nothing, and a rebase can't lay a group list without them
 * over another device's group edit. The server's copy loses them at the next
 * save made for something else.
 *
 * Refs that the old AppMain held (configLoadedFromServer / saveTimerRef /
 * pendingConfigRef / savePendingRef) are now internal to this hook.
 *
 * @param {object}   config    the live display config (state value from App)
 * @param {function} setConfig the raw useState setter from App
 * @param {function} setTheme  the theme setter (server load may seed it)
 * @param {function} toast     useToast()'s notifier (surface save failures)
 * @param {{ readOnly?: boolean, onLoaded?: () => void }} [options]
 *   readOnly: the server refuses writes (the public demo, #248). Changes are
 *   kept in this browser (localStorage) and never sent, so nothing fails and
 *   no "couldn't save" toast shows. Its config needs no version.
 *   onLoaded: called once the mount load is over, whether the server had a
 *   config, had none or failed (the shell waits for it before calling an app
 *   unknown, #296).
 * @returns {object | null} the config the server has: what the mount load
 *   read, then each save once the server accepts it (or the copy a refused
 *   save read again); null before the load, or when the server has none. The
 *   embed check (#269) asks the server only about a URL it has saved.
 */

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { rebaseConfig, sameConfig } from '../utils/rebaseConfig.js';
import { dropDeadGroupKeys } from '../shell/customGroups.js';

const DISPLAY_CONFIG_URL = '/api/display-config';
/** Where this device's config is kept, and the copy it descends from. */
const CONFIG_KEY = 'jaghelm-config';
const BASE_KEY = 'jaghelm-config-base';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The config as JSON carries it (an undefined value is no setting), without a
 * custom group's dead keys (see the top).
 */
const asJson = (config) => dropDeadGroupKeys(JSON.parse(JSON.stringify(config ?? {})));

/** A refusal a fresh read can mend: another device saved first (409), or no version was sent (428). */
const refusedAsStale = (r) => r.status === 409 || r.status === 428;

/**
 * A display-config read's answer: `{ config, version }`, the server's copy;
 * or `{ config: null, version }` for no file (null) or one that doesn't parse
 * (503 `config_unparseable`), which have a version but no copy. Anything else
 * throws, with the server's `reason` when it gives one (a file it can't
 * read). A copy without a version is refused unless `needVersion` is false
 * (a read-only server, which is never saved to).
 */
async function readAnswer(r, needVersion = true) {
  const version = r.headers.get('ETag');
  const body = await r.json().catch(() => undefined);
  if (r.ok && isObject(body) && (version || !needVersion)) {
    return { config: dropDeadGroupKeys(body), version };
  }
  const noCopy =
    (r.ok && body === null) || (r.status === 503 && body?.code === 'config_unparseable');
  if (version && noCopy) return { config: null, version };
  const err = new Error(`read failed (${r.status})`);
  if (typeof body?.error === 'string') err.reason = body.error;
  throw err;
}

/** The server's copy and its version, read past any cached answer. */
async function readServerCopy() {
  return readAnswer(await apiFetch(DISPLAY_CONFIG_URL, { cache: 'no-store' }));
}

/** A refused or failed save as an error, with the server's reason for a 503. */
async function saveFailure(r) {
  const body = await r.json().catch(() => null);
  const err = new Error(`save failed (${r.status})`);
  if (r.status === 503 && typeof body?.error === 'string') err.reason = body.error;
  return err;
}

/**
 * The copy this browser's config descended from when it was last open, and
 * its version, or null: none kept, or no config kept beside it.
 */
function readStoredBase() {
  try {
    if (localStorage.getItem(CONFIG_KEY) == null) return null;
    const base = JSON.parse(localStorage.getItem(BASE_KEY) ?? 'null');
    if (!isObject(base) || !isObject(base.config)) return null;
    return {
      config: dropDeadGroupKeys(base.config),
      version: typeof base.version === 'string' ? base.version : null,
    };
  } catch {
    return null;
  }
}

export function useConfigPersistence(
  config,
  setConfig,
  setTheme,
  toast,
  { readOnly = false, onLoaded } = {}
) {
  const configLoadedFromServer = useRef(false);
  const saveTimerRef = useRef(null);
  // Latest config + whether a debounced server save is still pending, so the
  // flush-on-unload handler can write the most recent edit synchronously.
  const pendingConfigRef = useRef(config);
  const savePendingRef = useRef(false);
  // The server's copy this device's config descends from (#547): what it last
  // read or saved, and that copy's version (the ETag), which the next save
  // sends as If-Match. Null config: no copy (no file, or one that doesn't
  // parse), so the next save sends the whole config.
  const baseRef = useRef({ config: null, version: null });
  // The base kept from this browser's last visit, read before effect 1 writes.
  const storedBaseRef = useRef(undefined);
  if (storedBaseRef.current === undefined)
    storedBaseRef.current = readOnly ? null : readStoredBase();
  // Saves go out one at a time, in order.
  const queueRef = useRef(Promise.resolve());
  const [savedConfig, setSavedConfig] = useState(null);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  /**
   * Make `base` the copy this device descends from, here and in localStorage;
   * with `shown`, the config shown from now on, kept beside it in the same
   * step, so the pair a later load compares never mixes two copies.
   */
  const setBase = (base, shown) => {
    baseRef.current = base;
    if (readOnly) return;
    try {
      localStorage.setItem(BASE_KEY, JSON.stringify(base));
      if (shown) localStorage.setItem(CONFIG_KEY, JSON.stringify(shown));
    } catch {
      // A full or blocked storage keeps the base for this visit only.
    }
  };

  /** POST `body` over `version` (none: no If-Match). */
  const post = (body, version, keepalive) => {
    const headers = { 'Content-Type': 'application/json' };
    if (version) headers['If-Match'] = version;
    // keepalive so a save that fires just before an unload still completes.
    return apiFetch(DISPLAY_CONFIG_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      keepalive,
    });
  };

  /** The server took `body`: it is the new base, at the version the answer names. */
  const accepted = (body, r) => {
    setBase({ config: body, version: r.headers.get('ETag') });
    setSavedConfig(body);
  };

  // Refused again after a rebase: the server's copy as it is, nothing laid
  // over it. With no copy to take, this device keeps its own.
  const takeServerCopy = async () => {
    const latest = await readServerCopy();
    setBase(latest, latest.config);
    if (!latest.config) throw new Error('refused twice');
    setSavedConfig(latest.config);
    setConfig(latest.config);
    toastRef.current('Settings changed on another device; reloaded', 'error');
  };

  // Send the config as it is now, if it differs from the server's copy; on a
  // refusal a fresh read can mend, rebase once (see the top of this file).
  const saveNow = async (keepalive) => {
    const base = baseRef.current;
    const sent = asJson(pendingConfigRef.current);
    if (base.config && sameConfig(sent, base.config)) return;
    const first = await post(sent, base.version, keepalive);
    if (first.ok) return accepted(sent, first);
    if (!refusedAsStale(first)) throw await saveFailure(first);

    // Another device saved since this one read (or this one read nothing).
    const fresh = await readServerCopy();
    if (!fresh.config) {
      // No file now, or one that doesn't parse: nothing to lay this device's
      // changes over, so the whole of its config goes over that version.
      setBase(fresh);
      const whole = asJson(pendingConfigRef.current);
      const again = await post(whole, fresh.version, keepalive);
      if (again.ok) return accepted(whole, again);
      if (!refusedAsStale(again)) throw await saveFailure(again);
      return takeServerCopy();
    }
    // This device's changes since its copy, over the server's copy now.
    const from = base.config ?? sent;
    const shown = pendingConfigRef.current;
    const merged = rebaseConfig(from, asJson(shown), fresh.config);
    setBase(fresh, merged);
    setSavedConfig(fresh.config);
    // Shown and kept in localStorage (effect 1). An edit the screen has that
    // the ref doesn't yet is rebased too, and goes out with the next save.
    setConfig((prev) => (prev === shown ? merged : rebaseConfig(from, asJson(prev), fresh.config)));
    const second = await post(merged, fresh.version, keepalive);
    if (second.ok) {
      accepted(merged, second);
      toastRef.current('Merged with changes from another device', 'info');
      return;
    }
    if (!refusedAsStale(second)) throw await saveFailure(second);
    return takeServerCopy();
  };

  const queueSave = (keepalive) => {
    queueRef.current = queueRef.current
      .then(() => saveNow(keepalive))
      .catch((err) => {
        // The debounced effect re-arms on the next edit, and localStorage
        // already holds the value — surface the failure so the user knows
        // their settings aren't yet persisted server-side. A file the server
        // can't read says so.
        toastRef.current(
          err?.reason ? `Not saved: ${err.reason}` : "Couldn't save settings — will retry",
          'error'
        );
      });
  };
  const queueSaveRef = useRef(queueSave);
  queueSaveRef.current = queueSave;

  // Save config: localStorage immediately, server debounced
  useEffect(() => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    // Keep the latest config available to the save and the unload flush.
    pendingConfigRef.current = config;
    // Don't save to server until we've loaded from server first (prevents overwriting server config with defaults)
    if (!configLoadedFromServer.current) return;
    // Nothing is sent to a read-only server, so the unload flush has nothing owed either.
    if (readOnly) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    // From here a server write is owed; the flush handler may send it early.
    savePendingRef.current = true;
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      savePendingRef.current = false;
      queueSaveRef.current(true);
    }, 2000);
  }, [config, readOnly]);

  // Flush a pending (debounced-but-unsent) server save immediately when the tab
  // is hidden or about to unload, so other devices see an edit made <2s before
  // the user closes/navigates. A keepalive fetch lets the request outlive the
  // page and, unlike sendBeacon, carries the If-Match (and the x-auth-token
  // header on authed instances). It goes behind a save still on its way. One
  // that doesn't land is not lost: the next load saves it (see the top).
  useEffect(() => {
    const flushSave = () => {
      if (!savePendingRef.current) return;
      // Cancel the debounce and consume the pending state so we send exactly once.
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      savePendingRef.current = false;
      queueSaveRef.current(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushSave();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', flushSave);
    window.addEventListener('pagehide', flushSave);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', flushSave);
      window.removeEventListener('pagehide', flushSave);
    };
  }, []);

  // Load config from server on mount (authoritative source)
  // Exception: gridLayout is preserved from localStorage if it exists,
  // because the local layout is always the most recent user arrangement.
  // The server layout may be stale from a previous deploy or compactor bug.
  useEffect(() => {
    const stored = storedBaseRef.current;
    const loaded = () => {
      configLoadedFromServer.current = true;
      onLoadedRef.current?.();
    };
    apiFetch(DISPLAY_CONFIG_URL)
      .then((r) => readAnswer(r, !readOnly))
      .then((copy) => {
        setBase(copy);
        const data = copy.config;
        if (!data || Object.keys(data).length === 0) {
          // No file, one that doesn't parse, or an empty copy: this device
          // keeps its config, and an edit kept from its last visit goes now
          // (the whole config, when there is no copy).
          const pending = stored && !sameConfig(asJson(pendingConfigRef.current), stored.config);
          loaded();
          if (pending) queueSaveRef.current(false);
          return;
        }
        setSavedConfig(data);
        setConfig((prev) => {
          // An edit kept from this browser's last visit that never reached
          // the server (#547), laid over the server's copy; the save it
          // starts (effect 1) sends it.
          const merged = stored ? rebaseConfig(stored.config, asJson(prev), data) : { ...data };
          // localStorage layout is authoritative — server may be stale from a previous deploy
          if (prev.gridLayout) {
            merged.gridLayout = prev.gridLayout;
          }
          localStorage.setItem(CONFIG_KEY, JSON.stringify(merged));
          if (data.theme && !localStorage.getItem('jaghelm-theme')) setTheme(data.theme);
          return merged;
        });
        loaded();
      })
      .catch((err) => {
        // No copy read: the one kept from the last visit stands for it, or
        // else this device's config as it is now, so a later save that has to
        // be rebased re-applies only the edits made since (#547).
        setBase(stored ?? { config: asJson(pendingConfigRef.current), version: null });
        if (err?.reason)
          toastRef.current(`Couldn't read the display settings: ${err.reason}`, 'error');
        loaded();
      });
  }, []);

  return savedConfig;
}
