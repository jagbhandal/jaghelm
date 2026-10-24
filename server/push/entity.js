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
