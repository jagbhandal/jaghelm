import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import DashboardView from './DashboardView';
import { apiFetch } from '../api/client.js';

const SECTIONS = [
  { id: 'general', label: 'General', icon: '🏠', desc: 'Title, logo, branding' },
  { id: 'appearance', label: 'Appearance', icon: '🎨', desc: 'Theme, colors, background' },
  { id: 'typography', label: 'Typography', icon: '🔤', desc: 'Fonts, sizes, readability' },
  { id: 'layout', label: 'Layout', icon: '📐', desc: 'Grid, refresh, card style' },
  { id: 'sections', label: 'Sections', icon: '🧱', desc: 'UPS, Pipeline, Quick Launch, Todos' },
  { id: 'nodes', label: 'Nodes', icon: '🖥', desc: 'Manage infrastructure nodes', divider: true },
  { id: 'services', label: 'Services', icon: '📦', desc: 'Container overrides & monitors' },
  { id: 'integrations', label: 'Integrations', icon: '🔌', desc: 'App API connections' },
  { id: 'links', label: 'Links', icon: '🔗', desc: 'Quick Launch bookmarks', divider: true },
  { id: 'widgets', label: 'Widgets', icon: '🧩', desc: 'Search, weather, features' },
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

// Viewport width at/above which the live preview is shown by default. Below it the
// settings form would be too cramped next to the 50% preview, so it starts hidden.
const PREVIEW_BREAKPOINT = '(min-width: 1100px)';

// Whether the live preview should default to visible. Guards for no `window`
// (SSR / tests without a DOM) and a missing `matchMedia` (older jsdom).
function previewDefaultVisible() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(PREVIEW_BREAKPOINT).matches;
}

export default function SettingsView({ theme, setTheme }) {
  const [activeSection, setActiveSection] = useState('general');
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  // Live preview visibility. Defaults to the viewport-derived value (hidden on
  // ~laptop widths so the form gets full width) and, once the user toggles it,
  // their explicit choice sticks for the rest of the session.
  const [showPreview, setShowPreview] = useState(previewDefaultVisible);

  // ── Server-side config (services.yaml) for Nodes/Services ──
  const [serverConfig, setServerConfig] = useState(null);
  const [liveServices, setLiveServices] = useState(null);
  const [monitorNames, setMonitorNames] = useState([]);
  const [serverSaving, setServerSaving] = useState(false);
  const serverSaveTimer = useRef(null);

  // Fetch server config on mount and when switching to relevant tabs
  const fetchServerData = useCallback(() => {
    Promise.all([
      apiFetch('/api/services/config').then((r) => (r.ok ? r.json() : null)),
      apiFetch('/api/services').then((r) => (r.ok ? r.json() : null)),
      apiFetch('/api/services/monitors').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([cfg, svc, mon]) => {
        if (cfg) setServerConfig(cfg);
        if (svc) setLiveServices(svc);
        if (Array.isArray(mon)) setMonitorNames(mon);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (activeSection === 'nodes' || activeSection === 'services') {
      fetchServerData();
    }
  }, [activeSection, fetchServerData]);

  // Save server config with debounce
  const saveServerConfig = useCallback((newConfig) => {
    setServerConfig(newConfig);
    setServerSaving(true);
    if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current);
    serverSaveTimer.current = setTimeout(() => {
      apiFetch('/api/services/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      })
        .then((r) => r.json())
        .then(() => setServerSaving(false))
        .catch(() => setServerSaving(false));
    }, 1500);
  }, []);

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

      {/* Settings content + Live Preview split */}
      <div style={{ display: 'flex', flex: 1, minWidth: 0, overflow: 'hidden' }}>
        {/* Settings form — claims full width when the preview is hidden, so the
            form isn't cramped on narrower (~laptop) viewports. */}
        <main
          className="settings-main"
          style={showPreview ? { maxWidth: '50%', flex: '0 0 50%' } : { flex: 1, minWidth: 0 }}
        >
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
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              aria-pressed={showPreview}
              title={
                showPreview ? 'Hide the live dashboard preview' : 'Show the live dashboard preview'
              }
              style={{
                flexShrink: 0,
                background: 'none',
                border: '1px solid var(--border-color)',
                borderRadius: 6,
                padding: '5px 10px',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                letterSpacing: 0.5,
                color: 'var(--text-secondary)',
                whiteSpace: 'nowrap',
              }}
            >
              {showPreview ? '⇥ Hide Preview' : '⇤ Show Preview'}
            </button>
          </div>
          <div className="settings-main-content">
            {activeSection === 'general' && <GeneralTab />}
            {activeSection === 'appearance' && <AppearanceTab theme={theme} setTheme={setTheme} />}
            {activeSection === 'typography' && <TypographyTab />}
            {activeSection === 'layout' && <LayoutTab />}
            {activeSection === 'sections' && <SectionsTab />}
            {activeSection === 'nodes' &&
              (serverConfig ? (
                <NodesTab
                  serverConfig={serverConfig}
                  onSave={saveServerConfig}
                  saving={serverSaving}
                />
              ) : (
                <LoadingState />
              ))}
            {activeSection === 'services' &&
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
        </main>

        {/* Live Preview Panel — toggled via the header button; hidden by default
            on narrow viewports so the form can use the full width. */}
        {showPreview && (
          <div
            style={{
              flex: '0 0 50%',
              maxWidth: '50%',
              borderLeft: '1px solid var(--glass-border)',
              overflow: 'hidden',
              position: 'relative',
              background: 'var(--bg-primary)',
            }}
          >
            {/* Preview header bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 16px',
                borderBottom: '1px solid var(--glass-border)',
                background: 'var(--bg-secondary)',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  letterSpacing: 0.5,
                }}
              >
                LIVE PREVIEW
              </span>
              <button
                onClick={() => setPreviewRefreshKey((k) => k + 1)}
                style={{
                  background: 'none',
                  border: '1px solid var(--border-color)',
                  borderRadius: 6,
                  padding: '3px 8px',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--text-muted)',
                }}
              >
                ↻ Refresh Data
              </button>
            </div>

            {/* Scaled dashboard preview */}
            <div
              style={{
                overflow: 'auto',
                height: 'calc(100vh - 60px - 40px)',
                position: 'relative',
              }}
            >
              <div
                style={{
                  transform: 'scale(0.55)',
                  transformOrigin: 'top left',
                  width: '182%',
                  minHeight: '182%',
                  pointerEvents: 'none',
                }}
              >
                <DashboardView refreshKey={previewRefreshKey} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
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
