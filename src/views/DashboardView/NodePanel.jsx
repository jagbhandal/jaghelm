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

  const services = (node.services || [])
    .filter((s) => !claimedContainers.has(`${nodeKey}:${s.container}`))
    .map((s) => toServiceCard(nodeKey, s, appDataByContainer));

  // Proxmox-specific child panels — only render when this is the PVE node
  const isPve = nodeKey === 'pve';
  const proxmoxVms = isPve ? integrationData.proxmox?._vms : null;
  const proxmoxStorage = isPve ? integrationData.proxmox?._storagePools : null;
  const proxmoxBackup = isPve ? integrationData.proxmox?._lastBackup : null;

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
