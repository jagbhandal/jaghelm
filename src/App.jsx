import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import NavBar from './components/NavBar';
import LoginPage from './components/LoginPage';
import CommandPalette from './components/CommandPalette';
import DashboardView from './views/DashboardView';
import { ConfigProvider } from './context/ConfigContext.jsx';
import { OverlayProvider, useToast } from './context/OverlayContext.jsx';
import { getMonitors } from './hooks/useData';
import { useThemeVars } from './hooks/useThemeVars.js';
import { useConfigPersistence } from './hooks/useConfigPersistence.js';

// Settings (13-tab tree) and the iframe view aren't needed for the default
// dashboard render — code-split them so they don't weigh down the initial bundle.
const IframeView = lazy(() => import('./views/IframeView'));
const SettingsView = lazy(() => import('./views/SettingsView'));
import { apiFetch, setAuthToken as setApiAuthToken } from './api/client.js';

/**
 * App — outer shell. Owns auth resolution and the (unauthenticated) login
 * screen. The login screen renders OUTSIDE <OverlayProvider> (it has no need
 * for toasts/confirms). Once authenticated, the whole authenticated experience
 * — dashboard, settings, and the save machinery — is mounted inside
 * <OverlayProvider> so any of it can useToast()/useConfirm(). AppMain is split
 * out precisely so it can sit under that provider and call the hooks itself.
 */
export default function App() {
  const [authed, setAuthed] = useState(false);
  const [authRequired, setAuthRequired] = useState(null);
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('jaghelm-token') || '');

  // Apply the persisted theme to the document before login resolves, so the
  // login screen renders in the user's chosen theme (matching prior behaviour
  // where App's theme effect ran regardless of auth state). AppMain owns the
  // live theme afterwards.
  useEffect(() => {
    const stored = localStorage.getItem('jaghelm-theme');
    if (stored) document.documentElement.setAttribute('data-theme', stored);
  }, []);

  // Check auth on mount
  useEffect(() => {
    apiFetch('/api/auth/check')
      .then((r) => r.json())
      .then((d) => {
        setAuthRequired(d.authRequired);
        setAuthed(d.authenticated);
      })
      .catch(() => {
        setAuthRequired(false);
        setAuthed(true);
      });
  }, [authToken]);

  const handleLogin = (token) => {
    localStorage.setItem('jaghelm-token', token);
    setApiAuthToken(token); // Keep apiFetch's in-memory token in sync
    setAuthToken(token);
    setAuthed(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('jaghelm-token');
    setApiAuthToken(''); // Clear apiFetch's in-memory token
    setAuthToken('');
    setAuthed(false);
  };

  // Show login if auth required and not authenticated
  if (authRequired === null) return null; // Loading
  if (authRequired && !authed) {
    return (
      <>
        <div className="bg-layer">
          <div className="bg-overlay" />
        </div>
        <div className="bg-mesh" />
        <LoginPage onLogin={handleLogin} config={readStoredConfig()} />
      </>
    );
  }

  // Authenticated tree lives inside OverlayProvider so the dashboard and
  // settings (and the save effects in AppMain) can useToast()/useConfirm().
  return (
    <OverlayProvider>
      <AppMain authRequired={authRequired} onLogout={handleLogout} />
    </OverlayProvider>
  );
}

function AppMain({ authRequired, onLogout }) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [theme, setTheme] = useState(() => localStorage.getItem('jaghelm-theme') || 'dark');
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [overallHealth, setOverallHealth] = useState('up');
  const [refreshKey, setRefreshKey] = useState(0);
  // Start with localStorage for instant render; the server fetch overrides it.
  // `migrate` upgrades the legacy `jagnet-config` key to the current one.
  const [config, setConfig] = useState(() => readStoredConfig({ migrate: true }));
  const intervalRef = useRef(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('jaghelm-theme', theme);
  }, [theme]);

  // ⌘K / Ctrl+K toggles the command palette from anywhere.
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key?.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Display-config save/load machinery (localStorage + debounced server save,
  // flush-on-unload, authoritative server load on mount). Extracted to a hook;
  // behaviour + effect order preserved.
  useConfigPersistence(config, setConfig, setTheme, toast);

  // Apply config to the document as CSS custom properties + lazy webfont
  // injection (accent/opacity/font family/font sizes/blur). Extracted to a hook.
  useThemeVars(config);

  const intervalMs = (config.refreshInterval || 30) * 1000;
  const doRefresh = useCallback(() => {
    // Bump refreshKey IMMEDIATELY so DashboardView starts fetching right away.
    // The Kuma health check runs in parallel — it updates the navbar health dot
    // but does NOT block the dashboard data load.
    setLastUpdated(new Date());
    setRefreshKey((k) => k + 1);

    // Navbar health indicator — fire and forget, non-blocking
    getMonitors()
      .then((m) => {
        if (m === null) return; // 304 — no change, keep current health status
        if (m && typeof m === 'object') {
          const v = Object.values(m);
          if (v.length === 0) {
            setOverallHealth('unknown');
          } else {
            setOverallHealth(
              v.some((x) => x.status === 'down')
                ? 'down'
                : v.some((x) => x.status === 'unknown')
                  ? 'degraded'
                  : 'up'
            );
          }
        } else {
          setOverallHealth('unknown');
        }
      })
      .catch(() => setOverallHealth('unknown'));
  }, []);

  // Initial fetch on mount
  const didInitialFetch = useRef(false);
  useEffect(() => {
    if (didInitialFetch.current) return;
    didInitialFetch.current = true;
    doRefresh();
  }, [doRefresh]);

  // Set up refresh interval — debounced so slider dragging doesn't spam intervals
  useEffect(() => {
    const timer = setTimeout(() => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(doRefresh, intervalMs);
    }, 500); // Wait 500ms after last intervalMs change before setting interval
    return () => {
      clearTimeout(timer);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [doRefresh, intervalMs]);

  const allTabs = [
    { id: 'dashboard', label: 'Dashboard', type: 'dashboard' },
    ...(config.tabs || []),
  ];

  return (
    <ConfigProvider config={config} setConfig={setConfig}>
      <div className="bg-layer">
        {config.bgImage && (
          <div className="bg-image" style={{ backgroundImage: `url(${config.bgImage})` }} />
        )}
        <div className="bg-overlay" />
      </div>
      <div className="bg-mesh" />
      {config.showDots && activeTab !== 'settings' && <div className="dot-grid" />}
      <div className="app-container">
        <NavBar
          tabs={allTabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          theme={theme}
          setTheme={setTheme}
          health={overallHealth}
          lastUpdated={lastUpdated}
          onOpenSettings={() => setActiveTab((t) => (t === 'settings' ? 'dashboard' : 'settings'))}
          onLogout={
            authRequired
              ? () => {
                  onLogout();
                  setActiveTab('dashboard');
                }
              : null
          }
          refreshKey={refreshKey}
        />
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          tabs={allTabs}
          onSelectTab={setActiveTab}
          onOpenSettings={() => setActiveTab('settings')}
          theme={theme}
          setTheme={setTheme}
          onLogout={
            authRequired
              ? () => {
                  onLogout();
                  setActiveTab('dashboard');
                }
              : null
          }
        />
        <div
          style={
            activeTab === 'dashboard'
              ? undefined
              : { visibility: 'hidden', height: 0, overflow: 'hidden' }
          }
        >
          <DashboardView refreshKey={refreshKey} onOpenSettings={() => setActiveTab('settings')} />
        </div>
        <Suspense
          fallback={
            <div
              className="lazy-fallback"
              style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}
            >
              Loading…
            </div>
          }
        >
          {activeTab === 'settings' && <SettingsView theme={theme} setTheme={setTheme} />}
          {allTabs.find((t) => t.id === activeTab && t.type === 'iframe') && (
            <IframeView
              url={allTabs.find((t) => t.id === activeTab).url}
              title={allTabs.find((t) => t.id === activeTab).label}
            />
          )}
        </Suspense>
      </div>
    </ConfigProvider>
  );
}

// Read the last-persisted config from localStorage, falling back to defaults.
// Used both for AppMain's instant-render seed (with `migrate` to upgrade the
// legacy `jagnet-config` key) and for the login screen's branding.
function readStoredConfig({ migrate = false } = {}) {
  try {
    const existing = localStorage.getItem('jaghelm-config');
    if (existing) return JSON.parse(existing) || defaultConfig();
    const legacy = localStorage.getItem('jagnet-config');
    if (legacy) {
      if (migrate) localStorage.setItem('jaghelm-config', legacy);
      return JSON.parse(legacy) || defaultConfig();
    }
  } catch {
    // fall through to defaults
  }
  return defaultConfig();
}

function defaultConfig() {
  return {
    title: 'JAGHELM',
    subtitle: 'Infrastructure Dashboard',
    logoUrl: '',
    bgImage: '',
    bgOpacity: 0.3,
    overlayOpacity: 0.75,
    showDots: true,
    accentColor: '#6366f1',
    refreshInterval: 30,
    searchEngine: 'google',
    showSearch: true,
    weatherLat: '',
    weatherLon: '',
    showWeather: false,
    weatherCity: '',
    showDockerStats: false,
    showTodos: true,
    showCronJobs: true,
    tabs: [],
    sections: {},
    gridLayout: null,
    gridColumns: 24,
    links: {},
  };
}
