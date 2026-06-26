/**
 * Pure deep-link mapper from a tapped push's FCM `data` block into the in-app
 * nav stack. DESIGN.md routes ALL event types to the SAME Incident detail
 * screen. The FCM data payload carries ONLY { type, id, node, severity }, all
 * STRING values.
 *
 * The FCM `data.id` namespace (NODE:SERVICEID / NODE:JOBID / NODE / NODE:METRIC
 * / literal "ups") is INCOMPATIBLE with mobile `deriveIncidents` ids, so we
 * RECONCILE via fcmIdToIncidentId before pushing — otherwise IncidentDetail's
 * `incidents.find(i => i.id === params.id)` would never match, even a LIVE
 * incident. The reconciled `id` drives the lookup; `fcmId`/`type`/`node`/
 * `severity` are passed as fallback render params for events with no derived
 * incident (host events) or a since-resolved id.
 *
 * Defensive: a missing/null payload or empty id is a no-op.
 *
 * @param {{ type?: string, id?: string, node?: string, severity?: string }} data
 * @param {{ push: (screen: string, params: object) => void }} nav
 */
import { fcmIdToIncidentId } from './fcmIdToIncidentId.js';

export function routeFromData(data, nav) {
  if (!data || typeof data.id !== 'string' || data.id === '') return;
  nav.push('incident', {
    id: fcmIdToIncidentId(data.type, data.id), // reconciled (null for host events)
    fcmId: data.id,
    type: data.type,
    node: data.node,
    severity: data.severity,
  });
}
