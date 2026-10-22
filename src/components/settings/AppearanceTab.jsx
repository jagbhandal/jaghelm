import React, { useId, useState, useRef } from 'react';
import { uploadFile } from '../../hooks/useData';
import { useConfig } from '../../context/ConfigContext.jsx';
import Field from './Field';
import InlineError from './InlineError';
import { Card, Toggle } from './primitives.jsx';
import { THEMES } from '../../shell/theme.js';

// Each theme's swatch, as the mock's Settings → Appearance draws it: the
// background of dark, of light, and the two halved for system.
const DARK_BG = 'oklch(0.155 0.006 286)';
const LIGHT_BG = 'oklch(0.982 0.003 286)';
const PREVIEW = {
  dark: DARK_BG,
  light: LIGHT_BG,
  system: `linear-gradient(90deg, ${DARK_BG} 50%, ${LIGHT_BG} 50%)`,
};

/**
 * Settings → Appearance. The theme is dark, light or system (#304); there is
 * one accent, violet, so no accent picker until #321 offers Violet, Fuchsia
 * and Cyan.
 */
export default function AppearanceTab({ theme, setTheme }) {
  const { config, update } = useConfig();
  const [uploadError, setUploadError] = useState('');
  const bgRef = useRef();
  const id = useId();

  const handleBgUpload = async (file) => {
    setUploadError('');
    try {
      const r = await uploadFile(file, 'bg');
      update('bgImage', r.url);
    } catch (e) {
      setUploadError('Background upload failed: ' + e.message);
    }
  };

  return (
    <div className="settings-section">
      <InlineError message={uploadError} onDismiss={() => setUploadError('')} />
      <Card title="Theme">
        <p className="settings-desc">Dark, light, or the device's own setting.</p>
        <div className="settings-grid-3" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={theme === t.id}
              aria-labelledby={`${id}-${t.id}`}
              aria-describedby={`${id}-${t.id}-desc`}
              onClick={() => setTheme(t.id)}
              className={`settings-theme-btn ${theme === t.id ? 'active' : ''}`}
              style={{
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                textAlign: 'left',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: 'block',
                  height: 52,
                  borderRadius: 8,
                  border: '1px solid var(--border-color)',
                  background: PREVIEW[t.id],
                }}
              />
              <span id={`${id}-${t.id}`} style={{ fontWeight: 600 }}>
                {t.label}
              </span>
              <span
                id={`${id}-${t.id}-desc`}
                style={{ fontSize: 12, color: 'var(--text-secondary)' }}
              >
                {t.description}
              </span>
            </button>
          ))}
        </div>
      </Card>

      <Card title="Background">
        <div className="settings-stack">
          <div className="settings-row" style={{ gap: 12 }}>
            {config.bgImage && (
              <div className="settings-bg-preview">
                <img
                  src={config.bgImage}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </div>
            )}
            <div className="settings-row">
              <button className="settings-btn-sm" onClick={() => bgRef.current?.click()}>
                {config.bgImage ? 'Change Image' : 'Upload Image'}
              </button>
              {config.bgImage && (
                <button
                  className="settings-btn-sm muted-text"
                  onClick={() => update('bgImage', '')}
                  style={{ color: 'var(--red)' }}
                >
                  Remove
                </button>
              )}
            </div>
            <input
              ref={bgRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => e.target.files[0] && handleBgUpload(e.target.files[0])}
            />
          </div>

          <Field label={`Image Opacity: ${((config.bgOpacity ?? 0.3) * 100).toFixed(0)}%`}>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={config.bgOpacity ?? 0.3}
              onChange={(e) => update('bgOpacity', parseFloat(e.target.value))}
              className="settings-range"
            />
          </Field>

          <Field label={`Overlay Opacity: ${((config.overlayOpacity ?? 0.75) * 100).toFixed(0)}%`}>
            <input
              type="range"
              min="0"
              max="1"
              step="0.02"
              value={config.overlayOpacity ?? 0.75}
              onChange={(e) => update('overlayOpacity', parseFloat(e.target.value))}
              className="settings-range"
            />
          </Field>
        </div>
      </Card>

      <Card title="Effects">
        <Toggle
          label="Show dot grid background"
          checked={config.showDots !== false}
          onChange={(v) => update('showDots', v)}
        />
      </Card>
    </div>
  );
}
