/**
 * The shell's chrome, wired (#296): the header, the sidebar and the phone's
 * tabs, drawn by src/ui/ and fed from the router, the config and the status
 * poll (useStatus). Each is memoised on what it shows, so the dashboard's
 * tick re-renders none of them, and the status poll's "updated" clock
 * re-renders only ShellUpdated. Without a signal, the header says what was
 * last known and how long ago, by the one rule for a stale status
 * (statusFreshness.js, #480); only then does its age tick the header. A
 * status stale by its age (no answer for too long, the poll's reach still
 * 'ok') reaches AppHeader as 'expired', so it says No signal too.
 */
import { Suspense, lazy, memo, useMemo, useState, useSyncExternalStore } from 'react';
import { AppHeader, UpdatedAgo } from '@ui/app-header';
import { BottomTabs } from '@ui/bottom-tabs';
import { SideNav } from '@ui/side-nav';
import { loadMoreSheet } from '../lazyViews.js';
import { followLink } from '../router/useRoute.js';
import { prefs } from '../storage/index.js';
import { phoneTabs } from './nav.js';
import { drawnState, statusBuiltAt, useStatusFreshness } from './statusFreshness.js';
import { lastKnownLine } from './statusView.js';

const MoreSheet = lazy(loadMoreSheet);

/** Where the sidebar's collapsed state is kept, per browser. */
export const SIDEBAR_PREF = 'jaghelm-sidebar';

/** "⌘K" on Apple platforms, "Ctrl K" elsewhere. */
function shortcutLabel() {
  const platform = globalThis.navigator?.userAgentData?.platform ?? globalThis.navigator?.platform;
  return /mac|iphone|ipad/i.test(platform ?? '') ? '⌘K' : 'Ctrl K';
}

/**
 * "Updated 12 s ago", from the poll's store: the one part of the header an
 * answer re-renders. The status's age, by the same time as "last known"
 * (statusBuiltAt, #499): when the server built it, else when it came.
 */
function ShellUpdated({ store }) {
  const at = useSyncExternalStore(store.subscribe, () => statusBuiltAt(store));
  return <UpdatedAgo at={at} />;
}

export const ShellHeader = memo(function ShellHeader({
  name,
  logoUrl,
  status,
  reach,
  updated,
  routeId,
  onOpenPalette,
  onLogout,
}) {
  const updatedEl = useMemo(() => <ShellUpdated store={updated} />, [updated]);
  const freshness = useStatusFreshness({ status, reach, updated });
  const said = useMemo(
    () => ({
      reach: freshness.reach ?? reach,
      state: drawnState(status?.overall?.state, freshness),
      sentence: status?.overall?.sentence,
      lastKnown: lastKnownLine(freshness, status) ?? undefined,
      href: '/alerts',
      current: routeId === 'alerts',
    }),
    [reach, status, routeId, freshness]
  );
  const shortcut = useMemo(shortcutLabel, []);
  return (
    <AppHeader
      name={name || 'JagHelm'}
      logoUrl={logoUrl || undefined}
      status={said}
      updated={updatedEl}
      onOpenPalette={onOpenPalette}
      shortcut={shortcut}
      settingsCurrent={routeId === 'settings'}
      onLogout={onLogout}
      onNavigate={followLink}
    />
  );
});

export const ShellSideNav = memo(function ShellSideNav({ groups }) {
  const [collapsed, setCollapsed] = useState(() => prefs.get(SIDEBAR_PREF) === 'collapsed');
  const change = (next) => {
    setCollapsed(next);
    prefs.set(SIDEBAR_PREF, next ? 'collapsed' : null);
  };
  return (
    <SideNav
      groups={groups}
      collapsed={collapsed}
      onCollapsedChange={change}
      onNavigate={followLink}
    />
  );
});

export const ShellTabs = memo(function ShellTabs({ groups, routeId, badge }) {
  const [moreOpen, setMoreOpen] = useState(false);
  // The sheet loads on the first open, and stays, so it can close as it opened.
  const [moreUsed, setMoreUsed] = useState(false);
  const openMore = () => {
    setMoreUsed(true);
    setMoreOpen(true);
  };
  const tabs = phoneTabs({ routeId, badge, onMore: openMore, moreOpen });
  return (
    <>
      <BottomTabs tabs={tabs} onNavigate={followLink} />
      {moreUsed && (
        <Suspense fallback={null}>
          <MoreSheet groups={groups} open={moreOpen} onOpenChange={setMoreOpen} />
        </Suspense>
      )}
    </>
  );
});
