import { useMemo, useState } from 'react';

/**
 * Which source-fed panels (UPS, Pipeline) the board shows (#272).
 *
 * The server says whether each source is set up, so a fresh install without a
 * UPS or a Gitea has no "Unknown" UPS card and no "Gitea unreachable" card,
 * while a source that is set up but down keeps its panel, with its down state:
 *
 *   - UPS: `/api/ups` carries `configured`: true when the NUT exporter reports
 *     the UPS or did within the last 7 days, false when it did not, null when
 *     Prometheus failed. A body without the field (demo data) counts as a UPS
 *     when it carries a reading.
 *   - Pipeline: `/api/gitea/activity` answers `{ configured: false }` when
 *     GITEA_URL is not set. A list is a Gitea that answered, and the endpoint's
 *     502 a Gitea that is set up and failing.
 *
 * Each source's answer is true, false or null (not known: no answer yet, or a
 * failure that says nothing about it). True shows the panel. False hides it,
 * even when the saved layout names it. Null keeps the last true or false this
 * session, and hides the panel before there is one, so it never flashes in.
 * `sections.<key>.visible === false` still hides a panel; DashboardView checks
 * it.
 */

export const SOURCE_PANEL_KEYS = ['ups', 'pipeline'];

const UPS_READINGS = ['status', 'charge', 'runtime', 'load'];

/** `/api/ups` carried a reading (status, charge, runtime or load). */
export function upsReported(ups) {
  return !!ups && typeof ups === 'object' && UPS_READINGS.some((k) => ups[k] != null);
}

/** Whether `/api/ups` says a UPS is set up: true, false or null (not known). */
export function upsConfigured(ups) {
  if (!ups || typeof ups !== 'object') return null;
  if (typeof ups.configured === 'boolean') return ups.configured;
  return upsReported(ups) ? true : null;
}

/**
 * Whether `/api/gitea/activity` says a Gitea is set up: true, false or null
 * (not known). `commits` is its last body, [] before any; `source` its health
 * from useDashboardData. An empty list counts once the source has succeeded.
 * The endpoint answers 502 only when a set-up Gitea fails, so that counts too;
 * any other failure (JagHelm unreachable, a timeout) says nothing.
 */
export function giteaConfigured(commits, source) {
  if (commits && typeof commits === 'object' && commits.configured === false) return false;
  if (Array.isArray(commits) && (commits.length > 0 || source?.lastSuccessMs != null)) return true;
  if (source?.error === 'HTTP 502') return true;
  return null;
}

/**
 * { ups, pipeline }: true (show), false (not set up: hide, and drop it from the
 * layout) or null (not known yet: hide, keeping its place in a saved layout).
 * A null answer keeps the last true or false this session.
 */
export function useConfiguredPanels({ ups, commits, commitsSource }) {
  const answer = { ups: upsConfigured(ups), pipeline: giteaConfigured(commits, commitsSource) };

  // The last true or false per panel: derived state, adjusted during render.
  const [known, setKnown] = useState({ ups: null, pipeline: null });
  const upsNow = answer.ups ?? known.ups;
  const pipelineNow = answer.pipeline ?? known.pipeline;
  if (upsNow !== known.ups || pipelineNow !== known.pipeline) {
    setKnown({ ups: upsNow, pipeline: pipelineNow });
  }

  return useMemo(() => ({ ups: upsNow, pipeline: pipelineNow }), [upsNow, pipelineNow]);
}
