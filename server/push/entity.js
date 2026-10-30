/**
 * The status model's entity an event is about (#309), when it is about one:
 * what a push's tap opens (the Web Push payload's `url` and `tag`, webPush.js
 * buildWebPayload) and what the alert history links (alertHistory.js), the
 * same address as the web's `?entity=<id>` (src/shell/entityNav.js). Pure.
 *
 * None for an event that is no entity's: an Arcane update, release or digest,
 * and the status check's own push (#440), which has no model to point into.
 */
import { STATUS_CHECK } from './differ.js';

const AGENT_EVENTS = new Set(['arcane_agent_offline', 'arcane_agent_recovered']);

/**
 * The model's entity id `event` is about, or null:
 *
 *   service_*  services/<uid>         (its id is the card's uid; a temporary name's
 *              recovery carries the real container's, #772)
 *   container_* services/<uid>        (a missing container, #775)
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
      // A recovery of a temporary name names the real container's card (#772).
      if (typeof event.entity === 'string' && event.entity !== '') return event.entity;
      return id ? `services/${id}` : null;
    case 'container':
      // A missing container (#775): its card's uid, running or not.
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
 * The drive an event is about (drive health, #728), or null: a drive's
 * reading event has the id `<node>:drive:<node>:<device>` (the node, then the
 * model's condition key), and the web opens the node's detail with that drive
 * highlighted (`?entity=nodes/<node>&drive=<device>`). The entity is still the
 * node's (`entityOf`); this names the row inside it.
 *
 * @param {{ type?: unknown, id?: unknown, node?: unknown }} event
 * @returns {string | null}
 */
export function driveOf(event) {
  if (!String(event?.type ?? '').startsWith('host_')) return null;
  const node = String(event?.node ?? '');
  const prefix = `${node}:drive:${node}:`;
  const id = String(event?.id ?? '');
  if (!node || !id.startsWith(prefix)) return null;
  const device = id.slice(prefix.length);
  return device === '' ? null : device;
}
