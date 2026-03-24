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
      <p className="settings-desc" style={{ marginBottom: 16 }}>
        Add tabs that embed services in an iframe. These appear in the navigation bar next to the Dashboard tab.
      </p>

      {tabs.map((tab, i) => (
        <Card key={tab.id}>
          {editingIndex === i ? (
            <div className="settings-stack" style={{ gap: 10 }}>
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
                  className="settings-input mono"
                  value={tab.url}
                  onChange={e => updateTab(i, 'url', e.target.value)}
                  placeholder="https://..."
                  style={{ fontSize: 13 }}
                />
              </Field>
              <div className="settings-row-spread">
                <div className="settings-row" style={{ gap: 4 }}>
                  <button className="settings-btn-sm" onClick={() => moveTab(i, -1)} disabled={i === 0} style={{ opacity: i === 0 ? 0.3 : 1 }}>↑</button>
                  <button className="settings-btn-sm" onClick={() => moveTab(i, 1)} disabled={i === tabs.length - 1} style={{ opacity: i === tabs.length - 1 ? 0.3 : 1 }}>↓</button>
                </div>
                <div className="settings-row">
                  <button className="settings-btn-danger settings-btn-compact" onClick={() => removeTab(i)}>Delete</button>
                  <button className="settings-btn-sm" onClick={() => setEditingIndex(null)}>Done</button>
                </div>
              </div>
            </div>
          ) : (
            <div
              className="settings-item-row"
              style={{ cursor: 'pointer', padding: 0, border: 'none', background: 'none' }}
              onClick={() => setEditingIndex(i)}
            >
              <span style={{ fontSize: 16 }}>📑</span>
              <div className="flex-1">
                <div className="settings-item-title">{tab.label}</div>
                <div className="settings-item-subtitle">
                  {tab.url.replace('https://', '').replace('http://', '')}
                </div>
              </div>
              <span className="text-muted" style={{ fontSize: 12 }}>Click to edit</span>
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
