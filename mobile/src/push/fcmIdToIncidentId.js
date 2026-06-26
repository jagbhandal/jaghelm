/**
 * Pure reconciler from the FCM `data.id` namespace (server) to the mobile
 * `deriveIncidents` id namespace (derive.js). The two are incompatible by
 * construction, so passing `data.id` straight to IncidentDetail's
 * `incidents.find(i => i.id === params.id)` would NEVER match — even a LIVE
 * incident. This maps them:
 *   - service_* -> `service:${fcmId}`  (FCM id NODE:SERVICEID === svc.uid;
 *                                       derive.js builds `service:${svc.uid}`)
 *   - cron_*    -> `cron:${fcmId}`     (FCM id NODE:JOBID; derive builds
 *                                       `cron:${node}:${job}`)
 *   - ups_*     -> 'ups:apcups'        (derive.js hard-codes this literal id)
 *   - host_*    -> null                (derive.js emits NO host incident; the
 *                                       caller renders host events from the
 *                                       fallback push params instead)
 *
 * @param {string} type   one of the 10 differ event types
 * @param {string} fcmId  the FCM `data.id`
 * @returns {string|null} the derived incident id, or null when no derived
 *   incident can exist (host events) / on malformed input
 */
export function fcmIdToIncidentId(type, fcmId) {
  if (typeof type !== 'string' || typeof fcmId !== 'string' || fcmId === '') return null;
  const family = type.split('_')[0]; // service|host|ups|cron (matches server categoryOf)
  switch (family) {
    case 'service':
      return `service:${fcmId}`;
    case 'cron':
      return `cron:${fcmId}`;
    case 'ups':
      return 'ups:apcups'; // derive.js line 140: the UPS incident id is a fixed literal
    case 'host':
      return null; // no derived host incident — render from fallback params
    default:
      return null;
  }
}
