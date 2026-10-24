import React, { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import LoginPage from './components/LoginPage';
import CommandPalette from './components/CommandPalette';
import OverviewBoard from './shell/OverviewBoard.jsx';
import { useTheme } from './shell/theme.js';
import { useAppearance } from './shell/appearance.js';
import { ConfigProvider } from './context/ConfigContext.jsx';
import { OverlayProvider, useToast } from './context/OverlayContext.jsx';
import { useThemeVars } from './hooks/useThemeVars.js';
import { usePageVisible } from './hooks/usePageVisible.js';
import { useConfigPersistence } from './hooks/useConfigPersistence.js';
import { useSetup } from './hooks/useSetup.js';
import { setFormatting } from './util/format.js';
import { withEmbedAnyway } from './utils/embedAnyway.js';
import { useAppFrames } from './hooks/useAppFrames.js';
import { useStatus } from './hooks/useStatus.js';
import { startPhaseLock } from './pollSchedule.js';
import { defaultConfig } from './defaultConfig.js';
import { AppShell, PHONE_WIDTH, ShellApps } from '@ui/app-shell';
import { AppBar } from '@ui/app-bar';
import { safeUrl } from './utils/safeUrl.js';
import { navigate, useRoute } from './router/useRoute.js';
import { pathTo } from './router/routes.js';
import { ShellHeader, ShellSideNav, ShellTabs } from './shell/ShellChrome.jsx';
import { OverviewStatus } from './shell/OverviewStatus.jsx';
import { clearOverviewFilter, useOverviewFilter } from './shell/overviewFilter.js';
import { PHONE_TABS, appsOf, navGroups, paletteAppsOf } from './shell/nav.js';
import { useMediaQuery } from './shell/useMediaQuery.js';
import { alertsBadge } from './shell/statusView.js';
import { useStatusStale } from './shell/statusFreshness.js';
import { OverviewLayout } from './shell/OverviewLayout.jsx';
import { dropDeadKeys, sectionShown } from './shell/overviewSections.js';
import { useEntityParam } from './shell/entityNav.js';
import { preloadPhoneDetail } from './shell/preloadPhoneDetail.js';
import { entityFor } from './phone/nav/entityRoute.js';
import {
  loadAlertsPage,
  loadAppFrames,
  loadEntityDrawer,
  loadAccessExpired,
  loadInfrastructurePage,
  loadLaunchPage,
  loadPhoneView,
  loadServicesPage,
  loadSettingsView,
  loadSetupWizard,
} from './lazyViews.js';

// Settings (its index and sections), the app frames and the Alerts and Launch pages aren't
// needed for the default Overview render — code-split them so they don't weigh
// down the initial bundle. Their loaders live in lazyViews.js.
const AppFrames = lazy(loadAppFrames);
const SettingsView = lazy(loadSettingsView);
const AlertsPage = lazy(loadAlertsPage);
const LaunchPage = lazy(loadLaunchPage);
// From 768px, the Services and Infrastructure pages (#313); below, the phone's tabs.
const ServicesPage = lazy(loadServicesPage);
const InfrastructurePage = lazy(loadInfrastructurePage);
// Below 768px the shared phone screens (#303), a chunk only a phone loads.
const PhoneView = lazy(loadPhoneView);
// A fresh install's guided setup (#322), in the Overview's place until it is done.
const SetupWizard = lazy(loadSetupWizard);
// From 768px, the detail drawer of the entity the URL names (#309).
const EntityDrawer = lazy(loadEntityDrawer);
// Cloudflare Access wants a sign-in again (#653): a notice with a Reload.
const AccessExpired = lazy(loadAccessExpired);
import {
  apiFetch,
  setAuthToken as setApiAuthToken,
  initAuthToken,
  setReadOnlyServer,
  setAuthExpiredHandler,
  setAccessExpiredHandler,
  BOOT_CHECK_TIMEOUT_MS,
  isAccessRedirect,
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
  // Cloudflare Access's session ended (#653): the notice (lazy: nothing unless it is needed).
  const [accessExpired, setAccessExpired] = useState(false);
  useEffect(() => {
    setAccessExpiredHandler(() => setAccessExpired(true));
    return () => setAccessExpiredHandler(null);
  }, []);
  const accessNotice = accessExpired ? (
    <Suspense fallback={null}>
      <AccessExpired />
    </Suspense>
  ) : null;

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
        // Not followed through Access, and not waited for past a timeout (#653).
        const r = await apiFetch('/api/auth/check', {
          redirect: 'manual',
          signal: AbortSignal.timeout(BOOT_CHECK_TIMEOUT_MS),
        });
        if (isAccessRedirect(r)) {
          if (!cancelled) setAccessExpired(true);
          return;
        }
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
  if (authRequired === null) return accessNotice; // Loading, or Access wants a sign-in
  if (authRequired && !authed) {
    const stored = readStoredConfig();
    return (
      <>
        {accessNotice}
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
      {accessNotice}
      <AppMain authRequired={authRequired} demo={demo} onLogout={handleLogout} theme={theme} />
    </OverlayProvider>
  );
}

// The Overview stays mounted on other pages, out of sight (it keeps what it
// last read), so returning to it is instant: its sections draw their last
// readings at once, and nothing moves while the refresh comes in.
const OUT_OF_SIGHT = { visibility: 'hidden', height: 0, overflow: 'hidden' };

/** The pages the nav lists, as the command palette offers them (routes.js). */
const PAGES = [
  { id: 'overview', label: 'Overview', href: pathTo('overview') },
  { id: 'services', label: 'Services', href: pathTo('services') },
  { id: 'infrastructure', label: 'Infrastructure', href: pathTo('infrastructure') },
  { id: 'alerts', label: 'Alerts', href: pathTo('alerts') },
  { id: 'launch', label: 'Launch', href: pathTo('launch') },
  { id: 'settings', label: 'Settings', href: pathTo('settings') },
];

/** The instance's name in the header: the stock 'JAGHELM' reads as the product's name. */
function instanceName(title) {
  const t = typeof title === 'string' ? title.trim() : '';
  return t && t !== 'JAGHELM' ? t : 'JagHelm';
}

function AppMain({ authRequired, demo, onLogout, theme: { theme, shown, setTheme } }) {
  const toast = useToast();
  // A phone's window (below 768px, the shell's own breakpoint): the phone
  // screens (#303), and the phone's own pages (Services, Infrastructure).
  const phone = useMediaQuery(PHONE_WIDTH);
  // The URL is the page (src/router, #296): a deep link, Back and Forward, a
  // reload and a chunk reload after a deploy all land where it says.
  const { route, params } = useRoute({ phone });
  // The entity open over the page (#309): its id in the URL's `?entity=`. From
  // 768px the drawer draws it; below, the phone screens' sheet.
  const entityId = useEntityParam();
  const [tick, setTick] = useState(0);
  // Start with localStorage for instant render; the server fetch overrides it.
  // `migrate` upgrades the legacy `jagnet-config` key to the current one.
  const [config, setConfig] = useState(() => readStoredConfig({ migrate: true }));
  // Whether the server's config has loaded (or failed to): until then an app
  // the browser's copy lacks may still be on its way.
  const [configLoaded, setConfigLoaded] = useState(false);
  const stopRef = useRef(null);

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
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  // Display-config save/load (localStorage + debounced server save,
  // flush-on-unload, authoritative server load on mount). The demo refuses
  // writes, so nothing is sent to it: no save fails and no toast shows on load.
  const savedConfig = useConfigPersistence(config, setConfig, setTheme, toast, {
    readOnly: demo,
    onLoaded: () => setConfigLoaded(true),
  });

  // The keys an older JagHelm saved that nothing reads (#307: Widgets' dead
  // "Show checklist panel"; #306: the old board's layout and panels), dropped
  // whichever way the config came: this browser's copy, the server's, or a
  // Backup import. The next save sends the config without them. An updater,
  // so a change another effect queued in the same commit isn't lost.
  useEffect(() => {
    if (dropDeadKeys(config) !== config) setConfig(dropDeadKeys);
  }, [config]);

  // Apply config to the document as CSS custom properties
  // (accent/opacity/font family/font sizes/blur).
  useThemeVars(config);
  // Units and locale (#322, #260): the one formatting module reads the config's.
  setFormatting(config);

  const intervalMs = (config.refreshInterval || 30) * 1000;
  // The header's status: /api/status once an interval, paused while the browser
  // tab is hidden (useStatus). It replaced the dashboard's health dot.
  const poll = useStatus({ intervalMs });

  // One tick = one round of the Overview's reads (OverviewBoard, and the rail's
  // Pipeline on its ticks: tickBudget.js), only while the Overview is on
  // screen: not in a hidden browser tab, and not on another page (the Overview
  // stays mounted there, out of sight). The board loads on mount and
  // refreshes at once when it becomes active. On a phone the tick is the
  // phone screens' instead, on any of the four tabs they draw; from 768px on
  // the Services or Infrastructure page (#313), that page's, which reads as
  // the Overview's sections do while the board reads nothing.
  const doRefresh = useCallback(() => setTick((t) => t + 1), []);
  const pageVisible = usePageVisible();
  const onOverview = route.id === 'overview';
  // A fresh install's guided setup (#322) stands in the Overview's place until it is done or skipped.
  const setup = useSetup({ enabled: !demo });
  const guided = setup.pending && onOverview;
  const phoneScreen = phone && PHONE_TABS.includes(route.id);
  const listPage = !phone && (route.id === 'services' || route.id === 'infrastructure');
  const dashboardActive = (phone ? phoneScreen : onOverview) && pageVisible;
  const listPageActive = listPage && pageVisible;
  const ticking = dashboardActive || listPageActive;
  // The subsystem the Overview is filtered to (#298): the URL's `?subsystem=`,
  // when the model's strip shows it. The phone's strip filters nothing.
  const overviewFilter = useOverviewFilter(poll.status, onOverview && !phone);
  const filter = onOverview && !phone ? overviewFilter : null;

  // Set up refresh interval — debounced so slider dragging doesn't spam intervals
  useEffect(() => {
    if (!ticking) return;
    // The tick follows the server's cycle (pollSchedule.js, #630) and falls
    // back to every intervalMs without its hint.
    const timer = setTimeout(() => {
      stopRef.current = startPhaseLock({ fire: doRefresh, intervalMs, retry: false });
    }, 500); // Wait 500ms after last intervalMs change before setting the timer
    return () => {
      clearTimeout(timer);
      if (stopRef.current) stopRef.current();
      stopRef.current = null;
    };
  }, [doRefresh, intervalMs, ticking]);

  // The embedded apps (#269): an app mounts on its first visit and stays
  // loaded, hidden, after, up to MAX_LOADED_APPS (useAppFrames).
  const apps = useMemo(() => appsOf(config.tabs), [config.tabs]);
  const appId = route.id === 'app' ? params.id : null;
  const openApp =
    appId == null ? null : (apps.find((a) => String(a.id) === appId && !a.newTab) ?? null);
  // "Show it anyway" on a blocked app (#445): the same tab flag Settings → Apps &
  // links sets, saved through the config like any other change.
  const setEmbedAnyway = useCallback(
    (id, on) => setConfig((prev) => withEmbedAnyway(prev, id, on)),
    []
  );
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
  const paletteApps = useMemo(() => paletteAppsOf(apps), [apps]);

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

  // Each page names the browser tab, so history entries tell apart; an open
  // entity, by its name.
  const name = instanceName(config.title);
  const entityName = entityId ? entityFor(poll.status, entityId)?.name : null;
  const pageTitle = entityName || (route.id === 'app' ? openApp?.label : route.title);
  useEffect(() => {
    document.title = pageTitle ? `${pageTitle} — ${name}` : name;
  }, [pageTitle, name]);

  // The new UI's roots draw the theme shown (system's is the device's), and
  // the accent and density the display config picks (#321).
  const appearance = useAppearance(config, setConfig, configLoaded);
  const switches = useMemo(() => ({ theme: shown, ...appearance }), [shown, appearance]);

  // The drawer's chunk loads with the first entity opened from 768px.
  const [entityDrawerUsed, setEntityDrawerUsed] = useState(false);
  if (!entityDrawerUsed && entityId && !phone) setEntityDrawerUsed(true);
  // On a phone, an entity in the URL as the app starts (a deep link, a push):
  // its detail's chunk beside the screens', not after them (#309).
  useEffect(() => {
    if (phone && entityId) preloadPhoneDetail();
  }, [phone, entityId]);

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
              phone={phone}
              onOpenPalette={openPalette}
              onThemeChange={setTheme}
              onLogout={logout}
            />
          }
          sidebar={<ShellSideNav groups={groups} />}
          tabs={<ShellTabs groups={groups} routeId={route.id} badge={badge} onLogout={logout} />}
        >
          {/* Below 768px the phone screens, drawn only there (#303). */}
          {phone && (
            <Suspense fallback={null}>
              {phoneScreen && !guided && (
                <PhoneView
                  screen={route.id}
                  status={poll.status}
                  reach={poll.reach}
                  updated={poll.updated}
                  tick={tick}
                  active={dashboardActive}
                  refreshIntervalMs={intervalMs}
                  linkTarget={config.linkTarget}
                />
              )}
            </Suspense>
          )}
          {!phone && (
            <div style={onOverview && !guided ? undefined : OUT_OF_SIGHT}>
              <h1 className="sr-only">Overview</h1>
              {/* From 1440px, the utilities rail beside the sections (#301). */}
              <OverviewLayout open={onOverview} tick={tick}>
                {/* Its state is the poll's: nothing to keep while another page is open. */}
                {onOverview && (
                  <OverviewStatus
                    status={poll.status}
                    reach={poll.reach}
                    updated={poll.updated}
                    filter={filter?.id ?? null}
                    showStrip={sectionShown(config, 'strip')}
                  />
                )}
                <OverviewBoard
                  tick={tick}
                  active={dashboardActive}
                  onOpenSettings={openSettings}
                  filter={filter}
                  onClearFilter={clearOverviewFilter}
                  status={poll.status}
                  reach={poll.reach}
                  updated={poll.updated}
                />
              </OverviewLayout>
            </div>
          )}
          {guided && (
            <Suspense fallback={lazyFallback}>
              <SetupWizard
                status={poll.status}
                reach={poll.reach}
                updated={poll.updated}
                onDone={setup.done}
              />
            </Suspense>
          )}
          <Suspense fallback={lazyFallback}>
            {route.id === 'alerts' && !phone && (
              <AlertsPage status={poll.status} reach={poll.reach} updated={poll.updated} />
            )}
          </Suspense>
          <Suspense fallback={lazyFallback}>{route.id === 'launch' && <LaunchPage />}</Suspense>
          {/* From 768px; below it the phone screens draw the same two addresses. */}
          <Suspense fallback={lazyFallback}>
            {listPage && route.id === 'services' && (
              <ServicesPage
                status={poll.status}
                reach={poll.reach}
                updated={poll.updated}
                tick={tick}
                active={listPageActive}
                refreshIntervalMs={intervalMs}
              />
            )}
            {listPage && route.id === 'infrastructure' && (
              <InfrastructurePage
                status={poll.status}
                reach={poll.reach}
                updated={poll.updated}
                tick={tick}
                active={listPageActive}
                refreshIntervalMs={intervalMs}
              />
            )}
          </Suspense>
          {/* From 768px, the entity the URL names, over the page (#309): loaded on
              the first one, then kept, so it closes as it opened. */}
          {entityDrawerUsed && (
            <Suspense fallback={null}>
              <EntityDrawer
                id={phone ? null : entityId}
                status={poll.status}
                reach={poll.reach}
                updated={poll.updated}
                intervalMs={intervalMs}
              />
            </Suspense>
          )}
          <Suspense fallback={lazyFallback}>
            {route.id === 'settings' && (
              <SettingsView
                theme={theme}
                setTheme={setTheme}
                section={params.section}
                onSectionChange={onSectionChange}
                status={poll.status}
                reach={poll.reach}
                updated={poll.updated}
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
                <AppFrames frames={frames} savedTabs={savedConfig?.tabs} onEmbedAnyway={setEmbedAnyway} />
              </Suspense>
            )}
          </ShellApps>
        </AppShell>
        {/* What it finds is the poll's status, the config and the pages (#315). */}
        <CommandPalette
          open={paletteOpen}
          onClose={closePalette}
          switches={switches}
          pages={PAGES}
          apps={paletteApps}
          status={poll.status}
          stale={statusStale}
          onNavigate={navigate}
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
