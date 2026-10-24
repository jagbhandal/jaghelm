/**
 * The pending host steps (#673), the Overview's section after Services (it
 * moves and hides in Edit layout like the others, `hostActions`) and the same
 * list on the phone's Overview. Its own chunk (lazyViews.js, loadHostActions),
 * asked for through HostActionsSlot when either Overview draws it; it reads
 * /api/host-actions itself (hostActions.js), so a page that never draws it
 * never asks.
 *
 * Draws nothing until there is something to say (hostActionsView): no Gitea,
 * not read yet, or no step open. Each row links to its PR or issue in Gitea.
 * Read-only; nothing here alerts or changes a status. The drawing is the design
 * system's (src/ui/host-actions.jsx).
 */
import { memo } from 'react';
import { HostActions as HostActionsView } from '@ui/host-actions';
import { hostActionsView, useHostActions } from './hostActions.js';

// The phone's list is short: three rows, then the link to the rest.
const PHONE_ROWS = 3;

/**
 * `phone`: the phone Overview's list section; otherwise the desktop section
 * (lined up with the others by `margin`).
 */
export default memo(function HostActions({ phone = false, margin = 16, active = true }) {
  const view = hostActionsView(useHostActions({ active }));
  if (!view) return null;
  return (
    <HostActionsView view={view} phone={phone} margin={margin} limit={phone ? PHONE_ROWS : 0} />
  );
});
