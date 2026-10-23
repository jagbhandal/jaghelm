import React, { useState, useEffect } from 'react';
import IconPicker from '../IconPicker';
import Field from './Field';
import { EmptyState, SettingsIcon } from './primitives.jsx';
import ColorPickerPopover, { DEFAULT_COLOR } from './ColorPickerPopover.jsx';
import { useConfig } from '../../context/ConfigContext.jsx';
import { useConfirm } from '../../context/OverlayContext.jsx';
import { apiFetch } from '../../api/client.js';
import {
  groupChoices,
  groupEntries,
  heldUids,
  migrateGroups,
  unmatchedEntries,
} from '../../shell/customGroups.js';

/**
 * SectionsTab — Phase 2 Settings + Phase 3 Custom Groups
 *
 * Manages display settings for static dashboard sections
 * (UPS, Pipeline, Quick Launch, Todos) that aren't driven by nodes.
 * Node sections are managed in the Nodes tab.
 *
 * Also manages Custom Groups: the Overview's Services section can group by
 * them (#300). A group holds services by uid (#517, src/shell/customGroups.js),
 * so the same container on two nodes is two services, and every service the
 * status model has can be grouped, a Kuma monitor with no container too. A
 * group has a title and its services, nothing else: no icon or colour (#295)
 * and no hidden flag (the Overview's show/hide is Settings → Appearance's).
 * A group saved before #517 (bare container names) shows each name as the
 * services of that name, and is written back as uids at its next change here.
 */

const STATIC_SECTIONS = [
  { key: 'ups', defaultTitle: 'UPS Power', defaultIcon: '⚡' },
  { key: 'pipeline', defaultTitle: 'Pipeline Activity', defaultIcon: '🔄' },
  { key: 'quicklaunch', defaultTitle: 'Quick Launch', defaultIcon: '🚀' },
  { key: 'todos', defaultTitle: 'Checklist', defaultIcon: '✅' },
];

// A group's service chips: those it holds (click to remove), the rest (click to add).
const CHIPS = { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, minHeight: 32 };
const CHIP = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '4px 10px',
  borderRadius: 6,
  fontSize: 12,
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
};
const HELD = {
  ...CHIP,
  background: 'var(--accent-glow)',
  color: 'var(--accent)',
  border: '1px solid var(--accent)',
};
const FREE = {
  ...CHIP,
  background: 'var(--bg-card-inner)',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-color)',
};

export default function SectionsTab() {
  const { config, update } = useConfig();
  const confirm = useConfirm();
  const sections = config.sections || {};
  const [colorTarget, setColorTarget] = useState(null);
  // Seed color for the popover when a swatch is opened; the popover owns the
  // live draft from there and reports the committed value back on Apply.
  const [colorSeed, setColorSeed] = useState(DEFAULT_COLOR);

  // Custom groups state (a hand-edited entry that is no group is left out)
  const customGroups = Array.isArray(config.customGroups)
    ? config.customGroups.filter((g) => g && typeof g === 'object')
    : [];
  const [editingGroup, setEditingGroup] = useState(null); // group id or null
  // The services a group can hold: undefined while /api/status and
  // /api/services are on their way, then groupChoices' (null when neither
  // answered).
  const [choices, setChoices] = useState(undefined);

  useEffect(() => {
    let live = true;
    const read = (path) =>
      apiFetch(path)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    Promise.all([read('/api/status'), read('/api/services')]).then(([status, services]) => {
      if (live) setChoices(groupChoices({ status, services }));
    });
    return () => {
      live = false;
    };
  }, []);
  const services = choices?.services ?? [];

  const openColor = (path, currentColor) => {
    setColorTarget(path);
    setColorSeed(currentColor || DEFAULT_COLOR);
  };

  const applyColor = (color) => {
    if (colorTarget) {
      update(colorTarget, color);
      setColorTarget(null);
    }
  };

  // ── Custom Group helpers ──
  // Every write of the groups saves them as uids (migrateGroups), once the
  // services are read; before, as they are.
  const saveGroups = (next) => update('customGroups', migrateGroups(next, choices ?? null));

  const addGroup = () => {
    const id = `custom-${Date.now()}`;
    saveGroups([...customGroups, { id, title: 'New Group', containers: [] }]);
    setEditingGroup(id);
  };

  const updateGroup = (groupId, change) =>
    saveGroups(
      migrateGroups(customGroups, choices ?? null).map((g) =>
        g.id === groupId ? { ...g, ...change(g) } : g
      )
    );

  const deleteGroup = async (groupId) => {
    const group = customGroups.find((g) => g.id === groupId);
    const ok = await confirm({
      title: `Delete the "${group?.title || 'custom'}" group?`,
      body: 'This removes the custom group. Its services go back to the list. This cannot be undone.',
      confirmLabel: 'Delete Group',
      danger: true,
    });
    if (!ok) return;
    saveGroups(customGroups.filter((g) => g.id !== groupId));
    if (editingGroup === groupId) setEditingGroup(null);
  };

  // Add a service (by uid), or take an entry out (a uid, or a name no service has).
  const addService = (groupId, uid) =>
    updateGroup(groupId, (g) => ({
      containers: groupEntries(g).includes(uid) ? groupEntries(g) : [...groupEntries(g), uid],
    }));
  const removeEntry = (groupId, entry) =>
    updateGroup(groupId, (g) => ({ containers: groupEntries(g).filter((e) => e !== entry) }));

  // The services some group already holds: a service is in one group.
  const claimed = new Set(customGroups.flatMap((g) => heldUids(g, services)));
  const byUid = new Map(services.map((s) => [s.uid, s]));
  const label = (s) => `${s.name} (${s.nodeName || s.node})`;

  return (
    <div className="settings-section">
      <p className="settings-desc" style={{ marginBottom: 16 }}>
        Customize the appearance of dashboard sections. Node sections are managed in the Nodes tab.
        The UPS and Pipeline sections show on the dashboard only when their source is set up: a UPS
        from the NUT exporter, and Gitea with GITEA_URL set. Unchecking one hides it either way.
      </p>

      {colorTarget && (
        <div className="settings-card" style={{ borderColor: 'var(--accent)' }}>
          <ColorPickerPopover
            value={colorSeed}
            onApply={applyColor}
            onCancel={() => setColorTarget(null)}
          />
        </div>
      )}

      {STATIC_SECTIONS.map(({ key, defaultTitle, defaultIcon }) => {
        const s = sections[key] || {};
        return (
          <div
            key={key}
            className="settings-card"
            style={{ borderLeft: `3px solid ${s.borderColor || DEFAULT_COLOR}` }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <input
                type="checkbox"
                checked={s.visible !== false}
                onChange={(e) => update(`sections.${key}.visible`, e.target.checked)}
                className="settings-checkbox"
              />
              <span style={{ fontSize: 22 }}>
                <SettingsIcon value={s.icon} fallback={defaultIcon} size={24} />
              </span>
              <span className="settings-item-title" style={{ fontSize: 15, flex: 1 }}>
                {s.title || defaultTitle}
              </span>
              <div className="settings-row" style={{ gap: 6 }}>
                <div
                  title="Border color"
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 6,
                    background: s.borderColor || DEFAULT_COLOR,
                    cursor: 'pointer',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                  onClick={() => openColor(`sections.${key}.borderColor`, s.borderColor)}
                />
                <div
                  title="Background color"
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 6,
                    background: s.bgColor || 'transparent',
                    cursor: 'pointer',
                    border: '1px dashed rgba(255,255,255,0.2)',
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
                  onChange={(e) => update(`sections.${key}.title`, e.target.value)}
                  placeholder={defaultTitle}
                />
              </Field>
              <Field label="Subtitle">
                <input
                  className="settings-input"
                  value={s.subtitle || ''}
                  onChange={(e) => update(`sections.${key}.subtitle`, e.target.value)}
                  placeholder="Optional subtitle"
                />
              </Field>
              <Field label="Icon">
                <IconPicker
                  value={s.icon || ''}
                  onChange={(url) => update(`sections.${key}.icon`, url)}
                  onClear={() => update(`sections.${key}.icon`, '')}
                />
              </Field>
              <div className="settings-row text-mono muted-text" style={{ fontSize: 11 }}>
                <span>Background Opacity: {((s.bgOpacity ?? 0) * 100).toFixed(0)}%</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={s.bgOpacity ?? 0}
                  onChange={(e) => update(`sections.${key}.bgOpacity`, parseFloat(e.target.value))}
                  style={{ flex: 1, accentColor: s.borderColor || 'var(--accent)' }}
                />
              </div>
            </div>
          </div>
        );
      })}

      {/* Custom Groups */}
      <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border-color)' }}>
        <div className="settings-row-spread" style={{ marginBottom: 16 }}>
          <div>
            <h3
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: 16,
                margin: 0,
              }}
            >
              Custom Groups
            </h3>
            <p className="settings-hint-block" style={{ margin: '4px 0 0' }}>
              Group services from any node. The Overview&apos;s Services section can list them by
              these groups.
            </p>
          </div>
          <button className="settings-btn-primary" onClick={addGroup}>
            + New Group
          </button>
        </div>

        {customGroups.length === 0 && (
          <EmptyState icon="📂">
            No custom groups yet. Create one to group services your way.
          </EmptyState>
        )}

        {customGroups.map((group) => {
          const isEditing = editingGroup === group.id;
          const title = group.title || 'Group';
          const held = heldUids(group, services);
          const unmatched = choices ? unmatchedEntries(group, services) : groupEntries(group);
          return (
            <section
              key={group.id}
              aria-label={title}
              className="settings-card"
              style={{ borderLeft: '3px solid var(--border-color)', marginBottom: 12 }}
            >
              {/* Group header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  marginBottom: isEditing ? 14 : 0,
                }}
              >
                <span className="settings-item-title" style={{ fontSize: 15, flex: 1 }}>
                  {group.title}
                </span>
                {choices && (
                  <span className="settings-item-subtitle">
                    {held.length} {held.length === 1 ? 'service' : 'services'}
                  </span>
                )}
                <button
                  className="settings-btn-sm"
                  onClick={() => setEditingGroup(isEditing ? null : group.id)}
                  style={{ padding: '4px 12px', fontSize: 11 }}
                >
                  {isEditing ? 'Done' : 'Edit'}
                </button>
                <button
                  className="settings-btn-danger settings-btn-compact"
                  aria-label={`Delete ${title}`}
                  onClick={() => deleteGroup(group.id)}
                >
                  ✕
                </button>
              </div>

              {/* Expanded edit form */}
              {isEditing && (
                <div
                  className="settings-stack"
                  style={{ gap: 12, paddingTop: 12, borderTop: '1px solid var(--border-color)' }}
                >
                  <Field label="Group Title">
                    <input
                      className="settings-input"
                      value={group.title || ''}
                      onChange={(e) => updateGroup(group.id, () => ({ title: e.target.value }))}
                      placeholder="Databases"
                    />
                  </Field>

                  {!choices && (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {choices === undefined
                        ? 'Loading services…'
                        : "Couldn't read the services: try again later"}
                    </span>
                  )}

                  {choices && (
                    <>
                      <div>
                        <span className="settings-item-subtitle" style={{ letterSpacing: 0.5 }}>
                          In this group (click to remove)
                        </span>
                        <div role="group" aria-label={`In ${title}`} style={CHIPS}>
                          {held.length === 0 && unmatched.length === 0 && (
                            <span
                              style={{
                                fontSize: 12,
                                color: 'var(--text-muted)',
                                fontStyle: 'italic',
                              }}
                            >
                              None yet: pick from below
                            </span>
                          )}
                          {held.map((uid) => (
                            <button
                              key={uid}
                              onClick={() => removeEntry(group.id, uid)}
                              style={HELD}
                            >
                              {label(byUid.get(uid))}
                              <span aria-hidden="true" style={{ fontSize: 10, opacity: 0.7 }}>
                                ✕
                              </span>
                            </button>
                          ))}
                          {unmatched.map((entry) => (
                            <button
                              key={entry}
                              onClick={() => removeEntry(group.id, entry)}
                              style={{ ...HELD, opacity: 0.7 }}
                            >
                              {`${entry} (not found)`}
                              <span aria-hidden="true" style={{ fontSize: 10, opacity: 0.7 }}>
                                ✕
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <span className="settings-item-subtitle" style={{ letterSpacing: 0.5 }}>
                          Services (click to add)
                        </span>
                        <div role="group" aria-label="Services to add" style={CHIPS}>
                          {services
                            .filter((svc) => !claimed.has(svc.uid))
                            .map((svc) => (
                              <button
                                key={svc.uid}
                                onClick={() => addService(group.id, svc.uid)}
                                style={FREE}
                              >
                                {label(svc)}
                              </button>
                            ))}
                          {services.length === 0 && (
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              No services yet
                            </span>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
