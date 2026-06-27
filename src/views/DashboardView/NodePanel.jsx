import React from 'react';
import NodeCard from '../../components/NodeCard';
import DroppablePanel from '../../components/DroppablePanel';
import { useConfig } from '../../context/ConfigContext.jsx';
import { ProxmoxVMList, ProxmoxStoragePools, ProxmoxBackupStatus } from './ProxmoxPanels';
import { toServiceCard } from './serviceCard';

/**
 * Builds the metric tiles displayed on a NodeCard from the raw node payload.
 *
 * Logic:
 *   - CPU is always shown.
 *   - RAM uses a "used/total GB" tile when total > 4 GB; otherwise a percent tile (Pi).
 *   - Temp tile only when the node reports a sensor reading.
 *   - Disk tile only when the node reports filesystem stats; switches to TB > 1000 GB.
 *   - Uptime is always last.
 */
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

function buildMetrics(node, tempUnit = 'F', nodeKey, history) {
  const m = node.metrics || {};
  const metrics = [];
  // The ~1h usage series for this node's CPU/RAM/disk, for the sparklines.
  const hist = (field) => history?.[`${nodeKey}:${field}`];

  metrics.push({
    label: 'CPU',
    value: m.cpu,
    unit: '%',
    percent: parseFloat(m.cpu),
    history: hist('cpu'),
  });

  if (m.memTotalGB && parseFloat(m.memTotalGB) > 4) {
    metrics.push({
      label: 'RAM (GB)',
      value: `${m.memUsedGB || '—'}/${m.memTotalGB || '—'}`,
      percent: parseFloat(m.memPercent),
      withCachePercent: parseFloat(m.memWithCachePercent) || null,
      cacheGB: m.memCacheGB || null,
      small: true,
      history: hist('mem'),
    });
  } else {
    metrics.push({
      label: 'RAM',
      value: m.memPercent,
      unit: '%',
      percent: parseFloat(m.memPercent),
      withCachePercent: parseFloat(m.memWithCachePercent) || null,
      cacheGB: m.memCacheGB || null,
      history: hist('mem'),
    });
  }

  if (m.temp != null) {
    const value = tempUnit === 'C' ? m.temp : ((parseFloat(m.temp) * 9) / 5 + 32).toFixed(1);
    metrics.push({ label: 'Temp', value, unit: `°${tempUnit}` });
  }

  if (m.diskTotal != null) {
    metrics.push({
      label: `Disk (${m.diskUnit || 'GB'})`,
      value: `${m.diskUsed || '—'}/${m.diskTotal || '—'}`,
      percent: parseFloat(m.diskPercent),
      small: true,
      history: hist('disk'),
    });
  }

  metrics.push({ label: 'Uptime', value: m.uptime, small: true });

  return metrics;
}

/**
 * Renders a single discovered node as a draggable, droppable panel.
 *
 * Hides containers that have been "claimed" by a custom group so they don't
 * appear in two places. Augments each container with its app-data (Tier 3
 * integration metrics) when available.
 */
export default function NodePanel({
  nodeKey,
  node,
  sectionCfg,
  appDataByContainer,
  claimedContainers,
  integrationData,
  isMobile,
  banner,
  history,
}) {
  const { config } = useConfig();
  if (sectionCfg.visible === false) return null;

  const gridKey = `node-${nodeKey}`;
  const borderColor = node.border_color || sectionCfg.borderColor || 'var(--accent)';
  const metrics = buildMetrics(node, config.tempUnit, nodeKey, history);

  const serviceRank = (c) => (c.status === 'down' ? 0 : c.status === 'unknown' ? 1 : 2);
  const services = (node.services || [])
    .filter((s) => !claimedContainers.has(`${nodeKey}:${s.container}`))
    .map((s) => toServiceCard(nodeKey, s, appDataByContainer))
    .sort((a, b) => serviceRank(a) - serviceRank(b) || (a.name || '').localeCompare(b.name || ''));

  // Proxmox-specific child panels — render whenever a proxmox integration
  // targets THIS node (by its own _target), not just a node literally named "pve".
  const proxmox = proxmoxChildrenForNode(integrationData, nodeKey);
  const proxmoxVms = proxmox?.vms || null;
  const proxmoxStorage = proxmox?.storage || null;
  const proxmoxBackup = proxmox?.backup || null;

  return (
    <div key={gridKey}>
      <DroppablePanel panelId={gridKey} disabled={isMobile}>
        <NodeCard
          sectionKey={nodeKey}
          borderColor={borderColor}
          metrics={metrics}
          services={services}
          nodeData={node}
          panelId={gridKey}
          dragDisabled={isMobile}
          banner={banner}
        >
          <ProxmoxVMList vms={proxmoxVms} borderColor={borderColor} />
          <ProxmoxStoragePools pools={proxmoxStorage} borderColor={borderColor} />
          <ProxmoxBackupStatus backup={proxmoxBackup} />
        </NodeCard>
      </DroppablePanel>
    </div>
  );
}
