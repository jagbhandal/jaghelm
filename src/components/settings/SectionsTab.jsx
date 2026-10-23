import React, { useState, useEffect } from 'react';
import Field from './Field';
import { Card, EmptyState, Toggle } from './primitives.jsx';
import { useConfig } from '../../context/ConfigContext.jsx';
import { useConfirm } from '../../context/OverlayContext.jsx';
import { apiFetch } from '../../api/client.js';
import {
  groupChoices,
  groupEntries,
  heldByName,
  heldUids,
  migrateGroups,
  unmatchedEntries,
} from '../../shell/customGroups.js';

/**
 * SectionsTab — the utilities' switches and Custom Groups
 *
 * A switch each for Quick Launch, Pipeline and the Checklist, which the
 * Overview's utilities rail draws (#301; the Launch page always has them).
 * The old board's panels had a title, subtitle, icon and colours of their
 * own here; the new sections have none (#306, the Settings map in spec §15),
 * and the UPS's switch is the Power section's, in Settings → Appearance →
 * Overview sections, as the other sections' are.
 *
 * Also manages Custom Groups: the Overview's Services section can group by
 * them (#300). A group holds services by uid (#517, src/shell/customGroups.js),
 * so the same container on two nodes is two services, and every service the
 * status model has can be grouped, a Kuma monitor with no container too. A
 * group has a title and its services, nothing else: no icon or colour (#295)
 * and no hidden flag (the Overview's show/hide is Settings → Appearance's).
 * A group saved before #517 (bare container names) shows each name as the
 * services of that name, and is written back as uids at its next change here;
 * while some node's services couldn't be read, a name is kept, and a service
 * it holds can't be taken out until they can.
 */

// The utilities' switches (`sections.<key>.visible`, the rail reads them).
const UTILITIES = [
  { key: 'quicklaunch', label: 'Quick Launch', description: 'Your links, by group' },
  {
    key: 'pipeline',
    label: 'Pipeline',
    description: 'The newest commits, when Gitea is set up (JAGHELM_GITEA_URL)',
  },
  { key: 'todos', label: 'Checklist', description: 'Your to-dos' },
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
    // services.yaml says which nodes there are, hidden ones too: whether the
    // list is every service (groupChoices' `complete`).
    Promise.all([read('/api/status'), read('/api/services'), read('/api/services/config')]).then(
      ([status, services, serverConfig]) => {
        if (live) setChoices(groupChoices({ status, services, serverConfig }));
      }
    );
    return () => {
      live = false;
    };
  }, []);
  const services = choices?.services ?? [];

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
      <Card title="Utilities">
        <p className="settings-hint-block" style={{ marginBottom: 8 }}>
          Beside the Overview from 1440px wide. The Launch page always has them.
        </p>
        {UTILITIES.map(({ key, label, description }) => (
          <Toggle
            key={key}
            label={label}
            description={description}
            checked={sections[key]?.visible !== false}
            onChange={(v) => update(`sections.${key}.visible`, v)}
          />
        ))}
      </Card>

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
          // Held by a name that is kept while the list isn't whole (migrateGroups).
          const pinned = new Set(choices && !choices.complete ? heldByName(group, services) : []);
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

                  {pinned.size > 0 && (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Some nodes&apos; services couldn&apos;t all be read just now, so this group
                      keeps the container names it was saved with. A service a name holds can be
                      taken out once they can.
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
                              disabled={pinned.has(uid)}
                              style={pinned.has(uid) ? { ...HELD, cursor: 'default' } : HELD}
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
