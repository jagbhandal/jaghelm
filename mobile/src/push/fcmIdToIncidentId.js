/**
 * Pure reconciler from a push's FCM `data` (server) to the status model's
 * entity id (docs/ARCHITECTURE.md §4.7), which Incident detail looks the issue
 * up by (nav/issueRoute.js issueFor, #325). The FCM `data` block is unchanged
 * for installed apps (`type`, `id`, `node`, `severity`, server/push/fcm.js),
 * so the two namespaces differ and this maps them:
 *   - service_* -> `services/${fcmId}`  (FCM id NODE:SERVICEID is the card's uid)
 *   - host_*    -> `nodes/${node}`      (FCM id NODE, or NODE:READING)
 *   - ups_*     -> 'power/ups'          (the model's one UPS)
 *   - cron_*    -> `jobs/${fcmId}`      (FCM id NODE:JOB; issueFor finds a job
 *                                        the model files as a backup too)
 *   - source_*  -> `sources/${fcmId}`   (prometheus, kuma, nut, config)
 * Anything else (an Arcane push, an unknown type) is null: Incident detail
 * then renders from the push's own fields.
 *
 * @param {string} type   the push's event type
 * @param {string} fcmId  the FCM `data.id`
 * @param {string} [node] the FCM `data.node`
 * @returns {string|null} the entity id, or null
 */
export function fcmIdToIncidentId(type, fcmId, node) {
  if (typeof type !== 'string' || typeof fcmId !== 'string' || fcmId === '') return null;
  const family = type.split('_')[0]; // service|host|ups|cron|source (matches server categoryOf)
  switch (family) {
    case 'service':
      return `services/${fcmId}`;
    case 'host':
      return `nodes/${typeof node === 'string' && node !== '' ? node : fcmId.split(':')[0]}`;
    case 'ups':
      return 'power/ups';
    case 'cron':
      return `jobs/${fcmId}`;
    case 'source':
      return `sources/${fcmId}`;
    default:
      return null;
  }
}
