import React, { useRef, useState } from 'react';
import { uploadFile } from '../../hooks/useData';
import { useConfig } from '../../context/ConfigContext.jsx';
import Field from './Field';
import InlineError from './InlineError';
import { Card } from './primitives.jsx';

/**
 * Settings → Appearance's branding (General's before #317): the instance's
 * title and subtitle, and its logo. The welcome message went: nothing has
 * drawn it since the old board's header (#296), and the spec drops it (§15).
 */
export default function GeneralTab() {
  const { config, update } = useConfig();
  const logoRef = useRef();
  const [uploadError, setUploadError] = useState('');

  const handleUpload = async (file) => {
    setUploadError('');
    try {
      const r = await uploadFile(file, 'logo');
      update('logoUrl', r.url);
    } catch (e) {
      setUploadError('Logo upload failed: ' + e.message);
    }
  };

  return (
    <div className="settings-section">
      <InlineError message={uploadError} onDismiss={() => setUploadError('')} />
      <Card title="Branding" id="branding">
        <Field label="Dashboard Title">
          <input
            className="settings-input"
            value={config.title || ''}
            onChange={(e) => update('title', e.target.value)}
            placeholder="JAGHELM"
          />
        </Field>
        <Field label="Subtitle">
          <input
            className="settings-input"
            value={config.subtitle || ''}
            onChange={(e) => update('subtitle', e.target.value)}
            placeholder="Infrastructure Dashboard"
          />
        </Field>
      </Card>

      <Card title="Logo" id="logo">
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
                  className="settings-btn-sm muted-text"
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
              onChange={(e) => e.target.files[0] && handleUpload(e.target.files[0])}
            />
          </div>
        </div>
      </Card>
    </div>
  );
}
