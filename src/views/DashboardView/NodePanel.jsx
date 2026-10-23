import React from 'react';
import NodeCard from '../../components/NodeCard';
import { usePlace } from '../../shell/entityAnchors.js';
import { ProxmoxVMList, ProxmoxStoragePools, ProxmoxBackupStatus } from './ProxmoxPanels';
import { proxmoxEntryFor } from '../../shell/detail/proxmox.js';

/**
 * Finds the proxmox integration entry (if any) targeting `nodeKey` and returns
 * its child-panel data: the integration's own `_target`, or the preset's
 * default node "pve" (src/shell/detail/proxmox.js, which the detail drawer
 * reads them through too, #310).
 */
export function proxmoxChildrenForNode(integrationData, nodeKey) {
  const found = proxmoxEntryFor(integrationData, nodeKey);
  if (!found) return null;
  const [, entry] = found;
  return {
    vms: entry._vms || null,
    storage: entry._storagePools || null,
    backup: entry._lastBackup || null,
  };
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
