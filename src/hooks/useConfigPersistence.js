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
 *   no "couldn't save" toast shows.
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

const DISPLAY_CONFIG_URL = '/api/display-config';

/** The config as JSON carries it (an undefined value is no setting). */
const asJson = (config) => JSON.parse(JSON.stringify(config ?? {}));

/** A refusal a fresh read can mend: another device saved first (409), or no version was sent (428). */
const refusedAsStale = (r) => r.status === 409 || r.status === 428;

/** The server's copy and its version, read past any cached answer. */
async function readServerCopy() {
  const r = await apiFetch(DISPLAY_CONFIG_URL, { cache: 'no-store' });
  if (!r.ok) throw new Error(`read failed (${r.status})`);
  const data = await r.json();
  return { config: data && typeof data === 'object' ? data : {}, version: r.headers.get('ETag') };
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
  // sends as If-Match. Null config: not read yet.
  const baseRef = useRef({ config: null, version: null });
  // Saves go out one at a time, in order.
  const queueRef = useRef(Promise.resolve());
  const [savedConfig, setSavedConfig] = useState(null);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const toastRef = useRef(toast);
  toastRef.current = toast;

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
    baseRef.current = { config: body, version: r.headers.get('ETag') };
    setSavedConfig(body);
  };

  // Send the config as it is now, if it differs from the server's copy; on a
  // refusal a fresh read can mend, rebase once (see the top of this file).
  const saveNow = async (keepalive) => {
    const base = baseRef.current;
    const sent = asJson(pendingConfigRef.current);
    if (base.config && sameConfig(sent, base.config)) return;
    const first = await post(sent, base.version, keepalive);
    if (first.ok) return accepted(sent, first);
    if (!refusedAsStale(first)) throw new Error(`save failed (${first.status})`);

    // Another device saved since this one read (or this one read nothing):
    // this device's changes since its copy, over the server's copy now.
    const fresh = await readServerCopy();
    const from = base.config ?? sent;
    const shown = pendingConfigRef.current;
    const merged = rebaseConfig(from, asJson(shown), fresh.config);
    baseRef.current = fresh;
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
    if (!refusedAsStale(second)) throw new Error(`save failed (${second.status})`);

    // Refused again: the server's copy as it is, nothing laid over it.
    const latest = await readServerCopy();
    baseRef.current = latest;
    setSavedConfig(latest.config);
    setConfig(latest.config);
    toastRef.current('Settings changed on another device; reloaded', 'error');
  };

  const queueSave = (keepalive) => {
    queueRef.current = queueRef.current
      .then(() => saveNow(keepalive))
      .catch(() => {
        // The debounced effect re-arms on the next edit, and localStorage
        // already holds the value — surface the failure so the user knows
        // their settings aren't yet persisted server-side.
        toastRef.current("Couldn't save settings — will retry", 'error');
      });
  };
  const queueSaveRef = useRef(queueSave);
  queueSaveRef.current = queueSave;

  // Save config: localStorage immediately, server debounced
  useEffect(() => {
    localStorage.setItem('jaghelm-config', JSON.stringify(config));
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
  // is hidden or about to unload. Without this, an edit made <2s before the user
  // closes/navigates is lost server-side (localStorage survives, but other
  // devices never see it). A keepalive fetch lets the request outlive the page
  // and, unlike sendBeacon, carries the If-Match (and the x-auth-token header on
  // authed instances). It goes behind a save still on its way.
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
    apiFetch(DISPLAY_CONFIG_URL)
      .then(async (r) => {
        if (!r.ok) throw new Error(`read failed (${r.status})`);
        const data = await r.json();
        // The copy every later save descends from, and its version (#547).
        baseRef.current = {
          config: data && typeof data === 'object' ? data : {},
          version: r.headers.get('ETag'),
        };
        if (data && typeof data === 'object' && Object.keys(data).length > 0) {
          setSavedConfig(data);
          setConfig((prev) => {
            const merged = { ...data };
            // localStorage layout is authoritative — server may be stale from a previous deploy
            if (prev.gridLayout) {
              merged.gridLayout = prev.gridLayout;
            }
            localStorage.setItem('jaghelm-config', JSON.stringify(merged));
            if (data.theme && !localStorage.getItem('jaghelm-theme')) setTheme(data.theme);
            return merged;
          });
        }
        configLoadedFromServer.current = true;
        onLoadedRef.current?.();
      })
      .catch(() => {
        // No copy read: this device's config as it is now stands for it, so a
        // later save that has to be rebased re-applies only the edits made
        // from here (#547).
        baseRef.current = { config: asJson(pendingConfigRef.current), version: null };
        configLoadedFromServer.current = true;
        onLoadedRef.current?.();
      });
  }, []);

  return savedConfig;
}
