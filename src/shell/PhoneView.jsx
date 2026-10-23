/**
 * The web on a phone (#303, spec §8 "Phone width"): below 768px it draws the
 * phone screens the Android app draws, from the same code (src/phone/), in
 * the web's look, under the shell's header and above its tabs (Overview,
 * Services, Infrastructure, Alerts; More holds the rest). Today's board and
 * the desktop Overview aren't drawn on a phone. Its own chunk, loaded only
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
 *  - `nav`: the shared nav stack, a history entry per detail (phoneNav.js).
 *    Each detail is drawn over the tab as a full-screen sheet, a modal
 *    dialog named by its title: Escape, its Back and the browser's Back
 *    close it, and focus returns to the row that opened it.
 *  - the platform (src/phone/platform.js): Open goes where the web's links
 *    go, a new tab or this one, as Settings → Layout says (`linkTarget`).
 */
import { Suspense, lazy, useMemo } from 'react';
import Overview from '../phone/views/Overview.jsx';
import Services from '../phone/views/Services.jsx';
import Infra from '../phone/views/Infra.jsx';
import Alerts from '../phone/views/Alerts.jsx';
import { PhonePlatform } from '../phone/platform.js';
import { PhonePage, PhoneSheet } from '../phone/components/PhoneSheet.jsx';
import { useDashboardData } from '../views/DashboardView/useDashboardData.js';
import { useStatusFreshness } from './statusFreshness.js';
import { usePhoneNav } from './phoneNav.js';
import { openTarget, phoneData } from './phoneData.js';
import { loadPhoneDetail } from '../lazyViews.js';

/** The tabs' screens, by route. */
const TABS = { overview: Overview, services: Services, infrastructure: Infra, alerts: Alerts };
/**
 * The details a screen pushes, by the name it pushes (PhoneDetail.jsx): a
 * chunk of their own, loaded with the first one opened (#309).
 */
const DETAILS = new Set(['serviceDetail', 'node', 'incident']);
const PhoneDetail = lazy(loadPhoneDetail);
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
  const platform = useMemo(() => ({ openTarget: (t) => openTarget(t, linkTarget) }), [linkTarget]);
  const Tab = TABS[screen] ?? Overview;
  return (
    <PhonePlatform value={platform}>
      <PhonePage>
        <Tab data={data} nav={nav} params={{}} />
        {nav.details.map((entry, i) => {
          if (!DETAILS.has(entry.screen)) return null;
          return (
            // A detail keeps its place on the stack: the one under it stays drawn.
            <PhoneSheet key={i} index={i} onClose={nav.pop}>
              <Suspense fallback={null}>
                <PhoneDetail screen={entry.screen} data={data} nav={nav} params={entry.params} />
              </Suspense>
            </PhoneSheet>
          );
        })}
      </PhonePage>
    </PhonePlatform>
  );
}
