/**
 * useConfigPersistence — owns the display-config save/load machinery that used
 * to live inline in AppMain. Extracted verbatim, behaviour-preserving, with the
 * same three effects in the same relative order:
 *   1. Save config: localStorage immediately, server debounced (2s).
 *   2. Flush a pending (debounced-but-unsent) server save on tab hide / unload.
 *   3. Load config from server on mount (authoritative source).
 *
 * Refs that the old AppMain held (configLoadedFromServer / saveTimerRef /
 * pendingConfigRef / savePendingRef) are now internal to this hook.
 *
 * @param {object}   config    the live display config (state value from App)
 * @param {function} setConfig the raw useState setter from App
 * @param {function} setTheme  the theme setter (server load may seed it)
 * @param {function} toast     useToast()'s notifier (surface save failures)
 */

import { useEffect, useRef } from 'react';
import { apiFetch, getAuthToken } from '../api/client.js';

export function useConfigPersistence(config, setConfig, setTheme, toast) {
  const configLoadedFromServer = useRef(false);
  const saveTimerRef = useRef(null);
  // Latest config + whether a debounced server save is still pending, so the
  // flush-on-unload handler can write the most recent edit synchronously.
  const pendingConfigRef = useRef(config);
  const savePendingRef = useRef(false);

  // Save config: localStorage immediately, server debounced
  useEffect(() => {
    localStorage.setItem('jaghelm-config', JSON.stringify(config));
    // Keep the latest config available to the unload flush handler.
    pendingConfigRef.current = config;
    // Don't save to server until we've loaded from server first (prevents overwriting server config with defaults)
    if (!configLoadedFromServer.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    // From here a server write is owed; the flush handler may send it early.
    savePendingRef.current = true;
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      savePendingRef.current = false;
      apiFetch('/api/display-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
        // keepalive so a save that fires just before an unload still completes
        // (closes the narrow race the visibilitychange flush doesn't cover).
        keepalive: true,
      })
        .then((r) => {
          // A non-2xx response is a failed save just as much as a thrown error.
          if (!r.ok) throw new Error(`save failed (${r.status})`);
        })
        .catch(() => {
          // The debounced effect re-arms on the next edit, and localStorage
          // already holds the value — surface the failure so the user knows
          // their settings aren't yet persisted server-side.
          toast("Couldn't save settings — will retry", 'error');
        });
    }, 2000);
  }, [config, toast]);

  // Flush a pending (debounced-but-unsent) server save immediately when the tab
  // is hidden or about to unload. Without this, an edit made <2s before the user
  // closes/navigates is lost server-side (localStorage survives, but other
  // devices never see it). sendBeacon can't carry the x-auth-token header (the
  // server rejects query/cookie tokens), so when authed we use fetch+keepalive
  // which can; we only fall back to sendBeacon when no token is needed.
  useEffect(() => {
    const flushSave = () => {
      if (!savePendingRef.current) return;
      // Cancel the debounce and consume the pending state so we send exactly once.
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      savePendingRef.current = false;
      const body = JSON.stringify(pendingConfigRef.current);
      const token = getAuthToken();
      // No token → auth disabled → sendBeacon works (no custom header needed).
      if (!token && typeof navigator !== 'undefined' && navigator.sendBeacon) {
        try {
          navigator.sendBeacon(
            '/api/display-config',
            new Blob([body], { type: 'application/json' })
          );
          return;
        } catch {
          // fall through to keepalive fetch
        }
      }
      // keepalive lets the request outlive the page, and unlike sendBeacon it
      // can carry the x-auth-token header (via apiFetch) on authed instances.
      apiFetch('/api/display-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
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
    apiFetch('/api/display-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data === 'object' && Object.keys(data).length > 0) {
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
      })
      .catch(() => {
        configLoadedFromServer.current = true;
      });
  }, []);
}
