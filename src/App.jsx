import React, { useState, useEffect, useCallback, useRef } from 'react';
import NavBar from './components/NavBar';
import LoginPage from './components/LoginPage';
import DashboardView from './views/DashboardView';
import IframeView from './views/IframeView';
import SettingsView from './views/SettingsView';
import { getMonitors } from './hooks/useData';

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [authRequired, setAuthRequired] = useState(null);
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('jaghelm-token') || '');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [theme, setTheme] = useState(() => localStorage.getItem('jaghelm-theme') || 'dark');
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [overallHealth, setOverallHealth] = useState('up');
  const [refreshKey, setRefreshKey] = useState(0);
  const [config, setConfig] = useState(() => {
    try {
      // Start with localStorage for instant render, server fetch will override
      const existing = localStorage.getItem('jaghelm-config');
      if (existing) return JSON.parse(existing) || defaultConfig();
      const legacy = localStorage.getItem('jagnet-config');
      if (legacy) {
        localStorage.setItem('jaghelm-config', legacy);
        return JSON.parse(legacy) || defaultConfig();
      }
      return defaultConfig();
    }
    catch { return defaultConfig(); }
  });
  const configLoadedFromServer = useRef(false);
  const intervalRef = useRef(null);
  const saveTimerRef = useRef(null);

  // Check auth on mount
  useEffect(() => {
    fetch('/api/auth/check', { headers: { 'x-auth-token': authToken } })
      .then(r => r.json())
      .then(d => { setAuthRequired(d.authRequired); setAuthed(d.authenticated); })
      .catch(() => { setAuthRequired(false); setAuthed(true); });
  }, [authToken]);

  const handleLogin = (token) => {
    localStorage.setItem('jaghelm-token', token);
    setAuthToken(token);
    setAuthed(true);
  };

  // Inject token into all fetch calls
  useEffect(() => {
    if (authToken) {
      const origFetch = window._origFetch || window.fetch;
      if (!window._origFetch) window._origFetch = window.fetch;
      window.fetch = (url, opts = {}) => {
        if (typeof url === 'string' && url.startsWith('/api') && !url.includes('/auth/')) {
          opts.headers = { ...opts.headers, 'x-auth-token': authToken };
        }
        return origFetch(url, opts);
      };
    }
  }, [authToken]);

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('jaghelm-theme', theme); }, [theme]);

  // Save config: localStorage immediately, server debounced
  useEffect(() => {
    localStorage.setItem('jaghelm-config', JSON.stringify(config));
    // Don't save to server until we've loaded from server first (prevents overwriting server config with defaults)
    if (!configLoadedFromServer.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      fetch('/api/display-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      }).catch(() => {});
    }, 2000);
  }, [config]);

  // Load config from server on successful auth (authoritative source)
  useEffect(() => {
    if (!authed) return;
    fetch('/api/display-config')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && typeof data === 'object' && Object.keys(data).length > 0) {
          setConfig(data);
          localStorage.setItem('jaghelm-config', JSON.stringify(data));
          if (data.theme) setTheme(data.theme);
        }
        // Mark as loaded so future changes will save to server
        configLoadedFromServer.current = true;
      })
      .catch(() => { configLoadedFromServer.current = true; });
  }, [authed]);

  useEffect(() => {
    const root = document.documentElement;
    const hex = config.accentColor || '#6366f1';
    root.style.setProperty('--accent', hex);
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    root.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.12)`);
    root.style.setProperty('--accent-light', hex);
    root.style.setProperty('--bg-opacity', String(config.bgOpacity ?? 0.3));
    root.style.setProperty('--overlay-opacity', String(config.overlayOpacity ?? 0.75));

    // Font family
    const fonts = config.fontFamily || 'default';
    const FONT_FAMILIES = {
      default: { display: "'Outfit', sans-serif", body: "'DM Sans', sans-serif", mono: "'JetBrains Mono', monospace" },
      clean: { display: "'Inter', sans-serif", body: "'Inter', sans-serif", mono: "'Fira Code', monospace" },
      rounded: { display: "'Nunito', sans-serif", body: "'Nunito', sans-serif", mono: "'Source Code Pro', monospace" },
      sharp: { display: "'Rajdhani', sans-serif", body: "'Roboto', sans-serif", mono: "'Roboto Mono', monospace" },
      system: { display: "system-ui, -apple-system, sans-serif", body: "system-ui, -apple-system, sans-serif", mono: "ui-monospace, 'SF Mono', monospace" },
    };
    const ff = FONT_FAMILIES[fonts] || FONT_FAMILIES.default;
    root.style.setProperty('--font-display', ff.display);
    root.style.setProperty('--font-body', ff.body);
    root.style.setProperty('--font-mono', ff.mono);

    // Font sizes
    const fs = config.fontSizes || {};
    if (fs.sectionTitle) root.style.setProperty('--fs-section-title', `${fs.sectionTitle}px`);
    if (fs.sectionSubtitle) root.style.setProperty('--fs-section-subtitle', `${fs.sectionSubtitle}px`);
    if (fs.metricValue) root.style.setProperty('--fs-metric-value', `${fs.metricValue}px`);
    if (fs.metricValueSm) root.style.setProperty('--fs-metric-value-sm', `${fs.metricValueSm}px`);
    if (fs.metricLabel) root.style.setProperty('--fs-metric-label', `${fs.metricLabel}px`);
    if (fs.serviceName) root.style.setProperty('--fs-service-name', `${fs.serviceName}px`);
    if (fs.serviceStatValue) root.style.setProperty('--fs-service-stat-value', `${fs.serviceStatValue}px`);
    if (fs.serviceStatLabel) root.style.setProperty('--fs-service-stat-label', `${fs.serviceStatLabel}px`);
  }, [config.accentColor, config.bgOpacity, config.overlayOpacity, config.fontFamily, config.fontSizes]);

  const intervalMs = (config.refreshInterval || 30) * 1000;
  const doRefresh = useCallback(async () => {
    try {
      const m = await getMonitors(true);
      if (m && typeof m === 'object') {
        const v = Object.values(m);
        if (v.length === 0) { setOverallHealth('unknown'); }
        else { setOverallHealth(v.some(x => x.status === 'down') ? 'down' : v.some(x => x.status === 'unknown') ? 'degraded' : 'up'); }
      } else { setOverallHealth('unknown'); }
    } catch { setOverallHealth('unknown'); }
    setLastUpdated(new Date());
    setRefreshKey(k => k + 1);
  }, []);

  useEffect(() => {
    if (!authed) return;
    doRefresh();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(doRefresh, intervalMs);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [doRefresh, intervalMs, authed]);

  // Show login if auth required and not authenticated
  if (authRequired === null) return null; // Loading
  if (authRequired && !authed) {
    return (
      <>
        <div className="bg-layer"><div className="bg-overlay" /></div>
        <div className="bg-mesh" />
        <LoginPage onLogin={handleLogin} config={config} />
      </>
    );
  }

  const allTabs = [{ id: 'dashboard', label: 'Dashboard', type: 'dashboard' }, ...(config.tabs || [])];

  return (
    <>
      <div className="bg-layer">
        {config.bgImage && <div className="bg-image" style={{ backgroundImage: `url(${config.bgImage})` }} />}
        <div className="bg-overlay" />
      </div>
      <div className="bg-mesh" />
      {config.showDots && activeTab !== 'settings' && <div className="dot-grid" />}
      <div className="app-container">
        <NavBar tabs={allTabs} activeTab={activeTab} onTabChange={setActiveTab}
          theme={theme} setTheme={setTheme}
          onToggleTheme={() => {
            const order = ['dark', 'dracula', 'night-owl', 'github-dark', 'catppuccin', 'material'];
            setTheme(t => { const i = order.indexOf(t); return order[(i + 1) % order.length]; });
          }}
          health={overallHealth} lastUpdated={lastUpdated} config={config}
          onOpenSettings={() => setActiveTab('settings')}
          refreshKey={refreshKey} />
        {activeTab === 'dashboard' && <DashboardView config={config} setConfig={setConfig} refreshKey={refreshKey} />}
        {activeTab === 'settings' && <SettingsView config={config} setConfig={setConfig} theme={theme} setTheme={setTheme} />}
        {allTabs.find(t => t.id === activeTab && t.type === 'iframe') && (
          <IframeView url={allTabs.find(t => t.id === activeTab).url} title={allTabs.find(t => t.id === activeTab).label} />
        )}
      </div>
    </>
  );
}

function defaultConfig() {
  return {
    title: 'JAG-NET', subtitle: 'Infrastructure Dashboard',
    logoUrl: '', bgImage: '', bgOpacity: 0.3, overlayOpacity: 0.75, showDots: true,
    accentColor: '#6366f1', refreshInterval: 30, searchEngine: 'google', showSearch: true,
    weatherLat: '39.88', weatherLon: '-83.09', showWeather: true, weatherCity: 'Grove City',
    showDockerStats: false, showTodos: true,
    tabs: [
      { id: 'uptime', label: 'Uptime Kuma', type: 'iframe', url: 'https://kuma.jagbhandal.com' },
      { id: 'grafana', label: 'Grafana', type: 'iframe', url: 'https://grafana.jagbhandal.com' },
    ],
    sections: {
      gateway: { title: 'Gateway', subtitle: 'Raspberry Pi 5 · 192.XXX.XX.13', icon: '🛡', borderColor: '#a78bfa', visible: true },
      production: { title: 'Production · VM 103', subtitle: 'Minisforum U870 · 192.XXX.XX.11', icon: '🚀', borderColor: '#6366f1', visible: true },
      staging: { title: 'Staging · VM 101', subtitle: 'The Tinker · 192.168.68.12', icon: '🔬', borderColor: '#fbbf24', visible: true },
      ups: { title: 'UPS Power', subtitle: 'APC Back-UPS ES 600M1', icon: '⚡', borderColor: '#34d399', visible: true },
      pipeline: { title: 'Pipeline Activity', subtitle: 'homelab-infra', icon: '🔄', borderColor: '#818cf8', visible: true },
      quicklaunch: { title: 'Quick Launch', subtitle: '', icon: '🚀', borderColor: '#60a5fa', visible: true },
      todos: { title: 'Checklist', subtitle: '', icon: '✅', borderColor: '#f59e0b', visible: true },
    },
    gridLayout: null, gridColumns: 12,
    links: {
      personal: [
        { name: 'Photos', icon: '📷', url: 'https://photos.jagbhandal.com' },
        { name: 'Vault', icon: '🔐', url: 'https://vault.jagbhandal.com' },
        { name: 'Cloud', icon: '☁️', url: 'https://cloud.jagbhandal.com' },
      ],
      management: [
        { name: 'NPM', icon: '🔧', url: 'https://npmpi.jagbhandal.com' },
        { name: 'AdGuard', icon: '🛡', url: 'https://adguardpi.jagbhandal.com' },
        { name: 'Proxmox', icon: '📊', url: 'https://proxmox.jagbhandal.com' },
        { name: 'NAS', icon: '💾', url: 'https://nas.jagbhandal.com' },
      ],
      devops: [
        { name: 'VS Code', icon: '💻', url: 'https://code.jagbhandal.com' },
        { name: 'Gitea', icon: '🐙', url: 'https://git.jagbhandal.com' },
        { name: 'Dockge', icon: '🐳', url: 'https://dockge.jagbhandal.com' },
        { name: 'Grafana', icon: '📈', url: 'https://grafana.jagbhandal.com' },
        { name: 'Kuma', icon: '📡', url: 'https://kuma.jagbhandal.com' },
      ],
    },
  };
}
