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
  { id: 'security', label: 'Security', icon: '🔒', desc: 'Password & authentication', divider: true },
  { id: 'backup', label: 'Backup', icon: '💾', desc: 'Export & import config' },
];

export default function SettingsView({ config, setConfig, theme, setTheme }) {
  const [activeSection, setActiveSection] = useState('general');
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);

  // ── Server-side config (services.yaml) for Nodes/Services ──
  const [serverConfig, setServerConfig] = useState(null);
  const [liveServices, setLiveServices] = useState(null);
  const [monitorNames, setMonitorNames] = useState([]);
  const [serverSaving, setServerSaving] = useState(false);
  const serverSaveTimer = useRef(null);

  // Fetch server config on mount and when switching to relevant tabs
  const fetchServerData = useCallback(() => {
    Promise.all([
      fetch('/api/services/config').then(r => r.ok ? r.json() : null),
      fetch('/api/services').then(r => r.ok ? r.json() : null),
      fetch('/api/services/monitors').then(r => r.ok ? r.json() : null),
    ]).then(([cfg, svc, mon]) => {
      if (cfg) setServerConfig(cfg);
      if (svc) setLiveServices(svc);
      if (Array.isArray(mon)) setMonitorNames(mon);
    }).catch(() => {});
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
      fetch('/api/services/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      })
        .then(r => r.json())
        .then(() => setServerSaving(false))
        .catch(() => setServerSaving(false));
    }, 1500);
  }, []);

  // ── Display config helpers (same pattern as old SettingsPanel) ──
  const update = useCallback((path, value) => {
    setConfig(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      const keys = path.split('.');
      let obj = next;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!obj[keys[i]]) obj[keys[i]] = {};
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return next;
    });
  }, [setConfig]);

  return (
    <div className="settings-page">
      {/* Sidebar */}
      <nav className="settings-sidebar">
        <div className="settings-sidebar-header">
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>Settings</span>
        </div>
        <div className="settings-sidebar-nav">
          {SECTIONS.map((s, i) => (
            <React.Fragment key={s.id}>
              {s.divider && i > 0 && <div className="settings-sidebar-divider" />}
              <button
                className={`settings-sidebar-item ${activeSection === s.id ? 'active' : ''} ${s.disabled ? 'disabled' : ''}`}
                onClick={() => !s.disabled && setActiveSection(s.id)}
                disabled={s.disabled}
              >
                <span className="settings-sidebar-icon">{s.icon}</span>
                <div className="settings-sidebar-text">
                  <span className="settings-sidebar-label">{s.label}</span>
                  <span className="settings-sidebar-desc">{s.desc}</span>
                </div>
                {s.disabled && (
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 9, padding: '2px 6px',
                    borderRadius: 4, background: 'var(--amber-bg)', color: 'var(--amber)',
                    border: '1px solid var(--amber-border)', flexShrink: 0,
                  }}>SOON</span>
                )}
              </button>
            </React.Fragment>
          ))}
        </div>
      </nav>

      {/* Settings content + Live Preview split */}
      <div style={{ display: 'flex', flex: 1, minWidth: 0, overflow: 'hidden' }}>
        {/* Settings form */}
        <main className="settings-main" style={{ maxWidth: '50%', flex: '0 0 50%' }}>
          <div className="settings-main-header">
            <h1 className="settings-main-title">
              {SECTIONS.find(s => s.id === activeSection)?.icon}{' '}
              {SECTIONS.find(s => s.id === activeSection)?.label}
            </h1>
            <p className="settings-main-desc">
              {SECTIONS.find(s => s.id === activeSection)?.desc}
            </p>
          </div>
          <div className="settings-main-content">
            {activeSection === 'general' && (
              <GeneralTab config={config} update={update} />
            )}
            {activeSection === 'appearance' && (
              <AppearanceTab config={config} update={update} theme={theme} setTheme={setTheme} />
            )}
            {activeSection === 'typography' && (
              <TypographyTab config={config} update={update} />
            )}
            {activeSection === 'layout' && (
              <LayoutTab config={config} update={update} />
            )}
            {activeSection === 'sections' && (
              <SectionsTab config={config} update={update} />
            )}
            {activeSection === 'nodes' && (
              serverConfig ? (
                <NodesTab serverConfig={serverConfig} onSave={saveServerConfig} saving={serverSaving} />
              ) : (
                <LoadingState />
              )
            )}
            {activeSection === 'services' && (
              serverConfig && liveServices ? (
                <ServicesTab
                  serverConfig={serverConfig}
                  liveServices={liveServices}
                  monitorNames={monitorNames}
                  onSave={saveServerConfig}
                  saving={serverSaving}
                />
              ) : (
                <LoadingState />
              )
            )}
            {activeSection === 'integrations' && (
              <IntegrationsTab />
            )}
            {activeSection === 'links' && (
              <LinksTab config={config} update={update} setConfig={setConfig} />
            )}
            {activeSection === 'widgets' && (
              <WidgetsTab config={config} update={update} />
            )}
            {activeSection === 'tabs' && (
              <TabsTab config={config} update={update} />
            )}
            {activeSection === 'security' && (
              <SecurityTab />
            )}
            {activeSection === 'backup' && (
              <BackupTab config={config} setConfig={setConfig} />
            )}
          </div>
        </main>

        {/* Live Preview Panel — always visible */}
        <div style={{
          flex: '0 0 50%', maxWidth: '50%',
          borderLeft: '1px solid var(--glass-border)',
          overflow: 'hidden', position: 'relative',
          background: 'var(--bg-primary)',
        }}>
          {/* Preview header bar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 16px',
            borderBottom: '1px solid var(--glass-border)',
            background: 'var(--bg-secondary)',
          }}>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 11,
              color: 'var(--text-secondary)', letterSpacing: 0.5,
            }}>
              LIVE PREVIEW
            </span>
            <button
              onClick={() => setPreviewRefreshKey(k => k + 1)}
              style={{
                background: 'none', border: '1px solid var(--border-color)',
                borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
                fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)',
              }}
            >
              ↻ Refresh Data
            </button>
          </div>

          {/* Scaled dashboard preview */}
          <div style={{
            overflow: 'auto',
            height: 'calc(100vh - 60px - 40px)',
            position: 'relative',
          }}>
            <div style={{
              transform: 'scale(0.55)',
              transformOrigin: 'top left',
              width: '182%',
              minHeight: '182%',
              pointerEvents: 'none',
            }}>
              <DashboardView
                config={config}
                setConfig={setConfig}
                refreshKey={previewRefreshKey}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 32, color: 'var(--text-muted)' }}>
      <div className="skeleton" style={{ width: 20, height: 20, borderRadius: '50%' }} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>Loading server config...</span>
    </div>
  );
}
