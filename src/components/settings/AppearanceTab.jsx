import React, { useState, useRef } from 'react';
import { HexColorPicker } from 'react-colorful';
import { uploadFile } from '../../hooks/useData';

const THEMES = [
  { id: 'dark', name: 'One Dark Pro', preview: '#0f1123', accent: '#6366f1', desc: 'Atom\'s iconic theme' },
  { id: 'dracula', name: 'Dracula', preview: '#282a36', accent: '#bd93f9', desc: 'Dark with vibrant accents' },
  { id: 'night-owl', name: 'Night Owl', preview: '#011627', accent: '#82aaff', desc: 'Deep blue, low-light' },
  { id: 'github-dark', name: 'GitHub Dark', preview: '#0d1117', accent: '#58a6ff', desc: 'Clean & minimal' },
  { id: 'catppuccin', name: 'Catppuccin Mocha', preview: '#1e1e2e', accent: '#89b4fa', desc: 'Soothing pastels' },
  { id: 'material', name: 'Material Ocean', preview: '#0f111a', accent: '#84ffff', desc: 'Google Material dark' },
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
        <p className="settings-desc">
          Inspired by the most popular VS Code themes.
        </p>
        <div className="settings-grid-3">
          {THEMES.map(t => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={`settings-theme-btn ${theme === t.id ? 'active' : ''}`}
              style={{ padding: '14px 10px' }}
            >
              <div style={{
                width: 44, height: 44, borderRadius: 10,
                background: t.preview,
                border: `2px solid ${theme === t.id ? t.accent : 'rgba(255,255,255,0.08)'}`,
                marginBottom: 8, position: 'relative', overflow: 'hidden',
              }}>
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0, height: 3,
                  background: t.accent,
                }} />
              </div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{t.name}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{t.desc}</div>
            </button>
          ))}
        </div>
      </Card>

      <Card title="Accent Color">
        {colorPicking ? (
          <div>
            <HexColorPicker color={colorValue} onChange={setColorValue} style={{ width: '100%', maxWidth: 300, height: 160 }} />
            <div className="settings-actions">
              <input
                className="settings-input mono flex-1"
                value={colorValue}
                onChange={e => setColorValue(e.target.value)}
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
          <div className="settings-row" style={{ gap: 12 }}>
            <div
              className="settings-color-swatch-lg"
              style={{ background: config.accentColor || '#6366f1' }}
              onClick={() => { setColorValue(config.accentColor || '#6366f1'); setColorPicking(true); }}
            />
            <div>
              <span className="text-mono" style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                {config.accentColor || '#6366f1'}
              </span>
              <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                Click swatch to change
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card title="Background">
        <div className="settings-stack">
          <div className="settings-row" style={{ gap: 12 }}>
            {config.bgImage && (
              <div className="settings-bg-preview">
                <img src={config.bgImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            )}
            <div className="settings-row">
              <button className="settings-btn-sm" onClick={() => bgRef.current?.click()}>
                {config.bgImage ? 'Change Image' : 'Upload Image'}
              </button>
              {config.bgImage && (
                <button className="settings-btn-sm text-muted" onClick={() => update('bgImage', '')} style={{ color: 'var(--red)' }}>
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
