import React, { useState, useEffect, useCallback } from 'react';
import GeneralTab from '../components/settings/GeneralTab';
import AppearanceTab from '../components/settings/AppearanceTab';
import LayoutTab from '../components/settings/LayoutTab';
import SectionsTab from '../components/settings/SectionsTab';
import TypographyTab from '../components/settings/TypographyTab';
import NodesTab from '../components/settings/NodesTab';
import ServicesTab from '../components/settings/ServicesTab';
import LinksTab from '../components/settings/LinksTab';
import WidgetsTab from '../components/settings/WidgetsTab';
import TabsTab from '../components/settings/TabsTab';
import SecurityTab from '../components/settings/SecurityTab';
import BackupTab from '../components/settings/BackupTab';
import IntegrationsTab from '../components/settings/IntegrationsTab';
import ConfigReadError from '../components/settings/ConfigReadError';
import { readServerConfig } from '../components/settings/readServerConfig.js';
import { apiFetch, isReadOnlyServer } from '../api/client.js';
import { useToast } from '../context/OverlayContext.jsx';

// The services config as last edited in this tab, when the server is the
// read-only demo (#248): it refuses the save, so the edit is kept here for the
// visit and shown again when Settings reloads the config.
let localServerConfig = null;

// How long a save or read of services.yaml may go unanswered before Settings
// gives up on it (#501), so a hung one can't hold up every save after it.
const SERVER_TIMEOUT_MS = 15_000;

// Settings' saves of services.yaml: one set per app, not per Settings view
// (#501), since a save outlives the view that made it.
const serverSaves = {
  // The stored config the screen's config descends from (#423): its version,
  // the read's ETag, which each save sends back as If-Match and a save's
  // answer moves on, whichever tab or view is showing. A read that replaces
  // the screen starts a new one. A refused save marks its own dead, so the
  // edits made on the screen it came from are never sent.
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
  // The Settings view on screen, if any: { reload, showError, setSaving }.
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

const SECTIONS = [
  { id: 'general', label: 'General', icon: '🏠', desc: 'Title, logo, branding' },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: '🎨',
    desc: 'Theme, Overview sections, background',
  },
  { id: 'typography', label: 'Typography', icon: '🔤', desc: 'Fonts' },
  { id: 'layout', label: 'Layout', icon: '📐', desc: 'Refresh, links, units' },
  { id: 'sections', label: 'Sections', icon: '🧱', desc: 'Utilities, custom groups' },
  { id: 'nodes', label: 'Nodes', icon: '🖥', desc: 'Manage infrastructure nodes', divider: true },
  { id: 'services', label: 'Services', icon: '📦', desc: 'Container overrides & monitors' },
  { id: 'integrations', label: 'Integrations', icon: '🔌', desc: 'App API connections' },
  { id: 'links', label: 'Links', icon: '🔗', desc: 'Quick Launch bookmarks', divider: true },
  { id: 'widgets', label: 'Widgets', icon: '🧩', desc: 'Search, weather, clock' },
  { id: 'tabs', label: 'Tabs', icon: '📑', desc: 'Embedded service tabs' },
  {
    id: 'security',
    label: 'Security',
    icon: '🔒',
    desc: 'Password & authentication',
    divider: true,
  },
  { id: 'backup', label: 'Backup', icon: '💾', desc: 'Export & import config' },
];

// Overline labels for the implied sidebar groups. The leading group (before the
// first divider) is always DISPLAY; every section flagged `divider: true` opens a
// new group whose label is keyed by that section's id. Group boundaries are still
// DERIVED from the SECTIONS `divider` flags below — this only names them.
const LEADING_GROUP_LABEL = 'DISPLAY';
const GROUP_LABELS = {
  nodes: 'INFRASTRUCTURE',
  links: 'DATA',
  security: 'SYSTEM',
};

/**
 * Settings. `section` opens one section, the route's (/settings/<section>,
 * #296): an unknown one opens General. `onSectionChange` hears each switch,
 * so the route can follow it; without it the view keeps its own.
 */
export default function SettingsView({ theme, setTheme, section, onSectionChange }) {
  const toast = useToast();
  const [ownSection, setOwnSection] = useState('general');
  const known = (id) => SECTIONS.some((s) => s.id === id && !s.disabled);
  const routed = onSectionChange != null;
  const activeSection = routed ? (known(section) ? section : 'general') : ownSection;
  const setActiveSection = routed ? onSectionChange : setOwnSection;

  // ── Server-side config (services.yaml) for Nodes/Services ──
  const [serverConfig, setServerConfig] = useState(null);
  const [liveServices, setLiveServices] = useState(null);
  const [monitorNames, setMonitorNames] = useState([]);
  const [serverSaving, setServerSaving] = useState(serverSavesBusy);
  // Why the config couldn't be read (or a save found services.yaml doesn't
  // parse): shown in place of the Nodes and Services tabs, never an old or
  // edited config that looks stored.
  const [serverError, setServerError] = useState(null);

  // The stored config can't be shown, for `reason`: the screen says so in
  // place of the tabs, and no save goes out from the screen it replaces.
  const showServerError = useCallback((reason) => {
    serverSaves.base.dead = true;
    setServerConfig(null);
    setServerError(reason);
  }, []);

  // Read the stored config (and the live services and monitors) when Nodes
  // or Services opens, after a refused save, and on Try again. It goes out
  // behind every save, the pending one sent first, so it reads what they
  // saved (#501). An edit made while it was out is newer than what it read:
  // the screen and its base stay, and a change made elsewhere meanwhile
  // refuses that edit's save (409) and reloads. A refused screen is replaced
  // regardless.
  const fetchServerData = useCallback(() => {
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
      ])
        .then(([read, svc, mon]) => {
          if (isReadOnlyServer() && localServerConfig) setServerConfig(localServerConfig);
          else if (read.error) showServerError(read.error);
          else if (serverSaves.edits === editsBefore || serverSaves.base.dead) {
            serverSaves.base = { version: read.version, dead: false };
            setServerError(null);
            setServerConfig(read.config);
          }
          if (svc) setLiveServices(svc);
          if (Array.isArray(mon)) setMonitorNames(mon);
        })
        .catch(() => {});
    };
    serverSaves.queue = serverSaves.queue.then(readAll);
  }, [showServerError]);

  // This view reloads after a refused save, even one made by the view
  // before it. Leaving Settings sends the pending save at once (#501), so
  // the next view's read waits behind it.
  useEffect(() => {
    const view = {
      reload: fetchServerData,
      showError: showServerError,
      setSaving: setServerSaving,
    };
    serverSaves.view = view;
    return () => {
      flushServerSave();
      if (serverSaves.view === view) serverSaves.view = null;
    };
  }, [fetchServerData, showServerError]);

  // A tab switch sends the pending save at once (#501), then Nodes and
  // Services read the config again.
  useEffect(() => {
    flushServerSave();
    if (activeSection === 'nodes' || activeSection === 'services') {
      fetchServerData();
    }
  }, [activeSection, fetchServerData]);

  // Save server config with debounce. Each save sends the version its
  // config was read at (If-Match, #423). A save the server refuses or that
  // fails is never silent, and the stored config is read again so the screen
  // matches what is saved; the edits made on the old screen are dropped, and
  // one that would have gone out from it says it wasn't saved. A save over a
  // version that is no longer the file's (another tab, an integration save or
  // a hand edit changed it since) says so; any other refusal (a stale
  // credential marker is a 409 too, #413) shows the server's reason. While
  // services.yaml doesn't parse (503 config_unparseable) or can't be read
  // (503 config_unreadable, #550) reading again can't help: the tab shows why
  // at once, until it is fixed and read again (Try again). A
  // save with no answer in SERVER_TIMEOUT_MS fails the same way (#501): it
  // may have landed, so the config is read again before anything is sent.
  const saveServerConfig = useCallback(
    (edited) => {
      // A node's icon is read by nothing since the old board went (#306):
      // every save drops it.
      const newConfig = withoutNodeIcons(edited);
      serverSaves.edits += 1;
      setServerConfig(newConfig);
      if (isReadOnlyServer()) {
        localServerConfig = newConfig;
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
          body: JSON.stringify(newConfig),
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

  return (
    <div className="settings-page">
      {/* Sidebar */}
      <nav className="settings-sidebar" aria-label="Settings sections">
        <div className="settings-sidebar-header">
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>
            Settings
          </span>
        </div>
        <div className="settings-sidebar-nav">
          {SECTIONS.map((s, i) => {
            // A new named group starts at the very first item (leading DISPLAY
            // group) and at every section flagged with a divider. The label is
            // derived from the divider flags + the GROUP_LABELS lookup.
            const startsGroup = i === 0 || (s.divider && i > 0);
            const groupLabel =
              i === 0
                ? LEADING_GROUP_LABEL
                : startsGroup
                  ? (GROUP_LABELS[s.id] ?? s.label.toUpperCase())
                  : undefined;
            return (
              <React.Fragment key={s.id}>
                {s.divider && i > 0 && <div className="settings-sidebar-divider" />}
                {groupLabel && (
                  <div
                    className="settings-sidebar-group-label"
                    role="presentation"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: 1.5,
                      textTransform: 'uppercase',
                      color: 'var(--text-muted)',
                      padding: '0 12px',
                      margin: i === 0 ? '2px 0 6px' : '4px 0 6px',
                    }}
                  >
                    {groupLabel}
                  </div>
                )}
                <button
                  className={`settings-sidebar-item ${activeSection === s.id ? 'active' : ''} ${s.disabled ? 'disabled' : ''}`}
                  onClick={() => !s.disabled && setActiveSection(s.id)}
                  disabled={s.disabled}
                  aria-current={activeSection === s.id ? 'page' : undefined}
                >
                  <span className="settings-sidebar-icon">{s.icon}</span>
                  <div className="settings-sidebar-text">
                    <span className="settings-sidebar-label">{s.label}</span>
                    <span className="settings-sidebar-desc">{s.desc}</span>
                  </div>
                  {s.disabled && (
                    <span className="settings-saving" style={{ flexShrink: 0 }}>
                      SOON
                    </span>
                  )}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </nav>

      {/* Settings content. Changes apply to the Overview itself: the live
          preview of the old board went with it (#306; spec §7, M10). */}
      <div style={{ display: 'flex', flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div className="settings-main" style={{ flex: 1, minWidth: 0 }}>
          <div
            className="settings-main-header"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 16,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <h1 className="settings-main-title">
                {SECTIONS.find((s) => s.id === activeSection)?.icon}{' '}
                {SECTIONS.find((s) => s.id === activeSection)?.label}
              </h1>
              <p className="settings-main-desc">
                {SECTIONS.find((s) => s.id === activeSection)?.desc}
              </p>
            </div>
          </div>
          <div className="settings-main-content">
            {activeSection === 'general' && <GeneralTab />}
            {activeSection === 'appearance' && <AppearanceTab theme={theme} setTheme={setTheme} />}
            {activeSection === 'typography' && <TypographyTab />}
            {activeSection === 'layout' && <LayoutTab />}
            {activeSection === 'sections' && <SectionsTab />}
            {(activeSection === 'nodes' || activeSection === 'services') && serverError && (
              <ConfigReadError message={serverError} onRetry={fetchServerData} />
            )}
            {activeSection === 'nodes' &&
              !serverError &&
              (serverConfig ? (
                <NodesTab
                  serverConfig={serverConfig}
                  onSave={saveServerConfig}
                  saving={serverSaving}
                  discovery={liveServices?.discovery}
                />
              ) : (
                <LoadingState />
              ))}
            {activeSection === 'services' &&
              !serverError &&
              (serverConfig && liveServices ? (
                <ServicesTab
                  serverConfig={serverConfig}
                  liveServices={liveServices}
                  monitorNames={monitorNames}
                  onSave={saveServerConfig}
                  saving={serverSaving}
                />
              ) : (
                <LoadingState />
              ))}
            {activeSection === 'integrations' && <IntegrationsTab />}
            {activeSection === 'links' && <LinksTab />}
            {activeSection === 'widgets' && <WidgetsTab />}
            {activeSection === 'tabs' && <TabsTab />}
            {activeSection === 'security' && <SecurityTab />}
            {activeSection === 'backup' && <BackupTab />}
          </div>
        </div>
      </div>
    </div>
  );
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

function LoadingState() {
  return (
    <div className="settings-loading">
      <div className="skeleton" style={{ width: 20, height: 20, borderRadius: '50%' }} />
      <span className="text-mono" style={{ fontSize: 13 }}>
        Loading server config...
      </span>
    </div>
  );
}
