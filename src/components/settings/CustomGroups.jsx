import React, { useEffect, useMemo, useState } from 'react';
import Field from './Field';
import { EmptyState } from './primitives.jsx';
import { useConfig } from '../../context/ConfigContext.jsx';
import { Confirm } from '@ui/confirm';
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
 * Settings → Nodes & Services' custom groups (Sections' before #317, whose
 * utilities' switches went to Appearance): the Overview's Services section
 * can group by them (#300). A group holds services by uid (#517,
 * src/shell/customGroups.js), so the same container on two nodes is two
 * services, and every service the status model has can be grouped, a Kuma
 * monitor with no container too. A group has a title and its services,
 * nothing else: no icon or colour (#295) and no hidden flag (the Overview's
 * show/hide is Settings → Appearance's). A group saved before #517 (bare
 * container names) shows each name as the services of that name, and is
 * written back as uids at its next change here; while some node's services
 * couldn't be read, a name is kept, and a service it holds can't be taken
 * out until they can. The section heads it (Group, "Custom groups"), and
 * gives it what it read (serverConfig.js): `services`, /api/services, and
 * `serverConfig`, services.yaml (each null until read), so the page reads
 * them once; the status model it reads itself.
 */

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

export default function CustomGroups({ services: liveServices = null, serverConfig = null }) {
  const { config, update } = useConfig();

  // Custom groups state (a hand-edited entry that is no group is left out)
  const customGroups = Array.isArray(config.customGroups)
    ? config.customGroups.filter((g) => g && typeof g === 'object')
    : [];
  const [editingGroup, setEditingGroup] = useState(null); // group id or null
  // The status model, read here: undefined while /api/status is on its way.
  const [status, setStatus] = useState(undefined);

  useEffect(() => {
    let live = true;
    apiFetch('/api/status')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((read) => {
        if (live) setStatus(read);
      });
    return () => {
      live = false;
    };
  }, []);

  // The services a group can hold: undefined while the status is on its way,
  // then groupChoices' (null when neither it nor /api/services answered).
  // services.yaml says which nodes there are, hidden ones too: whether the
  // list is every service (groupChoices' `complete`); until the section has
  // read it, the list isn't whole, so no save drops a name.
  const choices = useMemo(
    () =>
      status === undefined
        ? undefined
        : groupChoices({ status, services: liveServices, serverConfig }),
    [status, liveServices, serverConfig]
  );
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

  // Asked by the Confirm on the group's ✕ (#640), by the group's title.
  const deleteGroup = (groupId) => {
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
      <div className="settings-row-spread">
        <span />
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
              <Confirm
                trigger={
                  <button
                    className="settings-btn-danger settings-btn-compact"
                    aria-label={`Delete ${title}`}
                  >
                    ✕
                  </button>
                }
                title="Delete this group?"
                name={group.title || 'Custom group'}
                detail={
                  choices
                    ? `${held.length} ${held.length === 1 ? 'service' : 'services'}`
                    : undefined
                }
                value={group.id}
                description="Its services go back to the list. This cannot be undone."
                confirmLabel="Delete group"
                destructive
                onConfirm={deleteGroup}
              />
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
                    keeps the container names it was saved with. A service a name holds can be taken
                    out once they can.
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
  );
}
