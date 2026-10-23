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
import { useLayoutEffect, useMemo, useRef } from 'react';
import { ShellPage } from '@ui/app-shell';
import Overview from '../phone/views/Overview.jsx';
import Services from '../phone/views/Services.jsx';
import Infra from '../phone/views/Infra.jsx';
import Alerts from '../phone/views/Alerts.jsx';
import ServiceDetail from '../phone/views/ServiceDetail.jsx';
import NodeDetail from '../phone/views/NodeDetail.jsx';
import IncidentDetail from '../phone/views/IncidentDetail.jsx';
import { PhonePlatform } from '../phone/platform.js';
import { SheetContext } from '../phone/sheet.js';
import { useDashboardData } from '../views/DashboardView/useDashboardData.js';
import { safeUrl } from '../utils/safeUrl.js';
import { useStatusFreshness } from './statusFreshness.js';
import { usePhoneNav } from './phoneNav.js';

/** The tabs' screens, by route. */
const TABS = { overview: Overview, services: Services, infrastructure: Infra, alerts: Alerts };
/** The details a screen pushes, by the name it pushes. */
const DETAILS = { serviceDetail: ServiceDetail, node: NodeDetail, incident: IncidentDetail };
/** What the screens read beside the status: the cards and the UPS. */
const SOURCES = ['services', 'ups'];

/**
 * The screens' `data` from the web's parts: the poll's status, reach and
 * clock, their freshness, and the board's cards and UPS (`board`, from
 * useDashboardData). `loading` until /api/services has answered once;
 * `error`, its read failing; `servicesBody` the last cards it had, or none
 * while it has never answered.
 */
export function phoneData({ status, reach, updated, freshness, board }) {
  const error = board.sources?.services?.error ?? null;
  const nodes = Object.keys(board.serviceData?.nodes ?? {}).length;
  return {
    status,
    reach,
    updated,
    freshness,
    servicesBody: board.servicesLoaded && (nodes > 0 || !error) ? board.serviceData : null,
    ups: board.ups,
    loading: !board.servicesLoaded,
    error,
  };
}

/** Opens `target` (a screen's `{ kind, uid, url }`) as the web's links open. */
export function openTarget(target, linkTarget = '_blank') {
  const href = safeUrl(target?.url);
  if (!href) return;
  if (linkTarget === '_self') window.location.assign(href);
  else window.open(href, '_blank', 'noopener,noreferrer');
}

/**
 * One detail over the tab: a full-screen modal dialog (the browser's own,
 * in the top layer, the page under it inert), named by the screen's title.
 * Escape asks to close it (`onClose`), as its Back does.
 */
function PhoneSheet({ index, onClose, children }) {
  const ref = useRef(null);
  const titleId = `phone-sheet-${index}-title`;
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    };
  }, []);
  const sheet = useMemo(() => ({ titleId }), [titleId]);
  return (
    <dialog
      ref={ref}
      data-slot="phone-sheet"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto overscroll-contain border-0 bg-background p-0 text-text-1"
    >
      <SheetContext.Provider value={sheet}>{children}</SheetContext.Provider>
    </dialog>
  );
}

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
  const { serviceData, ups, servicesLoaded, sources } = board;
  const data = useMemo(
    () =>
      phoneData({
        status,
        reach,
        updated,
        freshness,
        board: { serviceData, ups, servicesLoaded, sources },
      }),
    [status, reach, updated, freshness, serviceData, ups, servicesLoaded, sources]
  );
  const nav = usePhoneNav(screen);
  const platform = useMemo(() => ({ openTarget: (t) => openTarget(t, linkTarget) }), [linkTarget]);
  const Tab = TABS[screen] ?? Overview;
  return (
    <PhonePlatform value={platform}>
      <ShellPage data-slot="phone-view" className="px-4 pt-3 pb-6">
        <Tab data={data} nav={nav} params={{}} />
        {nav.details.map((entry, i) => {
          const Detail = DETAILS[entry.screen];
          if (!Detail) return null;
          return (
            // A detail keeps its place on the stack: the one under it stays drawn.
            <PhoneSheet key={i} index={i} onClose={nav.pop}>
              <Detail data={data} nav={nav} params={entry.params} />
            </PhoneSheet>
          );
        })}
      </ShellPage>
    </PhonePlatform>
  );
}
