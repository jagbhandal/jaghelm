import { useState, useEffect, useCallback } from 'react';
import { readServerConfig } from './readServerConfig.js';
import { apiFetch, isReadOnlyServer } from '../../api/client.js';
import { useToast } from '../../context/OverlayContext.jsx';

/**
 * services.yaml as Settings → Nodes & Services reads and saves it (#317 moved
 * this here from SettingsView, unchanged): `useServerConfig()` gives the
 * section the stored config and the live services and monitors, and saves
 * each edit, debounced, over the version it read (#423).
 *
 * The section reads the config when it opens (after the save waiting, if
 * any), and leaving it sends the waiting save at once (#501), so the next
 * read waits behind it. A refused save reads it again (or, while
 * services.yaml can't be used, says why in place of the config) while the
 * section is open, and is read afresh when it opens next.
 */

// The services config as last edited here, when the server is the read-only
// demo (#248): it refuses the save, so the edit is kept here for the visit and
// shown again when Settings reloads the config.
let localServerConfig = null;

// How long a save or read of services.yaml may go unanswered before Settings
// gives up on it (#501), so a hung one can't hold up every save after it.
const SERVER_TIMEOUT_MS = 15_000;

// Settings' saves of services.yaml: one set per app, not per view (#501),
// since a save outlives the view that made it.
const serverSaves = {
  // The stored config the screen's config descends from (#423): its version,
  // the read's ETag, which each save sends back as If-Match and a save's
  // answer moves on. A read that replaces the screen starts a new one. A
  // refused save marks its own dead, so the edits made on the screen it came
  // from are never sent.
  base: { version: null, dead: false },
  // Edits made so far, so a read can tell the screen has one it didn't see.
  edits: 0,
  // Saves and reads go out one at a time, in order: each save sends the
  // version the one before it answered, and a read answers after every save
  // queued before it, never with a version one of them already replaced.
  queue: Promise.resolve(),
  // The debounced save, its timer, and how many saves are queued or sent.
  pending: null,
  timer: null,
  sending: 0,
  // Whether closing the tab asks first.
  guarded: false,
  // The section on screen, if any: { reload, showError, setSaving }.
  view: null,
};

function serverSavesBusy() {
  return serverSaves.pending != null || serverSaves.sending > 0;
}

// Closing the tab with a save waiting or on its way asks first (#501).
function warnUnsaved(event) {
  event.preventDefault();
  event.returnValue = '';
}

// Show whether a save is waiting or on its way, and guard closing the tab
// only while one is.
function noteServerSavesBusy() {
  const busy = serverSavesBusy();
  serverSaves.view?.setSaving(busy);
  if (busy === serverSaves.guarded) return;
  serverSaves.guarded = busy;
  if (busy) window.addEventListener('beforeunload', warnUnsaved);
  else window.removeEventListener('beforeunload', warnUnsaved);
}

// Send the debounced save now, if one is waiting.
function flushServerSave() {
  clearTimeout(serverSaves.timer);
  serverSaves.timer = null;
  const post = serverSaves.pending;
  serverSaves.pending = null;
  if (!post) return;
  serverSaves.sending += 1;
  // A save reports its own failure; none may stop the queue behind it.
  serverSaves.queue = serverSaves.queue
    .then(post)
    .catch(() => {})
    .finally(() => {
      serverSaves.sending -= 1;
      noteServerSavesBusy();
    });
}

/** `config` with no node carrying an `icon` (#306), or the same object when none does. */
function withoutNodeIcons(config) {
  const nodes = config?.nodes;
  if (!nodes || typeof nodes !== 'object') return config;
  const keys = Object.keys(nodes).filter((k) => nodes[k] && Object.hasOwn(nodes[k], 'icon'));
  if (keys.length === 0) return config;
  const next = { ...nodes };
  for (const k of keys) {
    const { icon: _icon, ...rest } = nodes[k];
    next[k] = rest;
  }
  return { ...config, nodes: next };
}

/**
 * services.yaml for the section on screen: `{ config, live, monitorNames,
 * error, saving, save, retry }`. `config` is null until read (and while it
 * can't be shown); `error` says why it can't be (a services.yaml that doesn't
 * parse names its line); `live` is /api/services, `monitorNames` Kuma's
 * monitors, `mapping` /api/services/monitor-mapping's answer (what Auto-match would
 * pick for each container, #319; null until read); `save(edited)` saves an edit; `retry()` reads again (Try again).
 */
export function useServerConfig() {
  const toast = useToast();
  const [config, setConfig] = useState(null);
  const [live, setLive] = useState(null);
  const [monitorNames, setMonitorNames] = useState([]);
  const [mapping, setMapping] = useState(null);
  const [saving, setSaving] = useState(serverSavesBusy);
  const [error, setError] = useState(null);

  // The stored config can't be shown, for `reason`: the section says so in
  // place of it, and no save goes out from the screen it replaces.
  const showError = useCallback((reason) => {
    serverSaves.base.dead = true;
    setConfig(null);
    setError(reason);
  }, []);

  // Read the stored config (and the live services and monitors) when the
  // section opens, after a refused save, and on Try again. It goes out behind
  // every save, the pending one sent first, so it reads what they saved
  // (#501). An edit made while it was out is newer than what it read: the
  // screen and its base stay, and a change made elsewhere meanwhile refuses
  // that edit's save (409) and reloads. A refused screen is replaced
  // regardless.
  const read = useCallback(() => {
    flushServerSave();
    const editsBefore = serverSaves.edits;
    const readAll = () => {
      const signal = AbortSignal.timeout(SERVER_TIMEOUT_MS);
      const json = (url) =>
        apiFetch(url, { signal })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
      return Promise.all([
        readServerConfig({ signal }),
        json('/api/services'),
        json('/api/services/monitors'),
        json('/api/services/monitor-mapping'),
      ])
        .then(([got, svc, mon, map]) => {
          if (isReadOnlyServer() && localServerConfig) setConfig(localServerConfig);
          else if (got.error) showError(got.error);
          else if (serverSaves.edits === editsBefore || serverSaves.base.dead) {
            serverSaves.base = { version: got.version, dead: false };
            setError(null);
            setConfig(got.config);
          }
          if (svc) setLive(svc);
          if (Array.isArray(mon)) setMonitorNames(mon);
          if (map?.services) setMapping(map);
        })
        .catch(() => {});
    };
    serverSaves.queue = serverSaves.queue.then(readAll);
  }, [showError]);

  // Opening the section reads the config; leaving it sends the pending save
  // at once (#501), so the next read waits behind it.
  useEffect(() => {
    const view = { reload: read, showError, setSaving };
    serverSaves.view = view;
    read();
    return () => {
      flushServerSave();
      if (serverSaves.view === view) serverSaves.view = null;
    };
  }, [read, showError]);

  // Save with debounce. Each save sends the version its config was read at
  // (If-Match, #423). A save the server refuses or that fails is never
  // silent, and the stored config is read again so the screen matches what
  // is saved; the edits made on the old screen are dropped, and one that
  // would have gone out from it says it wasn't saved. A save over a version
  // that is no longer the file's (another tab, an integration save or a hand
  // edit changed it since) says so; any other refusal (a stale credential
  // marker is a 409 too, #413) shows the server's reason. While services.yaml
  // doesn't parse (503 config_unparseable) or can't be read (503
  // config_unreadable, #550) reading again can't help: the section shows why
  // at once, until it is fixed and read again (Try again). A save with no
  // answer in SERVER_TIMEOUT_MS fails the same way (#501): it may have
  // landed, so the config is read again before anything is sent.
  const save = useCallback(
    (edited) => {
      // A node's icon is read by nothing since the old board went (#306):
      // every save drops it.
      const next = withoutNodeIcons(edited);
      serverSaves.edits += 1;
      setConfig(next);
      if (isReadOnlyServer()) {
        localServerConfig = next;
        return;
      }
      const base = serverSaves.base;
      const post = () => {
        if (base.dead) {
          toast('Not saved: an earlier change on this screen was refused', 'error');
          return undefined;
        }
        const headers = { 'Content-Type': 'application/json' };
        if (base.version) headers['If-Match'] = base.version;
        return apiFetch('/api/services/config', {
          method: 'POST',
          headers,
          body: JSON.stringify(next),
          signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
        })
          .then(async (r) => {
            if (r.ok) {
              base.version = r.headers.get('ETag');
              return;
            }
            const data = await r.json().catch(() => ({}));
            const err = new Error(data?.error || `HTTP ${r.status}`);
            err.stale = r.status === 409 && data?.stale === true;
            // Reading again can't help with either: the file must be fixed first.
            err.unusable =
              data?.code === 'config_unparseable' || data?.code === 'config_unreadable';
            throw err;
          })
          .catch((err) => {
            base.dead = true;
            const why =
              err.name === 'TimeoutError'
                ? `the server didn't answer in ${SERVER_TIMEOUT_MS / 1000} s`
                : err.message;
            toast(
              err.stale ? 'Settings changed elsewhere; reloaded' : `Not saved: ${why}`,
              'error'
            );
            if (err.unusable) serverSaves.view?.showError(err.message);
            else serverSaves.view?.reload();
          });
      };
      clearTimeout(serverSaves.timer);
      serverSaves.pending = post;
      serverSaves.timer = setTimeout(flushServerSave, 1500);
      noteServerSavesBusy();
    },
    [toast]
  );

  return { config, live, monitorNames, mapping, error, saving, save, retry: read };
}
