import React, { useState, useEffect } from 'react';
import { App } from '@capacitor/app';
import { TABS } from './TABS.js';
import { LAST_TAB_KEY } from './runtimeConfig.js';
import { getPref, setPref } from './storage/prefsAdapter.js';
import Overview from './views/Overview.jsx';
import Services from './views/Services.jsx';
import Infra from './views/Infra.jsx';
import Alerts from './views/Alerts.jsx';
import './MobileApp.css';

const VIEWS = { overview: Overview, services: Services, infra: Infra, alerts: Alerts };

export default function MobileApp() {
  const [active, setActive] = useState('overview');

  // Restore the last tab from Preferences (non-secret UI state).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const last = await getPref(LAST_TAB_KEY);
      if (!cancelled && last && VIEWS[last]) setActive(last);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Hardware back: a tab root exits the app (the back stack is per-tab; deep
  // navigation arrives in Phase 3). Spec: exitApp() only at a tab root.
  useEffect(() => {
    const handle = App.addListener('backButton', () => {
      App.exitApp();
    });
    return () => {
      // listener handles return either a promise<{remove}> or {remove}
      Promise.resolve(handle).then((h) => h && h.remove && h.remove());
    };
  }, []);

  const onTab = (id) => {
    setActive(id);
    setPref(LAST_TAB_KEY, id);
  };

  const ActiveView = VIEWS[active];

  return (
    <div id="mobile-root">
      <main className="mobile-content">
        <ActiveView />
      </main>
      <nav className="mobile-tabbar" role="tablist" aria-label="Primary">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            onClick={() => onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
