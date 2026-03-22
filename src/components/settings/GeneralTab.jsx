import React, { useRef } from 'react';
import { uploadFile } from '../../hooks/useData';

export default function GeneralTab({ config, update }) {
  const logoRef = useRef();

  const handleUpload = async (file) => {
    try {
      const r = await uploadFile(file, 'logo');
      update('logoUrl', r.url);
    } catch (e) {
      alert('Upload failed: ' + e.message);
    }
  };

  return (
    <div className="settings-section">
      <Card title="Branding">
        <Field label="Dashboard Title">
          <input
            className="settings-input"
            value={config.title || ''}
            onChange={e => update('title', e.target.value)}
            placeholder="JAG-NET"
          />
        </Field>
        <Field label="Subtitle">
          <input
            className="settings-input"
            value={config.subtitle || ''}
            onChange={e => update('subtitle', e.target.value)}
            placeholder="Infrastructure Dashboard"
          />
        </Field>
      </Card>

      <Card title="Logo">
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{
            width: 64, height: 64, borderRadius: 12,
            background: 'var(--bg-card-inner)', border: '1px solid var(--border-color)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden', flexShrink: 0,
          }}>
            <img
              src={config.logoUrl || '/logo.svg'}
              alt="Logo"
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
              {config.logoUrl ? 'Custom logo uploaded' : 'Using default JagHelm logo'}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="settings-btn-sm" onClick={() => logoRef.current?.click()}>
                Upload New
              </button>
              {config.logoUrl && (
                <button
                  className="settings-btn-sm"
                  onClick={() => update('logoUrl', '')}
                  style={{ color: 'var(--text-muted)' }}
                >
                  Restore Default
                </button>
              )}
            </div>
            <input
              ref={logoRef}
              type="file"
              accept="image/*"
              hidden
              onChange={e => e.target.files[0] && handleUpload(e.target.files[0])}
            />
          </div>
        </div>
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

function Field({ label, children, hint }) {
  return (
    <div className="settings-field">
      <label className="settings-label">{label}</label>
      {children}
      {hint && <span className="settings-hint">{hint}</span>}
    </div>
  );
}
