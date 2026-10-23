/**
 * The web on a phone (#303, spec §8 "Phone width"): below 768px it draws the
 * phone screens the Android app draws, from the same code (src/phone/), in
 * the web's look, under the shell's header and above its tabs (Overview,
 * Services, Infrastructure, Alerts; More holds the rest). The desktop
 * Overview isn't drawn on a phone. Its own chunk, loaded only
 * below 768px (lazyViews.js), so a desktop's first load doesn't carry it.
 *
 * The screens get what the Android app gives them, from the web's own parts:
 *
 *  - `data`: the header's poll of /api/status (useStatus: the status, its
 *    reach and clock) judged fresh or stale by the one rule
 *    (statusFreshness.js), and the cards of /api/services and the UPS's
 *    readings, read as the board reads them (useDashboardData, only those
 *    two). Nothing here judges a state: the screens draw the model through
 *    src/phone/data/board.js, as on Android.
 *  - `after` (#578), under the Infrastructure tab's nodes: every scheduled
 *    job and backup (PhoneJobs.jsx, its own chunk, asked for when that tab
 *    draws). The Android app gives none: its look draws no list.
 *  - `nav`: the shared nav stack, a history entry per detail (phoneNav.js).
 *    Each detail is drawn over the tab as a full-screen sheet, a modal
 *    dialog named by its title: Escape, its Back and the browser's Back
 *    close it, and focus returns to the row that opened it.
 *  - the platform (src/phone/platform.js): Open goes where the web's links
 *    go, a new tab or this one, as Settings → Apps & links says (`linkTarget`).
 */
import { Suspense, lazy, useEffect, useMemo } from 'react';
import Overview from '../phone/views/Overview.jsx';
import Services from '../phone/views/Services.jsx';
import Infra from '../phone/views/Infra.jsx';
import Alerts from '../phone/views/Alerts.jsx';
import { PhonePlatform } from '../phone/platform.js';
import { PhonePage, PhoneSheet } from '../phone/components/PhoneSheet.jsx';
import { DetailLoading } from '../phone/components/DetailLoading.jsx';
import { useDashboardData } from './useDashboardData.js';
import { useStatusFreshness } from './statusFreshness.js';
import { usePhoneNav } from './phoneNav.js';
import { openTarget, phoneData } from './phoneData.js';
import { loadPhoneDetail, loadPhoneJobs } from '../lazyViews.js';
import { preloadPhoneDetail } from './preloadPhoneDetail.js';

/** The tabs' screens, by route. */
const TABS = { overview: Overview, services: Services, infrastructure: Infra, alerts: Alerts };
/**
 * The details a screen pushes, by the name it pushes, and the kind each sheet
 * says while it loads (PhoneDetail.jsx): a chunk of their own (#309), asked
 * for once the browser is idle after the screens draw, so the first detail
 * opened draws at once; until it is in, a sheet has its Back and "Loading…".
 */
const DETAILS = { serviceDetail: 'Service', node: 'Node', incident: 'Alert' };
const PhoneDetail = lazy(loadPhoneDetail);
const PhoneJobs = lazy(loadPhoneJobs);

/** Calls `fn` once the browser is idle (soon, where it can't say); returns what cancels it. */
function whenIdle(fn) {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(fn, { timeout: 3000 });
    return () => window.cancelIdleCallback?.(handle);
  }
  const timer = setTimeout(fn, 1500);
  return () => clearTimeout(timer);
}
/** What the screens read beside the status: the cards (the model has the UPS's readings, #549). */
const SOURCES = ['services'];

export default function PhoneView({
  screen,
  status,
  reach,
  updated,
  tick,
  active,
  refreshIntervalMs,
  linkTarget,
}) {
  const board = useDashboardData(0, { tick, active, refreshIntervalMs, only: SOURCES });
  const freshness = useStatusFreshness({ status, reach, updated });
  const { serviceData, servicesLoaded, sources } = board;
  const data = useMemo(
    () =>
      phoneData({
        status,
        reach,
        updated,
        freshness,
        board: { serviceData, servicesLoaded, sources },
      }),
    [status, reach, updated, freshness, serviceData, servicesLoaded, sources]
  );
  const nav = usePhoneNav(screen);
  // The detail screens' chunk, once the screens have drawn and the browser is idle.
  useEffect(() => whenIdle(preloadPhoneDetail), []);
  const platform = useMemo(() => ({ openTarget: (t) => openTarget(t, linkTarget) }), [linkTarget]);
  const Tab = TABS[screen] ?? Overview;
  return (
    <PhonePlatform value={platform}>
      <PhonePage>
        <Tab
          data={data}
          nav={nav}
          params={{}}
          after={
            screen === 'infrastructure' ? (
              <Suspense fallback={null}>
                <PhoneJobs data={data} nav={nav} />
              </Suspense>
            ) : null
          }
        />
        {nav.details.map((entry, i) => {
          if (!Object.hasOwn(DETAILS, entry.screen)) return null;
          return (
            // A detail keeps its place on the stack: the one under it stays drawn.
            <PhoneSheet key={i} index={i} onClose={nav.pop}>
              <Suspense fallback={<DetailLoading kind={DETAILS[entry.screen]} onBack={nav.pop} />}>
                <PhoneDetail
                  screen={entry.screen}
                  data={data}
                  nav={nav}
                  params={entry.params}
                  top={i === nav.details.length - 1}
                  intervalMs={refreshIntervalMs}
                />
              </Suspense>
            </PhoneSheet>
          );
        })}
      </PhonePage>
    </PhonePlatform>
  );
}
