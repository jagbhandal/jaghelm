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
        <div className="settings-row" style={{ gap: 16 }}>
          <div className="settings-logo-preview">
            <img
              src={config.logoUrl || '/logo.svg'}
              alt="Logo"
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            />
          </div>
          <div className="settings-stack-sm">
            <p className="settings-desc" style={{ margin: 0 }}>
              {config.logoUrl ? 'Custom logo uploaded' : 'Using default JagHelm logo'}
            </p>
            <div className="settings-row">
              <button className="settings-btn-sm" onClick={() => logoRef.current?.click()}>
                Upload New
              </button>
              {config.logoUrl && (
                <button
                  className="settings-btn-sm text-muted"
                  onClick={() => update('logoUrl', '')}
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

      <Card title="Welcome Message">
        <Field label="Show Welcome Message" hint="Displays a greeting banner below the navigation bar">
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={config.welcomeMessage?.enabled || false}
              onChange={e => update('welcomeMessage.enabled', e.target.checked)}
            />
            <span>Enabled</span>
          </label>
        </Field>
        <Field label="Message Text">
          <input
            className="settings-input"
            value={config.welcomeMessage?.text || ''}
            onChange={e => update('welcomeMessage.text', e.target.value)}
            placeholder="Welcome to JagHelm"
          />
        </Field>
        <Field label="Description" hint="Optional secondary line below the message">
          <input
            className="settings-input"
            value={config.welcomeMessage?.description || ''}
            onChange={e => update('welcomeMessage.description', e.target.value)}
            placeholder="Your infrastructure at a glance"
          />
        </Field>
        <Field label={`Font Size: ${config.welcomeMessage?.fontSize || 20}px`}>
          <input
            className="settings-range"
            type="range"
            min="14"
            max="40"
            value={config.welcomeMessage?.fontSize || 20}
            onChange={e => update('welcomeMessage.fontSize', Number(e.target.value))}
          />
        </Field>
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
