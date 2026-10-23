/**
 * What the web gives the phone screens (#303, PhoneView.jsx): their `data`,
 * from the web's own parts, and what Open does.
 */
import { safeUrl } from '../utils/safeUrl.js';

/**
 * The screens' `data` from the web's parts: the poll's status, reach and
 * clock, their freshness, and the board's cards (`board`, from
 * useDashboardData). `loading` until /api/services has answered once;
 * `error`, its read failing; `servicesBody` the last cards it had, or none
 * while it has never answered. No `ups`: the model carries the UPS's runtime
 * (#549), load, model and runtime on mains (#586), and the web is always
 * served by its own server, so neither the screens nor the UPS's sheet ever
 * need /api/ups (board.js upsReadingsOf, detail/entityExtras.js).
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
