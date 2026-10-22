import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  lazy,
  Suspense,
} from 'react';
import LoginPage from './components/LoginPage';
import CommandPalette from './components/CommandPalette';
import DashboardView from './views/DashboardView';
import { useTheme } from './shell/theme.js';
import { ConfigProvider } from './context/ConfigContext.jsx';
import { OverlayProvider, useToast } from './context/OverlayContext.jsx';
import { useThemeVars } from './hooks/useThemeVars.js';
import { usePageVisible } from './hooks/usePageVisible.js';
import { useConfigPersistence } from './hooks/useConfigPersistence.js';
import { useAppFrames } from './hooks/useAppFrames.js';
import { useStatus } from './hooks/useStatus.js';
import { defaultConfig } from './defaultConfig.js';
import { AppShell, ShellApps } from '@ui/app-shell';
import { AppBar } from '@ui/app-bar';
import { safeUrl } from './utils/safeUrl.js';
import { navigate, useRoute } from './router/useRoute.js';
import { pathTo } from './router/routes.js';
import { ShellHeader, ShellSideNav, ShellTabs } from './shell/ShellChrome.jsx';
import { OverviewStatus } from './shell/OverviewStatus.jsx';
import { clearOverviewFilter, useOverviewFilter } from './shell/overviewFilter.js';
import { appsOf, navGroups } from './shell/nav.js';
import { alertsBadge } from './shell/statusView.js';
import { useStatusStale } from './shell/statusFreshness.js';
import { loadAlertsPage, loadAppFrames, loadSettingsView } from './lazyViews.js';

// Settings (13-tab tree), the app frames and the Alerts page aren't needed for
// the default Overview render — code-split them so they don't weigh down the
// initial bundle. Their loaders live in lazyViews.js.
const AppFrames = lazy(loadAppFrames);
const SettingsView = lazy(loadSettingsView);
const AlertsPage = lazy(loadAlertsPage);
import {
  apiFetch,
  setAuthToken as setApiAuthToken,
  initAuthToken,
  setReadOnlyServer,
  setAuthExpiredHandler,
  getAuthToken,
  revokeSession,
} from './api/client.js';
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
  // The server is the read-only public demo (#248): it says so in the auth check.
  const [demo, setDemo] = useState(false);

  // The theme (dark, light or system, src/shell/theme.js) is App's, so the
  // login screen draws in it too; AppMain shows and changes it.
  const theme = useTheme();

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
        setDemo(d.demo === true);
        setReadOnlyServer(d.demo === true);
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

  // Forget the session in this tab. An expired session (below) ends here: the
  // server already dropped it, so there's nothing to revoke.
  const clearSession = useCallback(() => {
    secureStore.removeItem('jaghelm-token'); // web: localStorage; mobile: Keystore
    setApiAuthToken(''); // Clear apiFetch's in-memory token
    setAuthToken('');
    setAuthed(false);
  }, []);

  // The Log out button (#507) signs the browser out: the server revokes this
  // tab's session, and the stored one if another tab signed in since (that tab
  // signs out on its next 401), so a copy of either token stops working too.
  // Each request is sent before the tab forgets the token, which it does at
  // once: closing the tab while the server is slow can't leave the token
  // stored. revokeSession never rejects and gives up after 5 s.
  const handleLogout = useCallback(async () => {
    const mine = getAuthToken();
    const revoked = [revokeSession(mine)];
    const stored = await secureStore.getItem('jaghelm-token');
    if (stored && stored !== mine) revoked.push(revokeSession(stored));
    clearSession();
    await Promise.all(revoked);
  }, [clearSession]);

  // An expired session (#492). apiFetch passes the token the 401 came with. If
  // storage holds another, a tab signed in since: take its session and carry
  // on. Otherwise sign out like the button, without asking the server: the
  // sign-in screen replaces AppMain and every poll stops with it. A 401 means
  // the server wants a password now, even if it had none when this tab loaded.
  const handleExpired = useCallback(
    async (sent) => {
      const stored = await secureStore.getItem('jaghelm-token');
      if (stored && stored !== sent) return setApiAuthToken(stored);
      clearSession();
      setAuthRequired(true);
    },
    [clearSession]
  );
  useEffect(() => {
    setAuthExpiredHandler(handleExpired);
    return () => setAuthExpiredHandler(null);
  }, [handleExpired]);

  // Show login if auth required and not authenticated
  if (authRequired === null) return null; // Loading
  if (authRequired && !authed) {
    const stored = readStoredConfig();
    return (
      <>
        <div className="bg-layer">
          <div className="bg-overlay" />
        </div>
        <div className="bg-mesh" />
        <LoginPage
          onLogin={handleLogin}
          theme={theme.shown}
          name={instanceName(stored.title)}
          logoUrl={stored.logoUrl}
        />
      </>
    );
  }

  // Authenticated tree lives inside OverlayProvider so the dashboard and
  // settings (and the save effects in AppMain) can useToast()/useConfirm().
  return (
    <OverlayProvider>
      <AppMain authRequired={authRequired} demo={demo} onLogout={handleLogout} theme={theme} />
    </OverlayProvider>
  );
}

// The Overview stays mounted on other pages, out of sight (it keeps its state),
// so returning to it is instant.
const OUT_OF_SIGHT = { visibility: 'hidden', height: 0, overflow: 'hidden' };

/** The pages the nav lists, as the command palette offers them (routes.js). */
const PAGES = [
  { id: 'overview', label: 'Overview', href: pathTo('overview') },
  { id: 'alerts', label: 'Alerts', href: pathTo('alerts') },
  { id: 'settings', label: 'Settings', href: pathTo('settings') },
];

/** The instance's name in the header: the stock 'JAGHELM' reads as the product's name. */
function instanceName(title) {
  const t = typeof title === 'string' ? title.trim() : '';
  return t && t !== 'JAGHELM' ? t : 'JagHelm';
}

function AppMain({ authRequired, demo, onLogout, theme: { theme, shown, setTheme } }) {
  const toast = useToast();
  // The URL is the page (src/router, #296): a deep link, Back and Forward, a
  // reload and a chunk reload after a deploy all land where it says.
  const { route, params } = useRoute();
  const [tick, setTick] = useState(0);
  // Start with localStorage for instant render; the server fetch overrides it.
  // `migrate` upgrades the legacy `jagnet-config` key to the current one.
  const [config, setConfig] = useState(() => readStoredConfig({ migrate: true }));
  // Whether the server's config has loaded (or failed to): until then an app
  // the browser's copy lacks may still be on its way.
  const [configLoaded, setConfigLoaded] = useState(false);
  const intervalRef = useRef(null);

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
  const openPalette = useCallback(() => setPaletteOpen(true), []);

  // Display-config save/load (localStorage + debounced server save,
  // flush-on-unload, authoritative server load on mount). The demo refuses
  // writes, so nothing is sent to it: no save fails and no toast shows on load.
  const savedConfig = useConfigPersistence(config, setConfig, setTheme, toast, {
    readOnly: demo,
    onLoaded: () => setConfigLoaded(true),
  });

  // Apply config to the document as CSS custom properties
  // (accent/opacity/font family/font sizes/blur).
  useThemeVars(config);

  const intervalMs = (config.refreshInterval || 30) * 1000;
  // The header's status: /api/status once an interval, paused while the browser
  // tab is hidden (useStatus). It replaced the dashboard's health dot.
  const poll = useStatus({ intervalMs });

  // One tick = one DashboardView fetch round, only while the Overview is on
  // screen: not in a hidden browser tab, and not on another page (the Overview
  // stays mounted there, out of sight). DashboardView loads on mount and
  // refreshes at once when it becomes active.
  const doRefresh = useCallback(() => setTick((t) => t + 1), []);
  const pageVisible = usePageVisible();
  const onOverview = route.id === 'overview';
  const dashboardActive = onOverview && pageVisible;
  // The subsystem the Overview is filtered to (#298): the URL's `?subsystem=`,
  // when the model's strip shows it.
  const overviewFilter = useOverviewFilter(poll.status, onOverview);
  const filter = onOverview ? overviewFilter : null;

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

  // The embedded apps (#269): an app mounts on its first visit and stays
  // loaded, hidden, after, up to MAX_LOADED_APPS (useAppFrames).
  const apps = useMemo(() => appsOf(config.tabs), [config.tabs]);
  const appId = route.id === 'app' ? params.id : null;
  const openApp = appId == null ? null : (apps.find((a) => String(a.id) === appId) ?? null);
  const { frames, unload, reload } = useAppFrames(config.tabs, openApp ? openApp.id : null);
  // An app the config doesn't have shows the Overview, once the server's config
  // is in: it may only be missing from this browser's copy.
  useEffect(() => {
    if (appId != null && !openApp && configLoaded) navigate(pathTo('overview'), { replace: true });
  }, [appId, openApp, configLoaded]);

  // The apps loaded but not open, as one string, so the nav's groups (and the
  // memoised sidebar) only change when that set does, not on every render.
  const loadedKey = frames
    .filter((f) => !f.active)
    .map((f) => String(f.tab.id))
    .join('\n');
  // No badge while the status is stale (statusFreshness.js): its count and colour would be old.
  const statusStale = useStatusStale(poll);
  const badge = useMemo(() => alertsBadge(poll.status, statusStale), [poll.status, statusStale]);
  const groups = useMemo(
    () =>
      navGroups({
        routeId: route.id,
        appId,
        apps,
        loaded: new Set(loadedKey ? loadedKey.split('\n') : []),
        onUnload: unload,
        badge,
      }),
    [route.id, appId, apps, loadedKey, unload, badge]
  );
  const paletteApps = useMemo(
    () =>
      apps.map((a) => ({
        id: String(a.id),
        label: a.label || String(a.id),
        href: pathTo('app', { id: String(a.id) }),
      })),
    [apps]
  );

  const logout = useMemo(
    () =>
      authRequired
        ? () => {
            onLogout();
            navigate(pathTo('overview'), { replace: true });
          }
        : null,
    [authRequired, onLogout]
  );
  const openSettings = useCallback(() => navigate(pathTo('settings')), []);
  const onSectionChange = useCallback(
    (section) => navigate(pathTo('settings', { section }), { replace: true }),
    []
  );

  // Each page names the browser tab, so history entries tell apart.
  const name = instanceName(config.title);
  const pageTitle = route.id === 'app' ? openApp?.label : route.title;
  useEffect(() => {
    document.title = pageTitle ? `${pageTitle} — ${name}` : name;
  }, [pageTitle, name]);

  // The new UI's roots draw the theme shown: system's is the device's.
  const switches = useMemo(() => ({ theme: shown }), [shown]);

  const lazyFallback = (
    <div
      className="lazy-fallback"
      style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}
    >
      Loading…
    </div>
  );

  return (
    <ConfigProvider config={config} setConfig={setConfig}>
      <div className="bg-layer">
        {config.bgImage && (
          <div className="bg-image" style={{ backgroundImage: `url(${config.bgImage})` }} />
        )}
        <div className="bg-overlay" />
      </div>
      <div className="bg-mesh" />
      {config.showDots && route.id !== 'settings' && <div className="dot-grid" />}
      <div className="app-container">
        <AppShell
          switches={switches}
          header={
            <ShellHeader
              name={name}
              logoUrl={config.logoUrl}
              status={poll.status}
              reach={poll.reach}
              updated={poll.updated}
              routeId={route.id}
              onOpenPalette={openPalette}
              onThemeChange={setTheme}
              onLogout={logout}
            />
          }
          sidebar={<ShellSideNav groups={groups} />}
          tabs={<ShellTabs groups={groups} routeId={route.id} badge={badge} />}
        >
          <div style={onOverview ? undefined : OUT_OF_SIGHT}>
            <h1 className="sr-only">Overview</h1>
            {/* Its state is the poll's: nothing to keep while another page is open. */}
            {onOverview && (
              <OverviewStatus
                status={poll.status}
                reach={poll.reach}
                updated={poll.updated}
                filter={filter?.id ?? null}
              />
            )}
            <DashboardView
              tick={tick}
              active={dashboardActive}
              onOpenSettings={openSettings}
              filter={filter}
              onClearFilter={clearOverviewFilter}
              status={poll.status}
              reach={poll.reach}
              updated={poll.updated}
            />
          </div>
          <Suspense fallback={lazyFallback}>
            {route.id === 'alerts' && (
              <AlertsPage status={poll.status} reach={poll.reach} updated={poll.updated} />
            )}
          </Suspense>
          <Suspense fallback={lazyFallback}>
            {route.id === 'settings' && (
              <SettingsView
                theme={theme}
                setTheme={setTheme}
                section={params.section}
                onSectionChange={onSectionChange}
              />
            )}
          </Suspense>
          {/* A boundary of its own: another page's chunk loading must not hide the frames. */}
          <ShellApps
            label={openApp ? `${openApp.label || openApp.id}, open inside JagHelm` : undefined}
            bar={
              openApp && (
                <AppBar
                  name={openApp.label || String(openApp.id)}
                  url={openApp.url}
                  href={safeUrl(openApp.url) || undefined}
                  onReload={() => reload(openApp.id)}
                />
              )
            }
          >
            {frames.length > 0 && (
              <Suspense fallback={lazyFallback}>
                <AppFrames frames={frames} savedTabs={savedConfig?.tabs} />
              </Suspense>
            )}
          </ShellApps>
        </AppShell>
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          pages={PAGES}
          apps={paletteApps}
          onNavigate={navigate}
          theme={theme}
          setTheme={setTheme}
          onLogout={logout}
        />
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
