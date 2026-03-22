import React, { useState } from 'react';
import { HexColorPicker } from 'react-colorful';

/**
 * SectionsTab — Phase 2 Settings
 * 
 * Manages display settings for static dashboard sections
 * (UPS, Pipeline, Quick Launch, Todos) that aren't driven by nodes.
 * Node sections are managed in the Nodes tab.
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

  return (
    <div className="settings-section">
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
        Customize the appearance of dashboard sections. Node sections (Gateway, Production, Staging) are managed in the Nodes tab.
      </p>

      {colorTarget && (
        <div className="settings-card" style={{ borderColor: 'var(--accent)' }}>
          <HexColorPicker color={colorValue} onChange={setColorValue} style={{ width: '100%', maxWidth: 300, height: 150 }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input
              className="settings-input"
              value={colorValue}
              onChange={e => setColorValue(e.target.value)}
              style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
            />
            <button className="settings-btn-sm" onClick={applyColor} style={{ background: colorValue, color: '#fff', border: 'none' }}>Apply</button>
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
                style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
              />
              <span style={{ fontSize: 22 }}>{s.icon || defaultIcon}</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, flex: 1 }}>
                {s.title || defaultTitle}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
              <Field label="Icon (emoji)">
                <input
                  className="settings-input"
                  value={s.icon || ''}
                  onChange={e => update(`sections.${key}.icon`, e.target.value)}
                  placeholder={defaultIcon}
                  style={{ width: 80 }}
                />
              </Field>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
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
