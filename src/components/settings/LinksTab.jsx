import React, { useState } from 'react';
import IconPicker from '../IconPicker';

const DEFAULT_GROUPS = ['personal', 'management', 'devops'];

export default function LinksTab({ config, update, setConfig }) {
  const [editingLink, setEditingLink] = useState(null); // { group, index } or null
  const [addingTo, setAddingTo] = useState(null); // group key or null
  const [newLink, setNewLink] = useState({ name: '', icon: '', url: '' });
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  const links = config.links || {};

  const updateLink = (group, index, field, value) => {
    const groupLinks = JSON.parse(JSON.stringify(links[group] || []));
    groupLinks[index][field] = value;
    update(`links.${group}`, groupLinks);
  };

  const removeLink = (group, index) => {
    const groupLinks = [...(links[group] || [])];
    groupLinks.splice(index, 1);
    update(`links.${group}`, groupLinks);
    setEditingLink(null);
  };

  const addLink = (group) => {
    if (!newLink.name.trim() || !newLink.url.trim()) return;
    const groupLinks = [...(links[group] || [])];
    groupLinks.push({
      name: newLink.name.trim(),
      icon: newLink.icon.trim() || '🔗',
      url: newLink.url.trim().startsWith('http') ? newLink.url.trim() : `https://${newLink.url.trim()}`,
    });
    update(`links.${group}`, groupLinks);
    setNewLink({ name: '', icon: '', url: '' });
    setAddingTo(null);
  };

  const moveLink = (group, index, direction) => {
    const groupLinks = [...(links[group] || [])];
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= groupLinks.length) return;
    [groupLinks[index], groupLinks[newIndex]] = [groupLinks[newIndex], groupLinks[index]];
    update(`links.${group}`, groupLinks);
  };

  const addGroup = () => {
    if (!newGroupName.trim()) return;
    const key = newGroupName.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
    if (links[key]) return; // already exists
    setConfig(prev => ({
      ...prev,
      links: { ...prev.links, [key]: [] },
    }));
    setNewGroupName('');
    setAddingGroup(false);
  };

  const removeGroup = (group) => {
    if (!confirm(`Remove the "${group}" link group and all its links?`)) return;
    const newLinks = { ...links };
    delete newLinks[group];
    setConfig(prev => ({ ...prev, links: newLinks }));
  };

  return (
    <div className="settings-section">
      {Object.entries(links).map(([group, groupLinks]) => (
        <Card key={group} title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, textTransform: 'capitalize' }}>{group.replace(/_/g, ' ')}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
              {groupLinks.length} link{groupLinks.length !== 1 ? 's' : ''}
            </span>
          </div>
        }>
          {/* Link list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {groupLinks.map((link, i) => {
              const isEditing = editingLink?.group === group && editingLink?.index === i;

              return (
                <div key={i} style={{
                  padding: '10px 14px', borderRadius: 10,
                  background: isEditing ? 'var(--accent-glow)' : 'var(--bg-card-inner)',
                  border: `1px solid ${isEditing ? 'var(--accent)' : 'var(--border-color)'}`,
                  transition: 'all 0.15s',
                }}>
                  {isEditing ? (
                    /* Edit mode */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <IconPicker
                          compact
                          value={link.icon}
                          onChange={url => updateLink(group, i, 'icon', url)}
                        />
                        <input
                          className="settings-input"
                          value={link.name}
                          onChange={e => updateLink(group, i, 'name', e.target.value)}
                          placeholder="Name"
                          style={{ flex: 1 }}
                        />
                      </div>
                      <input
                        className="settings-input"
                        value={link.url}
                        onChange={e => updateLink(group, i, 'url', e.target.value)}
                        placeholder="https://..."
                        style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
                      />
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="settings-btn-sm" onClick={() => moveLink(group, i, -1)} disabled={i === 0} style={{ opacity: i === 0 ? 0.3 : 1 }}>↑</button>
                          <button className="settings-btn-sm" onClick={() => moveLink(group, i, 1)} disabled={i === groupLinks.length - 1} style={{ opacity: i === groupLinks.length - 1 ? 0.3 : 1 }}>↓</button>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="settings-btn-sm" onClick={() => removeLink(group, i)} style={{ color: 'var(--red)', borderColor: 'var(--red-border)' }}>Delete</button>
                          <button className="settings-btn-sm" onClick={() => setEditingLink(null)}>Done</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Display mode */
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                      onClick={() => setEditingLink({ group, index: i })}
                    >
                      <span style={{ fontSize: 18, width: 24, textAlign: 'center', flexShrink: 0 }}>
                        {link.icon && (link.icon.startsWith('http') || link.icon.startsWith('/'))
                          ? <img src={link.icon} alt="" style={{ width: 20, height: 20, borderRadius: 3 }} />
                          : (link.icon || '🔗')
                        }
                      </span>
                      <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{link.name}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                        {link.url.replace('https://', '').replace('http://', '')}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add link form */}
          {addingTo === group ? (
            <div style={{
              marginTop: 8, padding: '12px 14px', borderRadius: 10,
              background: 'var(--bg-card-inner)', border: '1px dashed var(--accent)',
            }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <IconPicker
                  compact
                  value={newLink.icon}
                  onChange={url => setNewLink(p => ({ ...p, icon: url }))}
                />
                <input
                  className="settings-input"
                  value={newLink.name}
                  onChange={e => setNewLink(p => ({ ...p, name: e.target.value }))}
                  placeholder="Name"
                  style={{ flex: 1 }}
                  autoFocus
                />
              </div>
              <input
                className="settings-input"
                value={newLink.url}
                onChange={e => setNewLink(p => ({ ...p, url: e.target.value }))}
                placeholder="https://..."
                style={{ fontFamily: 'var(--font-mono)', fontSize: 13, marginBottom: 8 }}
                onKeyDown={e => e.key === 'Enter' && addLink(group)}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="settings-btn-sm" onClick={() => addLink(group)} style={{ background: 'var(--accent)', color: '#fff', border: 'none' }}>Add</button>
                <button className="settings-btn-sm" onClick={() => { setAddingTo(null); setNewLink({ name: '', icon: '', url: '' }); }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                className="settings-btn-sm"
                onClick={() => { setAddingTo(group); setNewLink({ name: '', icon: '', url: '' }); }}
              >
                + Add Link
              </button>
              {!DEFAULT_GROUPS.includes(group) && (
                <button
                  className="settings-btn-sm"
                  onClick={() => removeGroup(group)}
                  style={{ color: 'var(--red)', borderColor: 'var(--red-border)' }}
                >
                  Remove Group
                </button>
              )}
            </div>
          )}
        </Card>
      ))}

      {/* Add group */}
      <Card>
        {addingGroup ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="settings-input"
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              placeholder="Group name (e.g. media, tools)"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && addGroup()}
              style={{ flex: 1 }}
            />
            <button className="settings-btn-sm" onClick={addGroup} style={{ background: 'var(--accent)', color: '#fff', border: 'none' }}>Create</button>
            <button className="settings-btn-sm" onClick={() => { setAddingGroup(false); setNewGroupName(''); }}>Cancel</button>
          </div>
        ) : (
          <button className="settings-btn-sm" onClick={() => setAddingGroup(true)}>
            + Add Link Group
          </button>
        )}
      </Card>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="settings-card">
      {title && <h3 className="settings-card-title">{typeof title === 'string' ? title : title}</h3>}
      {children}
    </div>
  );
}
