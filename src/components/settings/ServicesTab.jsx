import React, { useState, useEffect } from 'react';

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
export default function ServicesTab({ serverConfig, liveServices, monitorNames, onSave, saving }) {
  const [expandedNode, setExpandedNode] = useState(null);
  const [editService, setEditService] = useState(null);

  const nodes = liveServices?.nodes || {};
  const overrides = serverConfig?.services || {};

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

  const toggleHide = (nodeKey, containerName) => {
    const node = serverConfig.nodes?.[nodeKey];
    if (!node) return;
    const hideList = node.hide || [];
    const isHidden = hideList.some(h => containerName.toLowerCase().includes(h.toLowerCase()));
    let updated;
    if (isHidden) {
      updated = hideList.filter(h => !containerName.toLowerCase().includes(h.toLowerCase()));
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
    return hideList.some(h => containerName.toLowerCase().includes(h.toLowerCase()));
  };

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
        Services are auto-discovered from Prometheus/cAdvisor. Override display names, icons, and monitor mappings here.
      </p>

      {saving && (
        <div style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 12, fontFamily: 'var(--font-mono)' }}>
          Saving...
        </div>
      )}

      {Object.entries(nodes).map(([nodeKey, node]) => (
        <div key={nodeKey} style={{ marginBottom: 16 }}>
          {/* Node group header */}
          <div
            onClick={() => setExpandedNode(expandedNode === nodeKey ? null : nodeKey)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px', cursor: 'pointer',
              background: 'var(--bg-card-inner)', borderRadius: 10,
              border: '1px solid var(--border-color)',
              borderLeft: `3px solid ${node.border_color || 'var(--accent)'}`,
            }}
          >
            <span style={{ fontSize: 18 }}>{node.icon || '🖥'}</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, flex: 1 }}>
              {node.display_name || nodeKey}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
              {(node.services || []).length} services
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', transform: expandedNode === nodeKey ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
              ▼
            </span>
          </div>

          {/* Services list */}
          {expandedNode === nodeKey && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(node.services || []).map(svc => {
                const containerName = svc.container;
                const override = overrides[containerName] || {};
                const isEditing = editService === containerName;
                const hidden = isHidden(nodeKey, containerName);
                const hasOverride = Object.keys(override).length > 0;
                const monitorMatch = svc.monitored === true || svc.status === 'up';

                return (
                  <div key={containerName} style={{
                    padding: '10px 14px',
                    background: hidden ? 'rgba(255,255,255,0.01)' : 'var(--bg-card-inner)',
                    borderRadius: 10,
                    border: `1px solid ${isEditing ? 'var(--accent)' : 'var(--border-color)'}`,
                    opacity: hidden ? 0.5 : 1,
                    transition: 'all 0.2s',
                  }}>
                    {/* Service row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {/* Status dot */}
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background: svc.status === 'up' ? 'var(--green)' : svc.status === 'down' ? 'var(--red)' : 'var(--amber)',
                        boxShadow: `0 0 6px ${svc.status === 'up' ? 'var(--green)' : svc.status === 'down' ? 'var(--red)' : 'var(--amber)'}`,
                      }} />

                      {/* Name */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500 }}>
                          {svc.display_name}
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
                          {containerName}
                          {hasOverride && <span style={{ color: 'var(--accent)', marginLeft: 6 }}>· overridden</span>}
                        </div>
                      </div>

                      {/* Monitor status */}
                      <span style={{
                        fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 8px',
                        borderRadius: 4,
                        background: monitorMatch ? 'var(--green-bg)' : 'var(--amber-bg)',
                        color: monitorMatch ? 'var(--green)' : 'var(--amber)',
                        border: `1px solid ${monitorMatch ? 'var(--green-border)' : 'var(--amber-border)'}`,
                      }}>
                        {monitorMatch ? 'monitored' : 'no monitor'}
                      </span>

                      {/* Actions */}
                      <button
                        className="settings-btn"
                        onClick={() => toggleHide(nodeKey, containerName)}
                        style={{ flex: 0, padding: '4px 10px', fontSize: 11, color: hidden ? 'var(--green)' : 'var(--text-muted)' }}
                      >
                        {hidden ? 'Show' : 'Hide'}
                      </button>
                      <button
                        className="settings-btn"
                        onClick={() => setEditService(isEditing ? null : containerName)}
                        style={{ flex: 0, padding: '4px 10px', fontSize: 11 }}
                      >
                        {isEditing ? 'Close' : 'Edit'}
                      </button>
                    </div>

                    {/* Expanded edit form */}
                    {isEditing && (
                      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 10, borderTop: '1px solid var(--border-color)' }}>
                        <FieldRow label="Display Name">
                          <input
                            className="settings-input"
                            value={override.display_name || ''}
                            onChange={e => updateOverride(containerName, 'display_name', e.target.value)}
                            placeholder={svc.display_name}
                          />
                        </FieldRow>

                        <FieldRow label="Icon Key">
                          <input
                            className="settings-input"
                            value={override.icon || ''}
                            onChange={e => updateOverride(containerName, 'icon', e.target.value)}
                            placeholder="auto (e.g. npm, adguard, photoprism)"
                            style={{ fontFamily: 'var(--font-mono)' }}
                          />
                        </FieldRow>

                        <FieldRow label="Uptime Kuma Monitor">
                          <select
                            className="settings-input"
                            value={override.monitor || ''}
                            onChange={e => {
                              if (e.target.value === '') {
                                removeOverride(containerName, 'monitor');
                              } else {
                                updateOverride(containerName, 'monitor', e.target.value);
                              }
                            }}
                            style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
                          >
                            <option value="">Auto-match</option>
                            {(monitorNames || []).map(name => (
                              <option key={name} value={name}>{name}</option>
                            ))}
                          </select>
                        </FieldRow>

                        {hasOverride && (
                          <button
                            className="settings-btn"
                            onClick={() => {
                              const updatedServices = { ...serverConfig.services };
                              delete updatedServices[containerName];
                              onSave({ ...serverConfig, services: updatedServices });
                              setEditService(null);
                            }}
                            style={{ alignSelf: 'flex-start', padding: '6px 14px', fontSize: 11, color: 'var(--red)', borderColor: 'var(--red-border)' }}
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
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          No services discovered yet. Check that Prometheus and cAdvisor are running.
        </div>
      )}
    </div>
  );
}

function FieldRow({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: 0.5 }}>{label}</span>
      {children}
    </div>
  );
}
