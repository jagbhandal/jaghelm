import React, { useState } from 'react';
import IconPicker from '../IconPicker';
import { FieldRow } from './Field';
import { SettingsIcon } from './primitives.jsx';
import ColorPickerPopover from './ColorPickerPopover.jsx';

/**
 * NodesTab — Phase 2 Settings
 * 
 * Manages node definitions from services.yaml.
 * Each node maps to a Prometheus node label and controls:
 * - Display name, subtitle, icon, border color
 * - Visibility toggle
 * - Auto-discover toggle
 * - Hide list (containers to exclude from this node)
 */
export default function NodesTab({ serverConfig, onSave, saving }) {
  const nodes = serverConfig?.nodes || {};
  const [editNode, setEditNode] = useState(null);
  const [colorPicking, setColorPicking] = useState(null);

  const updateNode = (nodeKey, field, value) => {
    const updated = {
      ...serverConfig,
      nodes: {
        ...serverConfig.nodes,
        [nodeKey]: {
          ...serverConfig.nodes[nodeKey],
          [field]: value,
        },
      },
    };
    onSave(updated);
  };

  const removeHideItem = (nodeKey, item) => {
    const node = serverConfig.nodes[nodeKey];
    const updated = (node.hide || []).filter(h => h !== item);
    updateNode(nodeKey, 'hide', updated);
  };

  const addHideItem = (nodeKey, item) => {
    if (!item.trim()) return;
    const node = serverConfig.nodes[nodeKey];
    const current = node.hide || [];
    if (current.includes(item.trim())) return;
    updateNode(nodeKey, 'hide', [...current, item.trim()]);
  };

  const applyColor = (color) => {
    if (colorPicking) {
      updateNode(colorPicking, 'border_color', color);
      setColorPicking(null);
    }
  };

  return (
    <div>
      <p className="settings-desc" style={{ marginBottom: 16 }}>
        Nodes are auto-discovered from Prometheus. Customize how each node appears on the dashboard.
      </p>

      {saving && (
        <div className="settings-saving" style={{ marginBottom: 12 }}>
          Saving...
        </div>
      )}

      {colorPicking && (
        <div style={{ marginBottom: 20, padding: 16, background: 'var(--bg-card-inner)', borderRadius: 14, border: '1px solid var(--border-color)' }}>
          <ColorPickerPopover
            value={nodes[colorPicking]?.border_color || '#6366f1'}
            onApply={applyColor}
            onCancel={() => setColorPicking(null)}
          />
        </div>
      )}

      {Object.entries(nodes).map(([key, node]) => (
        <div key={key} style={{
          marginBottom: 12, padding: '16px 18px',
          background: 'var(--bg-card-inner)', borderRadius: 14,
          border: `1px solid ${editNode === key ? 'var(--accent)' : 'var(--border-color)'}`,
          borderLeft: `3px solid ${node.border_color || '#6366f1'}`,
          transition: 'border-color 0.2s',
        }}>
          {/* Node header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: editNode === key ? 14 : 0 }}>
            <input
              type="checkbox"
              checked={node.visible !== false}
              onChange={e => updateNode(key, 'visible', e.target.checked)}
              className="settings-checkbox"
            />
            <span style={{ fontSize: 22, display: 'inline-flex', alignItems: 'center' }}>
              <SettingsIcon value={node.icon} fallback="🖥" size={24} />
            </span>
            <div className="flex-1">
              <div className="settings-item-title" style={{ fontSize: 15 }}>
                {node.display_name || key}
              </div>
              <div className="settings-item-subtitle">
                {node.subtitle || ''} · prometheus: {node.prometheus_node || key}
              </div>
            </div>
            <div
              className="settings-color-swatch"
              style={{ width: 26, height: 26, borderRadius: 6, background: node.border_color || '#6366f1' }}
              onClick={() => setColorPicking(key)}
              title="Border color"
            />
            <button
              className="settings-btn"
              onClick={() => setEditNode(editNode === key ? null : key)}
              style={{ flex: 0, padding: '6px 12px', fontSize: 12 }}
            >
              {editNode === key ? 'Close' : 'Edit'}
            </button>
          </div>

          {/* Expanded edit form */}
          {editNode === key && (
            <div className="settings-stack" style={{ gap: 10 }}>
              <FieldRow label="Display Name">
                <input
                  className="settings-input"
                  value={node.display_name || ''}
                  onChange={e => updateNode(key, 'display_name', e.target.value)}
                  placeholder={key}
                />
              </FieldRow>
              <FieldRow label="Subtitle">
                <input
                  className="settings-input"
                  value={node.subtitle || ''}
                  onChange={e => updateNode(key, 'subtitle', e.target.value)}
                  placeholder="e.g. Raspberry Pi 5"
                />
              </FieldRow>
              <FieldRow label="Icon">
                <IconPicker
                  compact
                  value={node.icon || ''}
                  onChange={url => updateNode(key, 'icon', url)}
                  onClear={() => updateNode(key, 'icon', '')}
                />
              </FieldRow>
              <FieldRow label="Prometheus Node Label">
                <input
                  className="settings-input mono"
                  value={node.prometheus_node || ''}
                  onChange={e => updateNode(key, 'prometheus_node', e.target.value)}
                  placeholder={key}
                />
              </FieldRow>

              <label className="settings-checkbox-label" style={{ gap: 12 }}>
                <input
                  type="checkbox"
                  checked={node.auto_discover !== false}
                  onChange={e => updateNode(key, 'auto_discover', e.target.checked)}
                  className="settings-checkbox"
                  style={{ width: 16, height: 16 }}
                />
                <span className="settings-checkbox-text" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  Auto-discover new containers
                </span>
              </label>

              {/* Hide list */}
              <div>
                <span className="settings-item-subtitle" style={{ letterSpacing: 0.5 }}>
                  HIDDEN CONTAINERS
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {(node.hide || []).map((h, i) => (
                    <span key={i} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '4px 10px', borderRadius: 6, fontSize: 12,
                      fontFamily: 'var(--font-mono)',
                      background: 'var(--red-bg)', color: 'var(--red)',
                      border: '1px solid var(--red-border)',
                    }}>
                      {h}
                      <span
                        style={{ cursor: 'pointer', opacity: 0.7, marginLeft: 2 }}
                        onClick={() => removeHideItem(key, h)}
                      >✕</span>
                    </span>
                  ))}
                  <AddChip onAdd={(val) => addHideItem(key, val)} placeholder="+ container name" />
                </div>
              </div>
            </div>
          )}
        </div>
      ))}

      {Object.keys(nodes).length === 0 && (
        <div className="settings-loading" style={{ justifyContent: 'center', fontSize: 13 }}>
          No nodes discovered yet. Make sure Prometheus is configured and reachable.
        </div>
      )}
    </div>
  );
}

function AddChip({ onAdd, placeholder }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  if (!editing) {
    return (
      <span
        onClick={() => setEditing(true)}
        style={{
          display: 'inline-flex', alignItems: 'center',
          padding: '4px 10px', borderRadius: 6, fontSize: 12,
          fontFamily: 'var(--font-mono)', cursor: 'pointer',
          background: 'var(--bg-card-inner)', color: 'var(--text-muted)',
          border: '1px dashed var(--border-color)',
        }}
      >
        {placeholder}
      </span>
    );
  }

  return (
    <input
      autoFocus
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter' && value.trim()) { onAdd(value.trim()); setValue(''); setEditing(false); }
        if (e.key === 'Escape') { setValue(''); setEditing(false); }
      }}
      onBlur={() => { if (value.trim()) onAdd(value.trim()); setValue(''); setEditing(false); }}
      style={{
        padding: '4px 10px', borderRadius: 6, fontSize: 12,
        fontFamily: 'var(--font-mono)', width: 140,
        background: 'var(--bg-card-inner)', color: 'var(--text-primary)',
        border: '1px solid var(--accent)', outline: 'none',
      }}
      placeholder="container name"
    />
  );
}
