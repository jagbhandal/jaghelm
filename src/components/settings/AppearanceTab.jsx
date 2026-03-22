import React, { useState, useRef } from 'react';
import { HexColorPicker } from 'react-colorful';
import { uploadFile } from '../../hooks/useData';

const THEMES = [
  { id: 'dark', name: 'Deep Navy', preview: '#0f1123' },
  { id: 'dracula', name: 'Dracula', preview: '#282a36' },
  { id: 'light', name: 'Light', preview: '#eef0f8' },
];

export default function AppearanceTab({ config, update, theme, setTheme }) {
  const [colorPicking, setColorPicking] = useState(false);
  const [colorValue, setColorValue] = useState(config.accentColor || '#6366f1');
  const bgRef = useRef();

  const handleBgUpload = async (file) => {
    try {
      const r = await uploadFile(file, 'bg');
      update('bgImage', r.url);
    } catch (e) {
      alert('Upload failed: ' + e.message);
    }
  };

  return (
    <div className="settings-section">
      <Card title="Theme">
        <div style={{ display: 'flex', gap: 12 }}>
          {THEMES.map(t => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={`settings-theme-btn ${theme === t.id ? 'active' : ''}`}
            >
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: t.preview,
                border: '1px solid rgba(255,255,255,0.1)',
                marginBottom: 8,
              }} />
              <span>{t.name}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card title="Accent Color">
        {colorPicking ? (
          <div>
            <HexColorPicker color={colorValue} onChange={setColorValue} style={{ width: '100%', maxWidth: 300, height: 160 }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <input
                className="settings-input"
                value={colorValue}
                onChange={e => setColorValue(e.target.value)}
                style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
              />
              <button
                className="settings-btn-sm"
                onClick={() => { update('accentColor', colorValue); setColorPicking(false); }}
                style={{ background: colorValue, color: '#fff', border: 'none' }}
              >
                Apply
              </button>
              <button className="settings-btn-sm" onClick={() => setColorPicking(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 44, height: 44, borderRadius: 12,
                background: config.accentColor || '#6366f1',
                cursor: 'pointer', border: '2px solid var(--border-glow)',
                transition: 'transform 0.15s',
              }}
              onClick={() => { setColorValue(config.accentColor || '#6366f1'); setColorPicking(true); }}
            />
            <div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--text-primary)' }}>
                {config.accentColor || '#6366f1'}
              </span>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                Click swatch to change
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card title="Background">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {config.bgImage && (
              <div style={{
                width: 80, height: 50, borderRadius: 8, overflow: 'hidden',
                border: '1px solid var(--border-color)', flexShrink: 0,
              }}>
                <img src={config.bgImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="settings-btn-sm" onClick={() => bgRef.current?.click()}>
                {config.bgImage ? 'Change Image' : 'Upload Image'}
              </button>
              {config.bgImage && (
                <button className="settings-btn-sm" onClick={() => update('bgImage', '')} style={{ color: 'var(--red)' }}>
                  Remove
                </button>
              )}
            </div>
            <input ref={bgRef} type="file" accept="image/*" hidden onChange={e => e.target.files[0] && handleBgUpload(e.target.files[0])} />
          </div>

          <Field label={`Image Opacity: ${((config.bgOpacity ?? 0.3) * 100).toFixed(0)}%`}>
            <input
              type="range" min="0" max="1" step="0.05"
              value={config.bgOpacity ?? 0.3}
              onChange={e => update('bgOpacity', parseFloat(e.target.value))}
              className="settings-range"
            />
          </Field>

          <Field label={`Overlay Opacity: ${((config.overlayOpacity ?? 0.75) * 100).toFixed(0)}%`}>
            <input
              type="range" min="0" max="1" step="0.02"
              value={config.overlayOpacity ?? 0.75}
              onChange={e => update('overlayOpacity', parseFloat(e.target.value))}
              className="settings-range"
            />
          </Field>
        </div>
      </Card>

      <Card title="Effects">
        <Chk
          label="Show dot grid background"
          checked={config.showDots !== false}
          onChange={v => update('showDots', v)}
        />
      </Card>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="settings-card">
      {title && <h3 className="settings-card-title">{title}</h3>}
      {children}
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

function Chk({ label, checked, onChange }) {
  return (
    <label className="settings-toggle">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
