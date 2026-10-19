import { useMemo, useState } from 'react';

/**
 * Which source-fed panels (UPS, Pipeline) the board shows (#272).
 *
 * A panel shows when its source is configured, so a fresh install without a
 * UPS or a Gitea has no "Unknown" UPS card and no "Gitea unreachable" card.
 * Configured is decided from the display config first, then from what the
 * source's own endpoint says, never from whether its data is healthy:
 *
 *   1. The display config names the panel: the saved layout (`gridLayout`, any
 *      breakpoint) has it, or Settings → Sections switched it on
 *      (`sections.<key>.visible === true`). Every install from before #272 has
 *      both panels in its saved layout, so it keeps them whatever they report.
 *   2. Or the endpoint has reported the source this session: `/api/ups` carried
 *      a reading (status, charge, runtime or load), or `/api/gitea/activity`
 *      answered with a list (an empty one is still Gitea answering).
 *
 * Once configured, a panel stays for the session and shows its down state when
 * the source fails (an "Unknown" status, a source banner); it is never hidden
 * for a failure. The panel also joins the layout, so the next drag or resize
 * saves it there and rule 1 keeps it across reloads.
 *
 * `sections.<key>.visible === false` still hides a panel; DashboardView checks it.
 */

export const SOURCE_PANEL_KEYS = ['ups', 'pipeline'];

const UPS_READINGS = ['status', 'charge', 'runtime', 'load'];

/** `/api/ups` named a UPS: Prometheus has at least one of its NUT series. */
export function upsReported(ups) {
  return !!ups && typeof ups === 'object' && UPS_READINGS.some((k) => ups[k] != null);
}

/**
 * `/api/gitea/activity` answered with a list. `commits` starts as [] before
 * any answer, so an empty list counts only once the source has succeeded.
 */
export function giteaReported(commits, lastSuccessMs) {
  return Array.isArray(commits) && (commits.length > 0 || lastSuccessMs != null);
}

/** The display config names panel `key` (rule 1 above). */
export function configNamesPanel(config, key) {
  if (config?.sections?.[key]?.visible === true) return true;
  const saved = config?.gridLayout;
  if (!saved || typeof saved !== 'object') return false;
  return Object.values(saved).some(
    (items) => Array.isArray(items) && items.some((it) => it?.i === key)
  );
}

/**
 * { ups, pipeline } → whether each source-fed panel is configured. Latches a
 * source that has reported once, so it keeps its panel when it goes down.
 */
export function useConfiguredPanels({ config, ups, commits, commitsLastSuccessMs }) {
  const reported = {
    ups: upsReported(ups),
    pipeline: giteaReported(commits, commitsLastSuccessMs),
  };

  // Derived state, adjusted during render: once true, stays true.
  const [seen, setSeen] = useState({ ups: false, pipeline: false });
  if ((reported.ups && !seen.ups) || (reported.pipeline && !seen.pipeline)) {
    setSeen({ ups: seen.ups || reported.ups, pipeline: seen.pipeline || reported.pipeline });
  }

  const upsOn = configNamesPanel(config, 'ups') || seen.ups || reported.ups;
  const pipelineOn = configNamesPanel(config, 'pipeline') || seen.pipeline || reported.pipeline;
  return useMemo(() => ({ ups: upsOn, pipeline: pipelineOn }), [upsOn, pipelineOn]);
}
