import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import NavBar from './components/NavBar';
import LoginPage from './components/LoginPage';
import CommandPalette from './components/CommandPalette';
import DashboardView from './views/DashboardView';
import { ConfigProvider } from './context/ConfigContext.jsx';
import { OverlayProvider, useToast } from './context/OverlayContext.jsx';
import { useThemeVars } from './hooks/useThemeVars.js';
import { usePageVisible } from './hooks/usePageVisible.js';
import { useConfigPersistence } from './hooks/useConfigPersistence.js';

// Settings (13-tab tree) and the iframe view aren't needed for the default
// dashboard render — code-split them so they don't weigh down the initial bundle.
const IframeView = lazy(() => import('./views/IframeView'));
const SettingsView = lazy(() => import('./views/SettingsView'));
import { apiFetch, setAuthToken as setApiAuthToken, initAuthToken } from './api/client.js';
import { secureStore } from './storage/index.js';

/**
 * App — outer shell owning auth resolution and the login screen. The
 * authenticated tree (AppMain) is split out so it can sit inside
 * <OverlayProvider> and call useToast()/useConfirm(); login renders outside it.
 */
export default function App() {
  const [authed, setAuthed] = useState(false);
  const [authRequired, setAuthRequired] = useState(null);
  const [authToken, setAuthToken] = useState('');

  // Apply the persisted theme to the document before login resolves, so the
  // login screen renders in the user's chosen theme (matching prior behaviour
  // where App's theme effect ran regardless of auth state). AppMain owns the
  // live theme afterwards.
  useEffect(() => {
    const stored = localStorage.getItem('jaghelm-theme');
    if (stored) document.documentElement.setAttribute('data-theme', stored);
  }, []);

  // Check auth on mount.
  //
  // Fail CLOSED: if the check itself fails (network error / non-2xx), we cannot
  // know whether auth is disabled, so we must NOT render the authenticated shell
  // (every data call would just 401). Treat a failed check as "auth required,
  // not authenticated" → show the login gate. A *successful* check that reports
  // `authRequired:false` is the only way to bypass login. The normal happy paths
  // (200 with authRequired/authenticated flags) are preserved exactly.
  //
  // Seed apiFetch's in-memory token from secure storage (web: localStorage)
  // BEFORE the auth check fires, so a reload keeps the session. Then run the
  // auth check. Re-runs when authToken changes (login/logout).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await initAuthToken();
      try {
        const r = await apiFetch('/api/auth/check');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (cancelled) return;
        setAuthRequired(d.authRequired);
        setAuthed(d.authenticated);
      } catch {
        if (cancelled) return;
        setAuthRequired(true);
        setAuthed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authToken]);

  const handleLogin = (token) => {
    secureStore.setItem('jaghelm-token', token); // web: localStorage; mobile: Keystore
    setApiAuthToken(token); // Keep apiFetch's in-memory token in sync
    setAuthToken(token);
    setAuthed(true);
  };

  const handleLogout = () => {
    secureStore.removeItem('jaghelm-token'); // web: localStorage; mobile: Keystore
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
  const [tick, setTick] = useState(0);
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

  // Display-config save/load (localStorage + debounced server save,
  // flush-on-unload, authoritative server load on mount).
  useConfigPersistence(config, setConfig, setTheme, toast);

  // Apply config to the document as CSS custom properties
  // (accent/opacity/font family/font sizes/blur).
  useThemeVars(config);

  const intervalMs = (config.refreshInterval || 30) * 1000;
  // One tick = one DashboardView fetch round. The navbar health dot reads the
  // SERVER-computed overallHealth off that round's /api/services payload
  // (DashboardView reports it through onHealth), so the web header dot and the
  // mobile Overview dot stay symmetric without a second /api/services fetch.
  const doRefresh = useCallback(() => {
    setLastUpdated(new Date());
    setTick((t) => t + 1);
  }, []);

  // Poll only while the dashboard is on screen: not in a hidden browser tab, and
  // not on Settings or an iframe tab (the dashboard stays mounted there, hidden).
  // DashboardView loads on mount and refreshes at once when it becomes active.
  const pageVisible = usePageVisible();
  const dashboardActive = activeTab === 'dashboard' && pageVisible;

  // Back on the dashboard: DashboardView's resume refresh starts now, so restart
  // the "Updated" clock with it.
  const wasActiveRef = useRef(dashboardActive);
  useEffect(() => {
    if (dashboardActive && !wasActiveRef.current) setLastUpdated(new Date());
    wasActiveRef.current = dashboardActive;
  }, [dashboardActive]);

  // Set up refresh interval — debounced so slider dragging doesn't spam intervals
  useEffect(() => {
    if (!dashboardActive) return;
    const timer = setTimeout(() => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(doRefresh, intervalMs);
    }, 500); // Wait 500ms after last intervalMs change before setting interval
    return () => {
      clearTimeout(timer);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [doRefresh, intervalMs, dashboardActive]);

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
          <DashboardView
            tick={tick}
            active={dashboardActive}
            onHealth={setOverallHealth}
            onOpenSettings={() => setActiveTab('settings')}
          />
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
