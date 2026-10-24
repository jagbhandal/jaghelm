import React, { useId, useState } from 'react';
import { FieldRow } from './Field';
import { SettingsIcon, UiButton } from './primitives.jsx';
import { useConfirm } from '../../context/OverlayContext.jsx';

/**
 * ServicesTab — Phase 2 Settings
 *
 * Shows all discovered containers grouped by node.
 * For each service, the user can:
 * - Edit display name
 * - Set icon key
 * - Map to an Uptime Kuma monitor (dropdown)
 * - Hide/show
 *
 * Data sources:
 * - serverConfig (services.yaml) — the overrides
 * - liveServices (/api/services response) — currently discovered containers
 * - monitorNames (/api/services/monitors) — available Kuma monitors
 */
// Dropdown value for `monitor: false` (no monitor, no name matching).
const NO_MONITOR = '__none__';

export default function ServicesTab({ serverConfig, liveServices, monitorNames, onSave, saving }) {
  const confirm = useConfirm();
  const hintBase = useId();
  const [expandedNode, setExpandedNode] = useState(null);
  const [editService, setEditService] = useState(null);

  const nodes = liveServices?.nodes || {};
  const overrides = serverConfig?.services || {};

  const removeAllOverrides = async (containerName, displayName) => {
    const ok = await confirm({
      title: `Remove all overrides for "${displayName || containerName}"?`,
      body: 'This clears the display name, icon, and monitor mapping (on every node) for this service, restoring its auto-discovered defaults. This cannot be undone.',
      confirmLabel: 'Remove Overrides',
      danger: true,
    });
    if (!ok) return;
    const updatedServices = { ...serverConfig.services };
    delete updatedServices[containerName];
    onSave({ ...serverConfig, services: updatedServices });
    setEditService(null);
  };

  const updateOverride = (containerName, field, value) => {
    const existing = overrides[containerName] || {};
    const updated = {
      ...serverConfig,
      services: {
        ...serverConfig.services,
        [containerName]: {
          ...existing,
          [field]: value,
        },
      },
    };
    onSave(updated);
  };

  // A container that runs on more than one node gets its monitor per node
  // (monitor_per_node.<nodeKey>), so editing one node leaves the others alone.
  // A container on one node keeps the container-wide `monitor`. A container
  // that already has per-node entries stays per-node even while a node is
  // offline or hidden (and so missing from the live data).
  const isPerNode = (containerName) => {
    const live = Object.values(nodes).filter((n) =>
      (n.services || []).some((s) => s.container === containerName)
    ).length;
    if (live > 1) return true;
    const perNode = overrides[containerName]?.monitor_per_node;
    return !!perNode && Object.keys(perNode).length > 0;
  };

  // What the dropdown shows, as the server resolves it: this node's entry, else
  // the container-wide one; `false` is "no monitor", never Auto-match.
  const effectiveMonitor = (containerName, nodeKey) => {
    const entry = overrides[containerName] || {};
    const own = entry.monitor_per_node?.[nodeKey];
    if (own === false) return NO_MONITOR;
    if (typeof own === 'string' && own !== '') return own;
    if (entry.monitor === false) return NO_MONITOR;
    return typeof entry.monitor === 'string' ? entry.monitor : '';
  };

  // Set a name, NO_MONITOR (false) or '' (Auto-match) for this node.
  //
  // The first per-node write migrates a container-wide `monitor`: it is copied
  // to every other node the container is on (config nodes and live nodes) and
  // then deleted, so no hidden fallback is left behind and Auto-match on this
  // node really clears it. Other nodes' entries are untouched; empty maps and
  // empty overrides are dropped.
  const setNodeMonitor = (containerName, nodeKey, choice) => {
    const existing = { ...(overrides[containerName] || {}) };
    const perNode = { ...(existing.monitor_per_node || {}) };
    if (typeof existing.monitor === 'string' || existing.monitor === false) {
      const otherKeys = new Set([
        ...Object.keys(serverConfig.nodes || {}),
        ...Object.keys(nodes),
      ]);
      otherKeys.delete(nodeKey);
      for (const k of otherKeys) if (!Object.hasOwn(perNode, k)) perNode[k] = existing.monitor;
    }
    delete existing.monitor;
    if (choice === '') delete perNode[nodeKey];
    else perNode[nodeKey] = choice === NO_MONITOR ? false : choice;
    if (Object.keys(perNode).length === 0) delete existing.monitor_per_node;
    else existing.monitor_per_node = perNode;
    const updatedServices = { ...serverConfig.services };
    if (Object.keys(existing).length === 0) delete updatedServices[containerName];
    else updatedServices[containerName] = existing;
    onSave({ ...serverConfig, services: updatedServices });
  };

  const removeOverride = (containerName, field) => {
    const existing = { ...(overrides[containerName] || {}) };
    delete existing[field];
    // If no fields left, remove the entire override
    const isEmpty = Object.keys(existing).length === 0;
    const updatedServices = { ...serverConfig.services };
    if (isEmpty) {
      delete updatedServices[containerName];
    } else {
      updatedServices[containerName] = existing;
    }
    onSave({ ...serverConfig, services: updatedServices });
  };

  // Hide rules match a container by its EXACT name (case-insensitive), not a
  // substring — otherwise hiding "redis" would also hide "redis-backup" and
  // un-hiding it would strip every rule whose name is a substring of this one.
  const matchesHide = (containerName, h) => h.toLowerCase() === containerName.toLowerCase();

  const toggleHide = (nodeKey, containerName) => {
    const node = serverConfig.nodes?.[nodeKey];
    if (!node) return;
    const hideList = node.hide || [];
    const isHidden = hideList.some((h) => matchesHide(containerName, h));
    let updated;
    if (isHidden) {
      updated = hideList.filter((h) => !matchesHide(containerName, h));
    } else {
      updated = [...hideList, containerName];
    }
    onSave({
      ...serverConfig,
      nodes: {
        ...serverConfig.nodes,
        [nodeKey]: { ...node, hide: updated },
      },
    });
  };

  const isHidden = (nodeKey, containerName) => {
    const hideList = serverConfig.nodes?.[nodeKey]?.hide || [];
    return hideList.some((h) => matchesHide(containerName, h));
  };

  return (
    <div>
      <p className="settings-desc" style={{ marginBottom: 16 }}>
        Services are auto-discovered from Prometheus/cAdvisor. Override display names, icons, and
        monitor mappings here.
      </p>

      {saving && (
        <div className="settings-saving" style={{ marginBottom: 12 }}>
          Saving...
        </div>
      )}

      {Object.entries(nodes).map(([nodeKey, node]) => (
        <div key={nodeKey} style={{ marginBottom: 16 }}>
          {/* Node group header */}
          <div
            onClick={() => setExpandedNode(expandedNode === nodeKey ? null : nodeKey)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 14px',
              cursor: 'pointer',
              background: 'var(--bg-card-inner)',
              borderRadius: 10,
              border: '1px solid var(--border-color)',
              borderLeft: `3px solid ${node.border_color || 'var(--accent)'}`,
            }}
          >
            <span style={{ fontSize: 18, display: 'inline-flex', alignItems: 'center' }}>
              <SettingsIcon value={node.icon} fallback="🖥" size={22} />
            </span>
            <span
              style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, flex: 1 }}
            >
              {node.display_name || nodeKey}
            </span>
            <span
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}
            >
              {(node.services || []).length} services
            </span>
            <span
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                transform: expandedNode === nodeKey ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
              }}
            >
              ▼
            </span>
          </div>

          {/* Services list */}
          {expandedNode === nodeKey && (
            <div className="settings-stack-xs" style={{ marginTop: 6 }}>
              {(node.services || []).map((svc) => {
                const containerName = svc.container;
                const override = overrides[containerName] || {};
                const isEditing = editService === containerName;
                const hidden = isHidden(nodeKey, containerName);
                const hasOverride = Object.keys(override).length > 0;
                const perNodeMonitor = isPerNode(containerName);
                const monitorMatch = svc.monitored === true || svc.status === 'up';

                return (
                  <div
                    key={containerName}
                    style={{
                      padding: '10px 14px',
                      background: hidden ? 'rgba(255,255,255,0.01)' : 'var(--bg-card-inner)',
                      borderRadius: 10,
                      border: `1px solid ${isEditing ? 'var(--accent)' : 'var(--border-color)'}`,
                      opacity: hidden ? 0.5 : 1,
                      transition: 'all 0.2s',
                    }}
                  >
                    {/* Service row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {/* Status dot */}
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          flexShrink: 0,
                          background:
                            svc.status === 'up'
                              ? 'var(--green)'
                              : svc.status === 'down'
                                ? 'var(--red)'
                                : 'var(--amber)',
                          boxShadow: `0 0 6px ${svc.status === 'up' ? 'var(--green)' : svc.status === 'down' ? 'var(--red)' : 'var(--amber)'}`,
                        }}
                      />

                      {/* Name */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500 }}
                        >
                          {svc.display_name}
                        </div>
                        <div
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 10,
                            color: 'var(--text-muted)',
                          }}
                        >
                          {containerName}
                          {hasOverride && (
                            <span style={{ color: 'var(--accent)', marginLeft: 6 }}>
                              · overridden
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Monitor status */}
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: monitorMatch ? 'var(--green-bg)' : 'var(--amber-bg)',
                          color: monitorMatch ? 'var(--green)' : 'var(--amber)',
                          border: `1px solid ${monitorMatch ? 'var(--green-border)' : 'var(--amber-border)'}`,
                        }}
                      >
                        {monitorMatch ? 'monitored' : 'no monitor'}
                      </span>

                      {/* Actions */}
                      <UiButton
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleHide(nodeKey, containerName)}
                      >
                        {hidden ? 'Show' : 'Hide'}
                      </UiButton>
                      <UiButton
                        variant="ghost"
                        size="sm"
                        tone="accent"
                        onClick={() => setEditService(isEditing ? null : containerName)}
                      >
                        {isEditing ? 'Close' : 'Edit'}
                      </UiButton>
                    </div>

                    {/* Expanded edit form */}
                    {isEditing && (
                      <div
                        className="settings-stack"
                        style={{
                          marginTop: 12,
                          gap: 10,
                          paddingTop: 10,
                          borderTop: '1px solid var(--border-color)',
                        }}
                      >
                        <FieldRow label="Display Name">
                          <input
                            className="settings-input"
                            value={override.display_name || ''}
                            onChange={(e) =>
                              updateOverride(containerName, 'display_name', e.target.value)
                            }
                            placeholder={svc.display_name}
                          />
                        </FieldRow>

                        <FieldRow label="Icon Key">
                          <input
                            className="settings-input mono"
                            value={override.icon || ''}
                            onChange={(e) => updateOverride(containerName, 'icon', e.target.value)}
                            placeholder="auto (e.g. npm, adguard, photoprism)"
                          />
                        </FieldRow>

                        <FieldRow
                          label="Uptime Kuma Monitor"
                          hint={
                            perNodeMonitor ? (
                              <span id={`${hintBase}-${nodeKey}-${containerName}`}>
                                This container runs on several nodes: the monitor is set for{' '}
                                {node.display_name || nodeKey} only. The display name and icon apply
                                to every node.
                              </span>
                            ) : undefined
                          }
                        >
                          <select
                            className="settings-input mono"
                            aria-describedby={
                              perNodeMonitor
                                ? `${hintBase}-${nodeKey}-${containerName}`
                                : undefined
                            }
                            value={
                              perNodeMonitor
                                ? effectiveMonitor(containerName, nodeKey)
                                : override.monitor === false
                                  ? NO_MONITOR
                                  : override.monitor || ''
                            }
                            onChange={(e) => {
                              if (perNodeMonitor) {
                                setNodeMonitor(containerName, nodeKey, e.target.value);
                              } else if (e.target.value === '') {
                                removeOverride(containerName, 'monitor');
                              } else if (e.target.value === NO_MONITOR) {
                                updateOverride(containerName, 'monitor', false);
                              } else {
                                updateOverride(containerName, 'monitor', e.target.value);
                              }
                            }}
                            style={{ fontSize: 13 }}
                          >
                            <option value="">Auto-match</option>
                            <option value={NO_MONITOR}>No monitor</option>
                            {(monitorNames || []).map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </FieldRow>

                        {hasOverride && (
                          <button
                            className="settings-btn-danger settings-btn-compact"
                            onClick={() => removeAllOverrides(containerName, svc.display_name)}
                            style={{ alignSelf: 'flex-start' }}
                          >
                            Remove All Overrides
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {Object.keys(nodes).length === 0 && (
        <div className="settings-loading" style={{ justifyContent: 'center', fontSize: 13 }}>
          No services discovered yet. Check that Prometheus and cAdvisor are running.
        </div>
      )}
    </div>
  );
}
