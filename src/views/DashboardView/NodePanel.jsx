import React from 'react';
import NodeCard from '../../components/NodeCard';
import { usePlace } from '../../shell/entityAnchors.js';
import { ProxmoxVMList, ProxmoxStoragePools, ProxmoxBackupStatus } from './ProxmoxPanels';

/**
 * Resolves which discovered node a proxmox integration entry belongs to.
 *
 * Drives off the integration's OWN data instead of a hardcoded node name:
 *   - `_target` is a container uid ("node:container"); its node segment is the
 *     node the operator scoped the integration to.
 *   - With no `_target`, the preset itself defaults to the node named "pve"
 *     (it extracts the node from VM data, falling back to "pve"), so we mirror
 *     that default here to preserve the existing pve-named behavior.
 */
function proxmoxTargetNode(entry) {
  if (entry?._target) return String(entry._target).split(':')[0];
  return 'pve';
}

/**
 * Finds the proxmox integration entry (if any) targeting `nodeKey` and returns
 * its child-panel data. Scans every integration entry — a proxmox integration
 * created with an instance name is keyed "proxmox_<instance>", not "proxmox",
 * so keying off `integrationData.proxmox` alone silently dropped those.
 *
 * Identifies proxmox by the server-stamped `_preset` (refresh.js), not by
 * sniffing output fields — so a future preset that happens to emit a `_vms`
 * field can't be mistaken for proxmox.
 */
export function proxmoxChildrenForNode(integrationData, nodeKey) {
  if (!integrationData) return null;
  for (const entry of Object.values(integrationData)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry._preset !== 'proxmox') continue;
    if (proxmoxTargetNode(entry) !== nodeKey) continue;
    return {
      vms: entry._vms || null,
      storage: entry._storagePools || null,
      backup: entry._lastBackup || null,
    };
  }
  return null;
}

/**
 * Renders a single discovered node as a panel of the board: its Proxmox lists.
 * Its readings (CPU, memory, disk, temperature, the hour of CPU) are the
 * Overview's Infrastructure section's (#299), and its services the Services
 * section's (#300), so the panel draws neither.
 *
 * `anchored`: whether the panel is the node's place on the board, which the
 * Overview's issue row for the node leads to (#297). The Infrastructure
 * section's card is, while that section is drawn; under a filter that hides
 * it (Services), the panel is.
 */
export default function NodePanel({
  nodeKey,
  node,
  sectionCfg,
  integrationData,
  banner,
  anchored = true,
}) {
  const anchor = usePlace(`nodes/${nodeKey}`, anchored && sectionCfg.visible !== false);
  if (sectionCfg.visible === false) return null;

  const gridKey = `node-${nodeKey}`;
  const borderColor = node.border_color || sectionCfg.borderColor || 'var(--accent)';

  // Proxmox-specific child panels — render whenever a proxmox integration
  // targets THIS node (by its own _target), not just a node literally named "pve".
  const proxmox = proxmoxChildrenForNode(integrationData, nodeKey);
  const proxmoxVms = proxmox?.vms || null;
  const proxmoxStorage = proxmox?.storage || null;
  const proxmoxBackup = proxmox?.backup || null;

  return (
    <div key={gridKey} id={anchor}>
      <NodeCard sectionKey={nodeKey} borderColor={borderColor} nodeData={node} banner={banner}>
        <ProxmoxVMList vms={proxmoxVms} borderColor={borderColor} />
        <ProxmoxStoragePools pools={proxmoxStorage} borderColor={borderColor} />
        <ProxmoxBackupStatus backup={proxmoxBackup} />
      </NodeCard>
    </div>
  );
}
