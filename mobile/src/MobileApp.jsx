import React, { useState, useEffect, useRef } from 'react';
import { App } from '@capacitor/app';
import { TABS } from './TABS.js';
import { LAST_TAB_KEY } from './runtimeConfig.js';
import { getPref, setPref } from './storage/prefsAdapter.js';
import { useNavStack } from './nav/useNavStack.js';
import { useDashboard } from './data/useDashboard.js';
import { overallSeverity, flattenServices, worstCaution, pluralize } from './data/derive.js';
import Overview from './views/Overview.jsx';
import Services from './views/Services.jsx';
import Infra from './views/Infra.jsx';
import Alerts from './views/Alerts.jsx';
import ServiceDetail from './views/ServiceDetail.jsx';
import NodeDetail from './views/NodeDetail.jsx';
import IncidentDetail from './views/IncidentDetail.jsx';
import NotificationSettings from './views/NotificationSettings.jsx';
import RefreshStatus from './components/RefreshStatus.jsx';
import { initPush } from './push/registerPush.js';
import './MobileApp.css';

const SCREENS = {
  overview: Overview, services: Services, infra: Infra, alerts: Alerts,
  serviceDetail: ServiceDetail, node: NodeDetail, incident: IncidentDetail,
  notificationSettings: NotificationSettings,
};
const ROOT = { overview: { screen: 'overview' }, services: { screen: 'services' }, infra: { screen: 'infra' }, alerts: { screen: 'alerts' } };

/**
 * The pinned annunciator's mono status sentence (spec §7.1). Terse worst-of
 * phrasing with digits ("2 services down" / "All systems operational") — the
 * Overview hero (§7.2) carries the richer word-number headline. Error/loading
 * copy is owned by RefreshStatus; this only supplies the live-state sentence.
 * The caution precedence ladder + its wording live in derive.worstCaution so the
 * sentence and the hero headline format from one source.
 */
function annunciatorSummary(severity, { servicesBody, ups, cron }) {
  if (severity === 'critical') {
    const n = flattenServices(servicesBody).filter((s) => s.status === 'down').length;
    return `${n} ${pluralize(n, 'service')} down`;
  }
  if (severity === 'caution') {
    const worst = worstCaution({ services: servicesBody, ups, cron });
    return worst ? worst.headline : 'Degraded';
  }
  if (severity === 'healthy') return 'All systems operational';
  return 'No signal';
}

export default function MobileApp() {
  const [active, setActive] = useState('overview');
  const nav = useNavStack(ROOT.overview);
  const data = useDashboard();
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

  // Worst-of severity for the pinned annunciator. Bug #4: a live fetch error
  // means the (possibly stale) body can't be trusted, so thread
  // `unreachable = data.error != null` into overallSeverity — a mid-session
  // outage reads steel/unknown, never stale green.
  const unreachable = data.error != null;
  const severity = overallSeverity({ services: data.servicesBody, ups: data.ups, cron: data.cron, unreachable });
  const summary = annunciatorSummary(severity, { servicesBody: data.servicesBody, ups: data.ups, cron: data.cron });

  return (
    <div id="mobile-root">
      <RefreshStatus
        severity={severity}
        summary={summary}
        lastUpdated={data.lastUpdated}
        intervalMs={data.intervalMs}
        error={data.error}
        loading={data.loading}
        onRefresh={data.refresh}
      />
      <main className="mobile-content">
        <Screen nav={nav} data={data} params={nav.current.params} />
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
