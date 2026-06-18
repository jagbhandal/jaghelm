import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import NavBar from './components/NavBar';
import LoginPage from './components/LoginPage';
import CommandPalette from './components/CommandPalette';
import DashboardView from './views/DashboardView';
import { ConfigProvider } from './context/ConfigContext.jsx';
import { OverlayProvider, useToast } from './context/OverlayContext.jsx';
import { getMonitors } from './hooks/useData';
import { getAuthToken } from './api/client.js';

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
  const configLoadedFromServer = useRef(false);
  const intervalRef = useRef(null);
  const saveTimerRef = useRef(null);
  // Latest config + whether a debounced server save is still pending, so the
  // flush-on-unload handler can write the most recent edit synchronously.
  const pendingConfigRef = useRef(config);
  const savePendingRef = useRef(false);

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

  useEffect(() => {
    const root = document.documentElement;
    const hex = config.accentColor || '#6366f1';
    root.style.setProperty('--accent', hex);
    const r = parseInt(hex.slice(1, 3), 16),
      g = parseInt(hex.slice(3, 5), 16),
      b = parseInt(hex.slice(5, 7), 16);
    root.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.12)`);
    root.style.setProperty('--accent-light', hex);
    root.style.setProperty('--bg-opacity', String(config.bgOpacity ?? 0.3));
    root.style.setProperty('--overlay-opacity', String(config.overlayOpacity ?? 0.75));

    // Font family
    const fonts = config.fontFamily || 'default';
    const FONT_FAMILIES = {
      default: {
        display: "'Outfit', sans-serif",
        body: "'DM Sans', sans-serif",
        mono: "'JetBrains Mono', monospace",
      },
      clean: {
        display: "'Inter', sans-serif",
        body: "'Inter', sans-serif",
        mono: "'Fira Code', monospace",
      },
      rounded: {
        display: "'Nunito', sans-serif",
        body: "'Nunito', sans-serif",
        mono: "'Source Code Pro', monospace",
      },
      sharp: {
        display: "'Rajdhani', sans-serif",
        body: "'Roboto', sans-serif",
        mono: "'Roboto Mono', monospace",
      },
      system: {
        display: 'system-ui, -apple-system, sans-serif',
        body: 'system-ui, -apple-system, sans-serif',
        mono: "ui-monospace, 'SF Mono', monospace",
      },
    };
    const ff = FONT_FAMILIES[fonts] || FONT_FAMILIES.default;
    root.style.setProperty('--font-display', ff.display);
    root.style.setProperty('--font-body', ff.body);
    root.style.setProperty('--font-mono', ff.mono);

    // Font sizes
    const fs = config.fontSizes || {};
    if (fs.sectionTitle) root.style.setProperty('--fs-section-title', `${fs.sectionTitle}px`);
    if (fs.sectionSubtitle)
      root.style.setProperty('--fs-section-subtitle', `${fs.sectionSubtitle}px`);
    if (fs.metricValue) root.style.setProperty('--fs-metric-value', `${fs.metricValue}px`);
    if (fs.metricValueSm) root.style.setProperty('--fs-metric-value-sm', `${fs.metricValueSm}px`);
    if (fs.metricLabel) root.style.setProperty('--fs-metric-label', `${fs.metricLabel}px`);
    if (fs.serviceName) root.style.setProperty('--fs-service-name', `${fs.serviceName}px`);
    if (fs.serviceStatValue)
      root.style.setProperty('--fs-service-stat-value', `${fs.serviceStatValue}px`);
    if (fs.serviceStatLabel)
      root.style.setProperty('--fs-service-stat-label', `${fs.serviceStatLabel}px`);
  }, [
    config.accentColor,
    config.bgOpacity,
    config.overlayOpacity,
    config.fontFamily,
    config.fontSizes,
  ]);

  // Dynamic webfont loading.
  // global.css no longer eagerly @imports every alternate family (that pulled
  // all 11 webfonts on first paint). The 3 DEFAULT families (Outfit / DM Sans /
  // JetBrains Mono) ship via the index.html <link>. Here we lazily inject a
  // Google Fonts stylesheet for the selected non-default family — once, and only
  // when it's actually chosen — so the Typography setting still works.
  // 'default' and 'system' need nothing ('system' uses native system-ui stacks).
  // The family list/weights mirror the FONT_FAMILIES map above.
  useEffect(() => {
    const fonts = config.fontFamily || 'default';
    const FONT_WEBFONTS = {
      clean: 'family=Inter:wght@300;400;500;600;700&family=Fira+Code:wght@400;500',
      rounded: 'family=Nunito:wght@300;400;500;600;700;800&family=Source+Code+Pro:wght@400;500',
      sharp:
        'family=Rajdhani:wght@400;500;600;700&family=Roboto:wght@300;400;500;700&family=Roboto+Mono:wght@400;500',
    };
    const spec = FONT_WEBFONTS[fonts];
    if (!spec) return; // 'default' (preloaded) and 'system' (no webfont) need nothing
    const id = `jaghelm-font-${fonts}`;
    if (document.getElementById(id)) return; // idempotent — inject each family once
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${spec}&display=swap`;
    document.head.appendChild(link);
  }, [config.fontFamily]);

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
