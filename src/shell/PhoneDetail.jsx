/**
 * The phone's detail screens on the web (#303): Service, Node and Incident
 * detail, by the name a screen pushes. Their own chunk (lazyViews.js), loaded
 * when the first detail opens, not with the phone's first screen (#309: the
 * detail drawer shares their parts, which a phone's first load then doesn't
 * fetch).
 *
 * They show what the desktop's drawer shows (#310): the screen's entity
 * (entityOfRoute) gets the same extras (detail/entityExtras.js: a node's
 * Proxmox lists, a service's container and integration stats, the UPS's
 * readings), as `data.extras`, from the reads a detail makes while it is the
 * one on top (`top`; useDetailSources: as it opens, then on each status
 * answer). The phone screens already have /api/services, so a sheet reads
 * only /api/integrations (the UPS's readings are the model's, #586: no sheet
 * reads /api/ups), and a sheet covered by another reads nothing until it is
 * on top again. A job's or a backup's sheet adds its
 * runs (read as it opens, and when the job reports again) and its Remove
 * (#578, JobRemove.jsx); once removed, the sheet closes and focus goes to the
 * row after it in the Infrastructure screen's list.
 *
 * A node's sheet and a container's (a service with one) also draw the
 * drawer's history charts (#602, detail/HistoryCharts.jsx), for the same
 * target as the drawer (entityDetail.js chartTarget), as the view's `charts`,
 * the range switch sized for a thumb. One read as it opens, then at most one a
 * minute on the status poll's answers (tickBudget.js's exception); a sheet
 * covered by another reads none until it is on top again. The same two draw
 * "Recent errors" (#672, detail/RecentErrors.jsx) after the sections, as the
 * view's `logs`: one read as the sheet opens, then at most one a minute.
 */
import { useMemo } from 'react';
import ServiceDetail from '../phone/views/ServiceDetail.jsx';
import NodeDetail from '../phone/views/NodeDetail.jsx';
import IncidentDetail from '../phone/views/IncidentDetail.jsx';
import { entityFor, entityOfRoute } from '../phone/nav/entityRoute.js';
import { entityExtras, sourcesFor } from './detail/entityExtras.js';
import { chartTarget, stackView } from './detail/entityDetail.js';
import { StackSection } from './detail/StackSection.jsx';
import { HistoryCharts } from './detail/HistoryCharts.jsx';
import { RecentErrors } from './detail/RecentErrors.jsx';
import { JobRemove } from './detail/JobRemove.jsx';
import { useDetailSources } from './detail/useDetailSources.js';
import { isJob } from './jobsView.js';
import { useStatusAt } from './statusFreshness.js';

const DETAILS = { serviceDetail: ServiceDetail, node: NodeDetail, incident: IncidentDetail };

/** The names of the details the web draws. */
export const DETAIL_SCREENS = Object.freeze(Object.keys(DETAILS));

const NONE = Object.freeze([]);

export default function PhoneDetail({ screen, data, nav, params, top = true, intervalMs }) {
  const Detail = DETAILS[screen];
  const entity = entityFor(data.status, entityOfRoute({ screen, params }));
  const wanted =
    Detail && top ? sourcesFor(entity, data.status).filter((s) => s !== 'services') : NONE;
  const read = useDetailSources(wanted, data.updated, { intervalMs, revision: entity?.lastRun });
  const at = useStatusAt(data.updated);
  const shown = useMemo(() => {
    if (!entity) return data;
    const extras = entityExtras({
      status: data.status,
      entity,
      read,
      services: data.servicesBody,
      freshness: data.freshness,
      at,
    });
    return { ...data, extras };
  }, [data, entity, read, at]);
  const actions =
    Detail && isJob(entity) ? (
      <JobRemove entity={entity} onRemoved={({ focus }) => nav.pop({ focus })} />
    ) : null;
  // The same target from one status answer to the next, so the charts aren't built again.
  const found = Detail ? chartTarget(entity, shown.extras?.card) : null;
  const chartKind = found?.kind ?? null;
  const chartEntity = found?.entity ?? null;
  const target = useMemo(
    () => (chartKind ? { kind: chartKind, entity: chartEntity } : null),
    [chartKind, chartEntity]
  );
  const charts = target ? (
    <HistoryCharts target={target} updated={data.updated} size="touch" paused={!top} />
  ) : null;
  const logs = target ? <RecentErrors target={target} updated={data.updated} paused={!top} /> : null;
  // A stack's containers (#642): each one's Details opens its own sheet over this one.
  const view =
    Detail && entity?.stack
      ? stackView(entity, shown.extras?.card, data.servicesBody, data.freshness)
      : null;
  const stack = view ? (
    <StackSection stack={view} open={(member) => nav.push('serviceDetail', { uid: member.uid })} />
  ) : null;
  return Detail ? (
    <Detail
      data={shown}
      nav={nav}
      params={params}
      actions={actions}
      charts={charts}
      logs={logs}
      stack={stack}
    />
  ) : null;
}
