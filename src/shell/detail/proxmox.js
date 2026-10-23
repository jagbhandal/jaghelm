/**
 * A node's Proxmox entry in /api/integrations (#310): the integration whose
 * VM list, storage pools and last backup belong to that node. The detail
 * drawer and the phone's Node detail show them (spec §8), and today's board
 * reads them through it too (NodePanel.jsx) until #306 removes it.
 *
 * It goes by the integration's own data, never a node's name:
 *   - the server stamps every entry with its preset (`_preset`, refresh.js),
 *     so only a Proxmox integration is one, whatever its key ("proxmox", or
 *     "proxmox_<instance>" for one with an instance name);
 *   - `_target` is a container uid ("node:container"); its node is the node
 *     the integration was scoped to. With none, the preset's own default,
 *     the node named "pve", as the status model reads its pools too
 *     (server/status/model.js proxmoxPools).
 */

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The node a Proxmox entry belongs to: `_target`'s node, else "pve". */
export function proxmoxTargetNode(entry) {
  if (entry?._target) return String(entry._target).split(':')[0];
  return 'pve';
}

/**
 * The first Proxmox entry for `nodeKey`, as `[key, entry]`, or null with none
 * (no payload, or no Proxmox integration for that node).
 *
 * @param {unknown} integrations  the /api/integrations payload
 * @param {string} nodeKey
 */
export function proxmoxEntryFor(integrations, nodeKey) {
  if (!isObject(integrations)) return null;
  for (const [key, entry] of Object.entries(integrations)) {
    if (!isObject(entry) || entry._preset !== 'proxmox') continue;
    if (proxmoxTargetNode(entry) === nodeKey) return [key, entry];
  }
  return null;
}
