/**
 * What the Android app's detail on screen charts (#602): the web drawer's
 * rule (src/shell/detail/entityDetail.js chartTarget) for the model's entity
 * of the screen and, for a service, its card in /api/services: a node by its
 * key, a service with a container as `<node>/<container>`. Null for any other
 * screen, an entity the model doesn't have, or a service with no container.
 */
import { chartTarget } from '@shared/shell/detail/entityDetail.js';
import { entityFor, entityOfRoute } from '@shared/phone/nav/entityRoute.js';
import { flattenServices } from '@shared/phone/data/derive.js';

/** The detail screens that chart a history. */
const CHARTED = new Set(['node', 'serviceDetail']);

/**
 * @param {{ screen: string, params?: Record<string, any>, data: { status?: any, servicesBody?: any } }} args
 * @returns {{ kind: string, entity: string } | null}
 */
export function historyTargetOf({ screen, params = {}, data }) {
  if (!CHARTED.has(screen)) return null;
  const entity = entityFor(data?.status, entityOfRoute({ screen, params }));
  if (!entity) return null;
  const card =
    screen === 'serviceDetail'
      ? (flattenServices(data.servicesBody).find((s) => s.uid === params.uid) ?? null)
      : null;
  return chartTarget(entity, card);
}
