import React, { useState, useEffect, useCallback, useRef } from 'react';
import NavBar from './components/NavBar';
import LoginPage from './components/LoginPage';
import DashboardView from './views/DashboardView';
import IframeView from './views/IframeView';
import SettingsView from './views/SettingsView';
import { getMonitors } from './hooks/useData';
import { THEMES } from './components/settings/AppearanceTab';

// ── Auth token interceptor ──
// Set up ONCE, synchronously, before any component renders.
// Uses a mutable ref so the token value updates without re-patching fetch.
const _authTokenRef = { current: localStorage.getItem('jaghelm-token') || '' };
if (!window._origFetch) {
  window._origFetch = window.fetch;
  window.fetch = (url, opts = {}) => {
    if (typeof url === 'string' && url.startsWith('/api') && !url.includes('/auth/login') && _authTokenRef.current) {
      opts.headers = { ...opts.headers, 'x-auth-token': _authTokenRef.current };
    }
    return window._origFetch(url, opts);
  };
}

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [authRequired, setAuthRequired] = useState(null);
  const [authToken, setAuthToken] = useState(() => _authTokenRef.current);
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
    fetch('/api/auth/check')
      .then(r => r.json())
      .then(d => { setAuthRequired(d.authRequired); setAuthed(d.authenticated); })
      .catch(() => { setAuthRequired(false); setAuthed(true); });
  }, [authToken]);

  const handleLogin = (token) => {
    localStorage.setItem('jaghelm-token', token);
    _authTokenRef.current = token; // Update interceptor immediately
    setAuthToken(token);
    setAuthed(true);
  };

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
  // Exception: gridLayout is preserved from localStorage if it exists,
  // because the local layout is always the most recent user arrangement.
  // The server layout may be stale from a previous deploy or compactor bug.
   useEffect(() => {
    if (!authed) return;
    fetch('/api/display-config')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && typeof data === 'object' && Object.keys(data).length > 0) {
          setConfig(prev => {
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

  // Card blur override
  useEffect(() => {
    const root = document.documentElement;
    const blur = config.cardBlur;
    if (blur && blur !== 'none') {
      const blurMap = { sm: '4px', md: '12px', lg: '24px' };
      root.style.setProperty('--glass-blur', blurMap[blur] || '24px');
    }
    // When 'none' or unset, don't override — let theme default handle it
  }, [config.cardBlur]);

  const intervalMs = (config.refreshInterval || 30) * 1000;
  const doRefresh = useCallback(() => {
    // Bump refreshKey IMMEDIATELY so DashboardView starts fetching right away.
    // The Kuma health check runs in parallel — it updates the navbar health dot
    // but does NOT block the dashboard data load.
    setLastUpdated(new Date());
    setRefreshKey(k => k + 1);

    // Navbar health indicator — fire and forget, non-blocking
    getMonitors()
      .then(m => {
        if (m === null) return; // 304 — no change, keep current health status
        if (m && typeof m === 'object') {
          const v = Object.values(m);
          if (v.length === 0) { setOverallHealth('unknown'); }
          else { setOverallHealth(v.some(x => x.status === 'down') ? 'down' : v.some(x => x.status === 'unknown') ? 'degraded' : 'up'); }
        } else { setOverallHealth('unknown'); }
      })
      .catch(() => setOverallHealth('unknown'));
  }, []);

  // Initial fetch on auth
  const didInitialFetch = useRef(false);
  useEffect(() => {
    if (!authed || didInitialFetch.current) return;
    didInitialFetch.current = true;
    doRefresh();
  }, [authed, doRefresh]);

  // Set up refresh interval — debounced so slider dragging doesn't spam intervals
  useEffect(() => {
    if (!authed) return;
    const timer = setTimeout(() => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(doRefresh, intervalMs);
    }, 500); // Wait 500ms after last intervalMs change before setting interval
    return () => {
      clearTimeout(timer);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
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
            const order = THEMES.map(t => t.id);
            setTheme(t => { const i = order.indexOf(t); return order[(i + 1) % order.length]; });
          }}
          health={overallHealth} lastUpdated={lastUpdated} config={config}
          onOpenSettings={() => setActiveTab(t => t === 'settings' ? 'dashboard' : 'settings')}
          onLogout={authRequired ? () => {
            localStorage.removeItem('jaghelm-token');
            _authTokenRef.current = '';
            setAuthToken('');
            setAuthed(false);
            setActiveTab('dashboard');
          } : null}
          refreshKey={refreshKey} />
        <div style={activeTab === 'dashboard' ? undefined : { visibility: 'hidden', height: 0, overflow: 'hidden' }}>
          <DashboardView config={config} setConfig={setConfig} refreshKey={refreshKey} />
        </div>
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
    title: 'JAGHELM', subtitle: 'Infrastructure Dashboard',
    logoUrl: '', bgImage: '', bgOpacity: 0.3, overlayOpacity: 0.75, showDots: true,
    accentColor: '#6366f1', refreshInterval: 30, searchEngine: 'google', showSearch: true,
    weatherLat: '', weatherLon: '', showWeather: false, weatherCity: '',
    showDockerStats: false, showTodos: true, showCronJobs: true,
    tabs: [],
    sections: {},
    gridLayout: null, gridColumns: 24,
    links: {},
  };
}
