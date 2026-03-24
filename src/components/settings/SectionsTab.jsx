import React, { useState, useEffect, useCallback } from 'react';
import { HexColorPicker } from 'react-colorful';
import IconPicker from '../IconPicker';

/**
 * SectionsTab — Phase 2 Settings + Phase 3 Custom Groups
 * 
 * Manages display settings for static dashboard sections
 * (UPS, Pipeline, Quick Launch, Todos) that aren't driven by nodes.
 * Node sections are managed in the Nodes tab.
 * 
 * Also manages Custom Groups — user-created panels that pull containers
 * from any node into a custom arrangement (inspired by Homepage groups).
 */

const STATIC_SECTIONS = [
  { key: 'ups', defaultTitle: 'UPS Power', defaultIcon: '⚡' },
  { key: 'pipeline', defaultTitle: 'Pipeline Activity', defaultIcon: '🔄' },
  { key: 'quicklaunch', defaultTitle: 'Quick Launch', defaultIcon: '🚀' },
  { key: 'todos', defaultTitle: 'Checklist', defaultIcon: '✅' },
];

export default function SectionsTab({ config, update }) {
  const sections = config.sections || {};
  const [colorTarget, setColorTarget] = useState(null);
  const [colorValue, setColorValue] = useState('#6366f1');

  // Custom groups state
  const customGroups = config.customGroups || [];
  const [editingGroup, setEditingGroup] = useState(null); // group id or null
  const [allContainers, setAllContainers] = useState([]);

  // Fetch all containers for the assignment UI
  useEffect(() => {
    fetch('/api/services')
      .then(r => r.ok ? r.json() : { nodes: {} })
      .then(data => {
        const containers = [];
        for (const [nodeKey, node] of Object.entries(data.nodes || {})) {
          for (const s of (node.services || [])) {
            containers.push({
              container: s.container,
              name: s.display_name,
              node: node.display_name || nodeKey,
            });
          }
        }
        setAllContainers(containers);
      })
      .catch(() => {});
  }, []);

  const openColor = (path, currentColor) => {
    setColorTarget(path);
    setColorValue(currentColor || '#6366f1');
  };

  const applyColor = () => {
    if (colorTarget) {
      update(colorTarget, colorValue);
      setColorTarget(null);
    }
  };

  // ── Custom Group helpers ──
  const addGroup = () => {
    const id = `custom-${Date.now()}`;
    const newGroup = {
      id,
      title: 'New Group',
      icon: '📂',
      borderColor: '#6366f1',
      containers: [],
    };
    update('customGroups', [...customGroups, newGroup]);
    setEditingGroup(id);
  };

  const updateGroup = (groupId, field, value) => {
    const updated = customGroups.map(g =>
      g.id === groupId ? { ...g, [field]: value } : g
    );
    update('customGroups', updated);
  };

  const deleteGroup = (groupId) => {
    update('customGroups', customGroups.filter(g => g.id !== groupId));
    if (editingGroup === groupId) setEditingGroup(null);
  };

  const toggleContainer = (groupId, containerName) => {
    const group = customGroups.find(g => g.id === groupId);
    if (!group) return;
    const has = group.containers.includes(containerName);
    const updated = has
      ? group.containers.filter(c => c !== containerName)
      : [...group.containers, containerName];
    updateGroup(groupId, 'containers', updated);
  };

  // Build set of containers already claimed by ANY custom group
  const claimedSet = new Set();
  for (const g of customGroups) {
    for (const c of (g.containers || [])) {
      claimedSet.add(c);
    }
  }

  return (
    <div className="settings-section">
      <p className="settings-desc" style={{ marginBottom: 16 }}>
        Customize the appearance of dashboard sections. Node sections (Gateway, Production, Staging) are managed in the Nodes tab.
      </p>

      {colorTarget && (
        <div className="settings-card" style={{ borderColor: 'var(--accent)' }}>
          <HexColorPicker color={colorValue} onChange={setColorValue} style={{ width: '100%', maxWidth: 300, height: 150 }} />
          <div className="settings-actions">
            <input
              className="settings-input mono flex-1"
              value={colorValue}
              onChange={e => setColorValue(e.target.value)}
            />
            <button className="settings-btn-primary" onClick={applyColor} style={{ background: colorValue }}>Apply</button>
            <button className="settings-btn-sm" onClick={() => setColorTarget(null)}>Cancel</button>
          </div>
        </div>
      )}

      {STATIC_SECTIONS.map(({ key, defaultTitle, defaultIcon }) => {
        const s = sections[key] || {};
        return (
          <div key={key} className="settings-card" style={{ borderLeft: `3px solid ${s.borderColor || '#6366f1'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <input
                type="checkbox"
                checked={s.visible !== false}
                onChange={e => update(`sections.${key}.visible`, e.target.checked)}
                className="settings-checkbox"
              />
              <span style={{ fontSize: 22 }}>
                {(s.icon || defaultIcon)?.startsWith('http') || (s.icon || defaultIcon)?.startsWith('/')
                  ? <img src={s.icon || defaultIcon} alt="" style={{ width: 24, height: 24, borderRadius: 4 }} />
                  : (s.icon || defaultIcon)
                }
              </span>
              <span className="settings-item-title" style={{ fontSize: 15, flex: 1 }}>
                {s.title || defaultTitle}
              </span>
              <div className="settings-row" style={{ gap: 6 }}>
                <div
                  title="Border color"
                  style={{
                    width: 26, height: 26, borderRadius: 6,
                    background: s.borderColor || '#6366f1',
                    cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)',
                  }}
                  onClick={() => openColor(`sections.${key}.borderColor`, s.borderColor)}
                />
                <div
                  title="Background color"
                  style={{
                    width: 26, height: 26, borderRadius: 6,
                    background: s.bgColor || 'transparent',
                    cursor: 'pointer', border: '1px dashed rgba(255,255,255,0.2)',
                  }}
                  onClick={() => openColor(`sections.${key}.bgColor`, s.bgColor || '#1a1c3a')}
                />
              </div>
            </div>

            <div className="settings-stack" style={{ gap: 10 }}>
              <Field label="Title">
                <input
                  className="settings-input"
                  value={s.title || ''}
                  onChange={e => update(`sections.${key}.title`, e.target.value)}
                  placeholder={defaultTitle}
                />
              </Field>
              <Field label="Subtitle">
                <input
                  className="settings-input"
                  value={s.subtitle || ''}
                  onChange={e => update(`sections.${key}.subtitle`, e.target.value)}
                  placeholder="Optional subtitle"
                />
              </Field>
              <Field label="Icon">
                <IconPicker
                  value={s.icon || ''}
                  onChange={url => update(`sections.${key}.icon`, url)}
                  onClear={() => update(`sections.${key}.icon`, '')}
                />
              </Field>
              <div className="settings-row text-mono text-muted" style={{ fontSize: 11 }}>
                <span>Background Opacity: {((s.bgOpacity ?? 0) * 100).toFixed(0)}%</span>
                <input
                  type="range" min="0" max="1" step="0.05"
                  value={s.bgOpacity ?? 0}
                  onChange={e => update(`sections.${key}.bgOpacity`, parseFloat(e.target.value))}
                  style={{ flex: 1, accentColor: s.borderColor || 'var(--accent)' }}
                />
              </div>
            </div>
          </div>
        );
      })}

      {/* ═══════════════════════════════════════════
          CUSTOM GROUPS
          ═══════════════════════════════════════════ */}
      <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border-color)' }}>
        <div className="settings-row-spread" style={{ marginBottom: 16 }}>
          <div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, margin: 0 }}>Custom Groups</h3>
            <p className="settings-hint-block" style={{ margin: '4px 0 0' }}>
              Create custom panels and assign containers from any node.
            </p>
          </div>
          <button className="settings-btn-primary" onClick={addGroup}>
            + New Group
          </button>
        </div>

        {customGroups.length === 0 && (
          <div style={{
            padding: 32, textAlign: 'center', color: 'var(--text-muted)',
            background: 'var(--bg-card-inner)', borderRadius: 16,
            border: '1px dashed var(--border-color)',
          }}>
            <span style={{ fontSize: 28, display: 'block', marginBottom: 8 }}>📂</span>
            <p style={{ fontSize: 13, margin: 0 }}>No custom groups yet. Create one to organize containers your way.</p>
          </div>
        )}

        {customGroups.map(group => {
          const isEditing = editingGroup === group.id;
          return (
            <div key={group.id} className="settings-card" style={{
              borderLeft: `3px solid ${group.borderColor || '#6366f1'}`,
              marginBottom: 12,
            }}>
              {/* Group header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: isEditing ? 14 : 0 }}>
                <span style={{ fontSize: 20 }}>
                  {(group.icon || '📂')?.startsWith('http') || (group.icon || '')?.startsWith('/')
                    ? <img src={group.icon} alt="" style={{ width: 22, height: 22, borderRadius: 4 }} />
                    : (group.icon || '📂')
                  }
                </span>
                <span className="settings-item-title" style={{ fontSize: 15, flex: 1 }}>
                  {group.title}
                </span>
                <span className="settings-item-subtitle">
                  {(group.containers || []).length} services
                </span>
                <button
                  className="settings-btn-sm"
                  onClick={() => setEditingGroup(isEditing ? null : group.id)}
                  style={{ padding: '4px 12px', fontSize: 11 }}
                >
                  {isEditing ? 'Done' : 'Edit'}
                </button>
                <button
                  className="settings-btn-danger settings-btn-compact"
                  onClick={() => deleteGroup(group.id)}
                >
                  ✕
                </button>
              </div>

              {/* Expanded edit form */}
              {isEditing && (
                <div className="settings-stack" style={{ gap: 12, paddingTop: 12, borderTop: '1px solid var(--border-color)' }}>
                  <div className="settings-row" style={{ gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <Field label="Group Title">
                        <input
                          className="settings-input"
                          value={group.title || ''}
                          onChange={e => updateGroup(group.id, 'title', e.target.value)}
                          placeholder="Databases"
                        />
                      </Field>
                    </div>
                    <div>
                      <Field label="Icon">
                        <IconPicker
                          compact
                          value={group.icon || ''}
                          onChange={url => updateGroup(group.id, 'icon', url)}
                        />
                      </Field>
                    </div>
                    <div>
                      <Field label="Color">
                        <div
                          style={{
                            width: 36, height: 36, borderRadius: 8,
                            background: group.borderColor || '#6366f1',
                            cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)',
                          }}
                          onClick={() => openColor(`__group_color_${group.id}`, group.borderColor)}
                        />
                      </Field>
                    </div>
                  </div>

                  {/* Color picker for group (reuse same color picker) */}
                  {colorTarget === `__group_color_${group.id}` && (
                    <div>
                      <HexColorPicker color={colorValue} onChange={setColorValue} style={{ width: '100%', maxWidth: 280, height: 130 }} />
                      <div className="settings-actions" style={{ marginTop: 8 }}>
                        <button className="settings-btn-primary" onClick={() => {
                          updateGroup(group.id, 'borderColor', colorValue);
                          setColorTarget(null);
                        }} style={{ background: colorValue }}>Apply</button>
                        <button className="settings-btn-sm" onClick={() => setColorTarget(null)}>Cancel</button>
                      </div>
                    </div>
                  )}

                  {/* Container assignment */}
                  <div>
                    <span className="settings-item-subtitle" style={{ letterSpacing: 0.5 }}>
                      Assigned Containers (click to remove)
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, minHeight: 32 }}>
                      {(group.containers || []).length === 0 && (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>None assigned — pick from below</span>
                      )}
                      {(group.containers || []).map(c => {
                        const svc = allContainers.find(s => s.container === c);
                        return (
                          <button
                            key={c}
                            onClick={() => toggleContainer(group.id, c)}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 5,
                              padding: '4px 10px', borderRadius: 6, fontSize: 12,
                              fontFamily: 'var(--font-body)', cursor: 'pointer',
                              background: 'var(--accent-glow)', color: 'var(--accent)',
                              border: '1px solid var(--accent)',
                            }}
                          >
                            {svc?.name || c}
                            <span style={{ fontSize: 10, opacity: 0.7 }}>✕</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <span className="settings-item-subtitle" style={{ letterSpacing: 0.5 }}>
                      Available Containers (click to add)
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      {allContainers
                        .filter(c => !group.containers.includes(c.container))
                        .filter(c => !claimedSet.has(c.container) || group.containers.includes(c.container))
                        .map(c => (
                          <button
                            key={c.container}
                            onClick={() => toggleContainer(group.id, c.container)}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 5,
                              padding: '4px 10px', borderRadius: 6, fontSize: 12,
                              fontFamily: 'var(--font-body)', cursor: 'pointer',
                              background: 'var(--bg-card-inner)', color: 'var(--text-secondary)',
                              border: '1px solid var(--border-color)',
                            }}
                          >
                            {c.name}
                            <span style={{ fontSize: 9, opacity: 0.5 }}>({c.node})</span>
                          </button>
                        ))
                      }
                      {allContainers.length === 0 && (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading containers...</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="settings-field">
      <label className="settings-label">{label}</label>
      {children}
    </div>
  );
}
