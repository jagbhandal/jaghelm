/**
 * What the Android app reads from a push: the FCM message's `data` block
 * (fcm.js buildMessage puts it on the wire). Its keys are strings, as FCM
 * requires:
 *
 *   type      the event's type ("service_down")
 *   id        the event's id, each family in its own namespace: a service's
 *             card uid, a job's node:job, a host's node or node:reading, the
 *             literal "ups", a source's name, an Arcane event's own
 *   node      the node it is on (a source's name, "ups" for the UPS)
 *   severity  critical | warning | info
 *   entity    the status model's id of what it is about (#309), when it is
 *             about one: what the app opens on a tap (src/phone/nav/
 *             entityRoute.js), the same address as the web's
 *             `?entity=<id>`. No key for an event that is no entity's: an
 *             Arcane update, release or digest, and the status check's own
 *             push (#440), which has no model to point into.
 *
 * The first four are unchanged for apps installed before #309, which ignore
 * `entity` and reconcile `id` themselves (mobile/src/push/fcmIdToIncidentId.js).
 * Pure.
 */
import { STATUS_CHECK } from './differ.js';

const AGENT_EVENTS = new Set(['arcane_agent_offline', 'arcane_agent_recovered']);

/**
 * The model's entity id `event` is about, or null:
 *
 *   service_*  services/<uid>         (its id is the card's uid)
 *   host_*     nodes/<node>           (a reading's push too: the node is its entity)
 *   ups_*      power/ups
 *   cron_*     the model's id the differ found (backups/… for a job the model
 *              files as a backup, #291), else jobs/<node>:<job>
 *   source_*   sources/<name>; none for the status check
 *   arcane_agent_*  integrations/arcane:<env>
 *
 * @param {{ type?: unknown, id?: unknown, node?: unknown, entity?: unknown }} event
 * @returns {string | null}
 */
export function entityOf(event) {
  const type = String(event?.type ?? '');
  const id = String(event?.id ?? '');
  const node = String(event?.node ?? '');
  switch (type.split('_')[0]) {
    case 'service':
      return id ? `services/${id}` : null;
    case 'host':
      return node ? `nodes/${node}` : null;
    case 'ups':
      return 'power/ups';
    case 'cron':
      if (typeof event.entity === 'string' && event.entity !== '') return event.entity;
      return id ? `jobs/${id}` : null;
    case 'source':
      return id && id !== STATUS_CHECK ? `sources/${id}` : null;
    case 'arcane':
      return AGENT_EVENTS.has(type) && node ? `integrations/arcane:${node}` : null;
    default:
      return null;
  }
}

/**
 * The FCM `data` block for `event`: type, id, node and severity, and the
 * entity when there is one, every value a string.
 *
 * @param {{ type: unknown, id: unknown, node: unknown, severity: unknown, entity?: unknown }} event
 * @returns {Record<string, string>}
 */
export function androidData(event) {
  const data = {
    type: String(event.type),
    id: String(event.id),
    node: String(event.node),
    severity: String(event.severity),
  };
  const entity = entityOf(event);
  if (entity) data.entity = entity;
  return data;
}
