import React, { useState } from 'react';

export default function TabsTab({ config, update }) {
  const tabs = config.tabs || [];
  const [editingIndex, setEditingIndex] = useState(null);

  const addTab = () => {
    const newTabs = [...tabs, {
      id: `tab-${Date.now()}`,
      label: 'New Tab',
      type: 'iframe',
      url: 'https://',
    }];
    update('tabs', newTabs);
    setEditingIndex(newTabs.length - 1);
  };

  const removeTab = (index) => {
    const t = [...tabs];
    t.splice(index, 1);
    update('tabs', t);
    setEditingIndex(null);
  };

  const updateTab = (index, field, value) => {
    const t = JSON.parse(JSON.stringify(tabs));
    t[index][field] = value;
    update('tabs', t);
  };

  const moveTab = (index, direction) => {
    const t = [...tabs];
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= t.length) return;
    [t[index], t[newIndex]] = [t[newIndex], t[index]];
    update('tabs', t);
    setEditingIndex(newIndex);
  };

  return (
    <div className="settings-section">
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
        Add tabs that embed services in an iframe. These appear in the navigation bar next to the Dashboard tab.
      </p>

      {tabs.map((tab, i) => (
        <Card key={tab.id}>
          {editingIndex === i ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Field label="Tab Name">
                <input
                  className="settings-input"
                  value={tab.label}
                  onChange={e => updateTab(i, 'label', e.target.value)}
                  autoFocus
                />
              </Field>
              <Field label="URL">
                <input
                  className="settings-input"
                  value={tab.url}
                  onChange={e => updateTab(i, 'url', e.target.value)}
                  placeholder="https://..."
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
                />
              </Field>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="settings-btn-sm" onClick={() => moveTab(i, -1)} disabled={i === 0} style={{ opacity: i === 0 ? 0.3 : 1 }}>↑</button>
                  <button className="settings-btn-sm" onClick={() => moveTab(i, 1)} disabled={i === tabs.length - 1} style={{ opacity: i === tabs.length - 1 ? 0.3 : 1 }}>↓</button>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="settings-btn-sm" onClick={() => removeTab(i)} style={{ color: 'var(--red)', borderColor: 'var(--red-border)' }}>Delete</button>
                  <button className="settings-btn-sm" onClick={() => setEditingIndex(null)}>Done</button>
                </div>
              </div>
            </div>
          ) : (
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
              onClick={() => setEditingIndex(i)}
            >
              <span style={{ fontSize: 16 }}>📑</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14 }}>{tab.label}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                  {tab.url.replace('https://', '').replace('http://', '')}
                </div>
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Click to edit</span>
            </div>
          )}
        </Card>
      ))}

      <button className="settings-btn-sm" onClick={addTab} style={{ marginTop: 4 }}>
        + Add Tab
      </button>
    </div>
  );
}

function Card({ children }) {
  return <div className="settings-card">{children}</div>;
}

function Field({ label, children }) {
  return (
    <div className="settings-field">
      <label className="settings-label">{label}</label>
      {children}
    </div>
  );
}
