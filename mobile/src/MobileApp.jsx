import React, { useState, useEffect, useRef } from 'react';
import { App } from '@capacitor/app';
import { TABS } from './TABS.js';
import { LAST_TAB_KEY } from './runtimeConfig.js';
import { getPref, setPref } from './storage/prefsAdapter.js';
import { useNavStack } from './nav/useNavStack.js';
import { useDashboard } from './data/useDashboard.js';
import Overview from './views/Overview.jsx';
import Services from './views/Services.jsx';
import Infra from './views/Infra.jsx';
import Alerts from './views/Alerts.jsx';
import './MobileApp.css';

const VIEWS = { overview: Overview, services: Services, infra: Infra, alerts: Alerts };
const ROOT = { overview: { screen: 'overview' }, services: { screen: 'services' }, infra: { screen: 'infra' }, alerts: { screen: 'alerts' } };

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
      if (!cancelled && last && VIEWS[last]) { setActive(last); nav.reset(ROOT[last]); }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Hardware back: pop a pushed detail first; only exit at a tab root.
  useEffect(() => {
    const handle = App.addListener('backButton', () => {
      if (navRef.current.canPop) navRef.current.pop();
      else App.exitApp();
    });
    return () => { Promise.resolve(handle).then((h) => h && h.remove && h.remove()); };
  }, []);

  const onTab = (id) => {
    setActive(id);
    nav.reset(ROOT[id]); // intra-tab detail stack resets on tab change
    setPref(LAST_TAB_KEY, id);
  };

  const ActiveView = VIEWS[active];

  return (
    <div id="mobile-root">
      <main className="mobile-content">
        <ActiveView nav={nav} data={data} />
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
