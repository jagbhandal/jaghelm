/**
 * The Android app's detail history (#602): a node's sheet and a container's
 * (a service with one) draw the web drawer's charts, detail/HistoryCharts.jsx
 * (a node's Usage and Temperature, a container's CPU and Memory; 1 h, 24 h or
 * 7 d from GET /api/history), as the view's `charts` (MobileApp.jsx). The
 * range switch's segments are 44px targets for a thumb.
 *
 * What a sheet charts is the drawer's rule (data/historyTarget.js). The
 * Android look is the old screens' until Phase 4 (#326), so the charts sit in
 * a root of the new UI (UiRoot, dark as the app is), which carries their
 * tokens.
 *
 * Reads: one as the sheet opens, then at most one a minute on the status
 * poll's answers (useHistory.js, tickBudget.js's exception). A server older
 * than #311 has another /api/history: no charts and no error, and it isn't
 * asked again until the app restarts.
 */
import React from 'react';
import { UiRoot } from '@ui/root';
import { HistoryCharts } from '@shared/shell/detail/HistoryCharts.jsx';

/**
 * @param {{ target: { kind: string, entity: string }, updated?: any }} props
 *   `target`: what it charts (data/historyTarget.js); `updated`: the status
 *   poll's clock (useDashboard), whose answers pace the reads
 */
export function DetailHistory({ target, updated }) {
  return (
    <UiRoot>
      <HistoryCharts target={target} updated={updated} size="touch" />
    </UiRoot>
  );
}
