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
 * only /api/integrations or /api/ups, and a sheet covered by another reads
 * nothing until it is on top again. The Android app has no extras: its look
 * draws what it always has.
 */
import { useMemo } from 'react';
import ServiceDetail from '../phone/views/ServiceDetail.jsx';
import NodeDetail from '../phone/views/NodeDetail.jsx';
import IncidentDetail from '../phone/views/IncidentDetail.jsx';
import { entityFor, entityOfRoute } from '../phone/nav/entityRoute.js';
import { entityExtras, sourcesFor } from './detail/entityExtras.js';
import { useDetailSources } from './detail/useDetailSources.js';
import { useStatusAt } from './statusFreshness.js';

const DETAILS = { serviceDetail: ServiceDetail, node: NodeDetail, incident: IncidentDetail };

/** The names of the details the web draws. */
export const DETAIL_SCREENS = Object.freeze(Object.keys(DETAILS));

const NONE = Object.freeze([]);

export default function PhoneDetail({ screen, data, nav, params, top = true }) {
  const Detail = DETAILS[screen];
  const entity = entityFor(data.status, entityOfRoute({ screen, params }));
  const wanted =
    Detail && top ? sourcesFor(entity, data.status).filter((s) => s !== 'services') : NONE;
  const read = useDetailSources(wanted, data.updated);
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
  return Detail ? <Detail data={shown} nav={nav} params={params} /> : null;
}
