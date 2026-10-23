/**
 * The Infrastructure page's Proxmox lists (#313, spec §8: "the Proxmox VM
 * list and storage pools move to the node's detail drawer and the
 * Infrastructure page"): for each node the page shows that has a Proxmox
 * integration, its virtual machines and storage pools, built as the node's
 * detail builds them (src/shell/detail/entityExtras.js, #310), so the page
 * and the drawer list the same machines and pools, the pools' meters on the
 * disk rule and the model's level for each.
 */
import { entityExtras } from './detail/entityExtras.js';

/** The Proxmox parts of a node's detail the page lists: its machines and its pools. */
const PROXMOX_PARTS = new Set(['vms', 'pools']);

/**
 * Each of `nodes` with a Proxmox integration, and the parts of its detail the
 * page lists (entityExtras.js, as the detail drawer builds them): `[{ node,
 * sections }]`, in the nodes' order.
 */
export function proxmoxOf({ status, nodes, services, integrations, stale }) {
  if (!integrations || typeof integrations !== 'object') return [];
  const read = { integrations: { body: integrations } };
  return nodes.flatMap((node) => {
    const entity = status?.entities?.find((e) => e.id === node.id);
    if (!entity) return [];
    const { sections } = entityExtras({ status, entity, read, services, freshness: { stale } });
    const parts = sections.filter((s) => PROXMOX_PARTS.has(s.key));
    return parts.length > 0 ? [{ node, sections: parts }] : [];
  });
}
