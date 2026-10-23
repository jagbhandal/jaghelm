import React, { useState, useEffect, useMemo, useRef } from 'react';
import { App } from '@capacitor/app';
import { TABS } from './TABS.js';
import { LAST_TAB_KEY } from './runtimeConfig.js';
import { getPref, setPref } from './storage/prefsAdapter.js';
import { useNavStack } from '@shared/phone/nav/useNavStack.js';
import { useDashboard } from './data/useDashboard.js';
import { annunciatorOf, withServerCause } from '@shared/phone/data/board.js';
import { useStatusFreshness } from '@shared/shell/statusFreshness.js';
import Overview from '@shared/phone/views/Overview.jsx';
import Services from '@shared/phone/views/Services.jsx';
import Infra from '@shared/phone/views/Infra.jsx';
import Alerts from '@shared/phone/views/Alerts.jsx';
import ServiceDetail from '@shared/phone/views/ServiceDetail.jsx';
import NodeDetail from '@shared/phone/views/NodeDetail.jsx';
import IncidentDetail from '@shared/phone/views/IncidentDetail.jsx';
import NotificationSettings from './views/NotificationSettings.jsx';
import RefreshStatus from './components/RefreshStatus.jsx';
import { initPush } from './push/registerPush.js';
import { PhonePlatform } from '@shared/phone/platform.js';
import { ANDROID_PLATFORM } from './platform.js';
// MobileApp.css loads through styles/legacy.css, in the `legacy` cascade layer.

const SCREENS = {
  overview: Overview, services: Services, infra: Infra, alerts: Alerts,
  serviceDetail: ServiceDetail, node: NodeDetail, incident: IncidentDetail,
  notificationSettings: NotificationSettings,
};
const ROOT = { overview: { screen: 'overview' }, services: { screen: 'services' }, infra: { screen: 'infra' }, alerts: { screen: 'alerts' } };

export default function MobileApp() {
  const [active, setActive] = useState('overview');
  const nav = useNavStack(ROOT.overview);
  const dashboard = useDashboard();
  // Whether the status is current, by the web's one rule (#480): the poll's
  // reach, or no answer for longer than two polls and the request timeout.
  // Every screen draws a stale status's states as no signal. A server older
  // than the status model (a 404) says so, not "Can't reach JagHelm".
  const seen = useStatusFreshness({
    status: dashboard.status,
    reach: dashboard.reach,
    updated: dashboard.updated,
  });
  const freshness = useMemo(() => withServerCause(seen, dashboard.reach), [seen, dashboard.reach]);
  const data = { ...dashboard, freshness };
  // Keep a live ref so the single back listener always sees current nav/active.
  const navRef = useRef(nav); navRef.current = nav;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const last = await getPref(LAST_TAB_KEY);
      if (!cancelled && last && ROOT[last]) { setActive(last); navRef.current.reset(ROOT[last]); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Hardware back: pop a pushed detail first; only exit at a tab root.
  useEffect(() => {
    const handle = App.addListener('backButton', () => {
      if (navRef.current.canPop) navRef.current.pop();
      else App.exitApp();
    });
    return () => { Promise.resolve(handle).then((h) => h && h.remove && h.remove()); };
  }, []);

  // Phase 5: register for push once the app is in the connected state (MobileApp
  // only mounts when configured===true, so base URL + auth token are live). Push
  // depends on a configured backend + Android runtime permission, so it belongs
  // here, NOT in boot.js. nav drives deep-link routing from a tapped push.
  useEffect(() => {
    // initPush self-contains its failures (build-config gate + try/catch); the
    // .catch is a final guard so a push fault can never surface here.
    initPush({ nav: navRef.current }).catch(() => {});
  }, []);

  const onTab = (id) => {
    setActive(id);
    nav.reset(ROOT[id]); // intra-tab detail stack resets on tab change
    setPref(LAST_TAB_KEY, id);
  };

  const Screen = SCREENS[nav.current.screen] || SCREENS[active];

  // The pinned annunciator: the status model's overall state and sentence;
  // stale, no signal and why (a live fetch error is RefreshStatus's own
  // "Can't reach JagHelm", Bug #4).
  const said = annunciatorOf({ status: data.status, freshness });

  return (
    <div id="mobile-root">
      <RefreshStatus
        state={said.state}
        summary={said.sentence}
        lastUpdated={data.lastUpdated}
        intervalMs={data.intervalMs}
        error={data.error}
        loading={data.loading}
        foreground={data.foreground}
        onRefresh={data.refresh}
      />
      <main className="mobile-content">
        {/* The screens are the shared ones (src/phone/), given what they need of
            the phone: opening a service's address (#303). */}
        <PhonePlatform value={ANDROID_PLATFORM}>
          <Screen nav={nav} data={data} params={nav.current.params} />
        </PhonePlatform>
      </main>
      <nav className="mobile-tabbar" role="tablist" aria-label="Primary">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={active === t.id} onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
