/**
 * Pure deep-link mapper from a tapped push's FCM `data` block into the in-app
 * nav stack: the push opens the detail screen of the entity it is about
 * (#309), as a row about it does and as the web's `?entity=<id>` URL does
 * (src/phone/nav/entityRoute.js): a service its Service detail, a node its
 * Node detail, anything else (the UPS, a job, a backup, a source, an Arcane
 * agent) Incident detail. The `data` values are all strings
 * (server/push/androidPayload.js).
 *
 * The entity is the push's `entity`, the status model's id. A server older
 * than #309 sends none: its `id` (NODE:SERVICEID / NODE:JOBID / NODE /
 * NODE:METRIC / literal "ups" / a source's name) is reconciled onto one
 * (fcmIdToIncidentId, #325). Incident detail also gets `fcmId`, `type`,
 * `node` and `severity`, to render from for an event that is no entity now
 * (resolved, or never one, such as an Arcane update).
 *
 * Defensive: a missing/null payload or empty id is a no-op.
 *
 * @param {{ type?: string, id?: string, node?: string, severity?: string, entity?: string }} data
 * @param {{ push: (screen: string, params: object) => void }} nav
 */
// Relative, not @shared/: the server's tests import this file under Node,
// which has no alias (server/push/androidPayload.test.js).
import { entityRoute } from '../../../src/phone/nav/entityRoute.js';
import { fcmIdToIncidentId } from './fcmIdToIncidentId.js';

export function routeFromData(data, nav) {
  if (!data || typeof data.id !== 'string' || data.id === '') return;
  const id = entityRoute(data.entity)
    ? data.entity
    : fcmIdToIncidentId(data.type, data.id, data.node); // the model's entity id, or null
  const route = entityRoute(id);
  if (route && route.screen !== 'incident') {
    nav.push(route.screen, route.params);
    return;
  }
  nav.push('incident', {
    id,
    fcmId: data.id,
    type: data.type,
    node: data.node,
    severity: data.severity,
  });
}
