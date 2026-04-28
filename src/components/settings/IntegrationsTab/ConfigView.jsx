import React from 'react';
import { cachedIconUrl } from '../../../hooks/useData';
import { AUTH_LABELS, AUTH_FIELDS } from './constants.js';
import FieldGroup from './FieldGroup.jsx';

/**
 * ConfigView — the config form. Used for both create (preset or custom) and
 * edit flows. The form state itself is owned by useConfigForm() at the
 * orchestrator level and passed in via the `form` prop.
 *
 * Props:
 *   selectedPreset  — preset object the form is configured against (null = custom)
 *   editingType     — storage key when editing existing (null = new); drives "Edit" header + Delete button
 *   form            — useConfigForm() return value
 *   allContainers   — flat array of containers for the target dropdown
 *   testStatus      — null | 'testing' | { ok, status?, error?, instructions? }
 *   saveStatus      — null | 'saving' | 'saved' | { error }
 *   handleTest      — () => Promise<void>
 *   handleSave      — () => Promise<void>
 *   handleDelete    — (storageKey) => Promise<void>
 *   onBack          — () => void
 *   onAfterDelete   — () => void (typically goHome)
 */
export default function ConfigView({
  selectedPreset,
  editingType,
  form,
  allContainers,
  testStatus,
  saveStatus,
  handleTest,
  handleSave,
  handleDelete,
  onBack,
  onAfterDelete,
}) {
  const isPreset = !!selectedPreset;
  const authType = selectedPreset?.auth || 'bearer';
  const neededFields = AUTH_FIELDS[authType] || [];
  const presetName = selectedPreset?.name || 'Custom Integration';
  const isEditing = !!editingType;

  return (
    <div>
      {/* Back button */}
      <button
        className="settings-btn-sm"
        onClick={onBack}
        style={{ marginBottom: 16, fontSize: 12 }}
      >
        ← {isEditing ? 'Back to Integrations' : 'Back to Gallery'}
      </button>

      {/* Header */}
      <div className="settings-row" style={{ gap: 14, marginBottom: 24 }}>
        {isPreset && (
          <img
            src={cachedIconUrl(`https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/${selectedPreset.icon}.svg`)}
            alt=""
            style={{ width: 40, height: 40, borderRadius: 10 }}
            onError={e => { e.target.style.display = 'none'; }}
          />
        )}
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>
            {isEditing ? `Edit ${presetName}` : `Configure ${presetName}`}
          </div>
          {isPreset && (
            <div className="settings-item-subtitle" style={{ marginTop: 2 }}>
              {selectedPreset.description} · Auth: {AUTH_LABELS[authType]}
            </div>
          )}
        </div>
      </div>

      {/* Form */}
      <div className="settings-stack">
        {/* URL */}
        <FieldGroup label="Base URL" hint="Protocol is auto-added if missing (e.g. adguard.local:3000 → http://adguard.local:3000)">
          <input
            className="settings-input mono"
            value={form.url}
            onChange={e => form.setUrl(e.target.value)}
            placeholder={isPreset ? `e.g. http://your-server:port` : 'https://service.example.com'}
          />
        </FieldGroup>

        {/* Instance Name — for multiple instances of the same app */}
        {isPreset && (
          <FieldGroup label="Instance Name" hint="Optional. Use when running multiple instances (e.g. primary, secondary). Leave blank for single instances.">
            <input
              className="settings-input mono"
              value={form.instance}
              onChange={e => form.setInstance(e.target.value)}
              placeholder="e.g. primary"
            />
          </FieldGroup>
        )}

        {/* Target Container — scope stats to a specific container */}
        <FieldGroup label="Target Container" hint="Optional. When set, stats only show on this specific container. When blank, stats match any container with a similar name.">
          <select
            className="settings-input mono"
            value={form.target}
            onChange={e => form.setTarget(e.target.value)}
            style={{ cursor: 'pointer' }}
          >
            <option value="">Auto-match (by name)</option>
            {allContainers.map(c => (
              <option key={c.uid} value={c.uid}>{c.name} — {c.node}</option>
            ))}
          </select>
        </FieldGroup>

        {/* Username (if needed) */}
        {neededFields.includes('username') && (
          <FieldGroup label={authType === 'oauth2' ? 'Client ID' : 'Username'}>
            <input
              className="settings-input"
              value={form.username}
              onChange={e => form.setUsername(e.target.value)}
              placeholder={authType === 'oauth2' ? 'OAuth2 Client ID' : 'admin'}
              autoComplete="off"
            />
          </FieldGroup>
        )}

        {/* Password (if needed) */}
        {neededFields.includes('password') && (
          <FieldGroup label={authType === 'oauth2' ? 'Client Secret' : 'Password'} hint={isEditing ? 'Leave blank to keep existing' : undefined}>
            <input
              className="settings-input"
              type="password"
              value={form.password}
              onChange={e => form.setPassword(e.target.value)}
              placeholder={isEditing ? '••••••••' : authType === 'oauth2' ? 'OAuth2 Client Secret' : 'Enter password'}
              autoComplete="new-password"
            />
          </FieldGroup>
        )}

        {/* Token (if needed) */}
        {neededFields.includes('token') && (
          <FieldGroup
            label={authType === 'query' ? 'API Key' : authType === 'header' ? `API Key (${selectedPreset?.authHeader || 'X-API-Key'})` : 'API Token'}
            hint={isEditing ? 'Leave blank to keep existing' : undefined}
          >
            <input
              className="settings-input mono"
              type="password"
              value={form.token}
              onChange={e => form.setToken(e.target.value)}
              placeholder={isEditing ? '••••••••' : 'Enter API key or token'}
              autoComplete="new-password"
            />
          </FieldGroup>
        )}

        {/* URL Params (e.g. Cloudflare Account ID) */}
        {selectedPreset?.urlParams?.map(p => (
          <FieldGroup key={p.key} label={p.label}>
            <input
              className="settings-input mono"
              value={form.params[p.key] || ''}
              onChange={e => form.setParams(prev => ({ ...prev, [p.key]: e.target.value }))}
              placeholder={p.placeholder || p.label}
            />
          </FieldGroup>
        ))}

        {/* No auth needed message */}
        {authType === 'none' && (
          <div style={{
            padding: '10px 14px', borderRadius: 10,
            background: 'var(--green-bg)', border: '1px solid var(--green-border)',
            fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--green)',
          }}>
            ✓ This integration requires no authentication — just provide the URL.
          </div>
        )}

        {/* Fields preview */}
        {isPreset && selectedPreset.fields?.length > 0 && (
          <FieldGroup label="Data Fields (from preset)">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {selectedPreset.fields.map(f => (
                <span key={f.key} style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11, padding: '3px 10px',
                  borderRadius: 6, background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)', color: 'var(--text-secondary)',
                }}>
                  {f.label}
                </span>
              ))}
            </div>
          </FieldGroup>
        )}

        {/* Enabled toggle */}
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={e => form.setEnabled(e.target.checked)}
          />
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 14 }}>
            Enabled — fetch data on dashboard refresh
          </span>
        </label>

        {/* Action buttons */}
        <div className="settings-row" style={{ gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
          {/* Test */}
          <button
            className="settings-btn-sm"
            onClick={handleTest}
            disabled={!form.url || testStatus === 'testing'}
            style={{
              padding: '8px 20px',
              opacity: !form.url ? 0.5 : 1,
              cursor: !form.url ? 'not-allowed' : 'pointer',
            }}
          >
            {testStatus === 'testing' ? 'Testing...' : '🔌 Test Connection'}
          </button>

          {/* Save */}
          <button
            className="settings-btn-primary"
            onClick={handleSave}
            disabled={!form.url || saveStatus === 'saving'}
            style={{
              padding: '8px 20px',
              opacity: !form.url ? 0.5 : 1,
              cursor: !form.url ? 'not-allowed' : 'pointer',
            }}
          >
            {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? '✓ Saved!' : '💾 Save Integration'}
          </button>

          {/* Delete (only when editing) */}
          {isEditing && (
            <button
              className="settings-btn-danger"
              onClick={() => { handleDelete(editingType); onAfterDelete(); }}
              style={{ padding: '8px 20px', marginLeft: 'auto' }}
            >
              🗑 Delete
            </button>
          )}
        </div>

        {/* Test result */}
        {testStatus && testStatus !== 'testing' && (
          <div style={{
            padding: '10px 14px', borderRadius: 10,
            background: testStatus.ok ? 'var(--green-bg)' : 'var(--red-bg)',
            border: `1px solid ${testStatus.ok ? 'var(--green-border)' : 'var(--red-border)'}`,
            fontFamily: 'var(--font-mono)', fontSize: 12,
            color: testStatus.ok ? 'var(--green)' : 'var(--red)',
          }}>
            {testStatus.ok
              ? `✓ Connection successful (HTTP ${testStatus.status})`
              : `✕ Connection failed: ${testStatus.error}`
            }
            {testStatus.instructions && (
              <pre style={{
                marginTop: 10, padding: '10px 12px', borderRadius: 8,
                background: 'var(--bg-card-inner)', border: '1px solid var(--border-color)',
                color: 'var(--text-secondary)', fontSize: 11, lineHeight: 1.6,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                fontFamily: 'var(--font-mono)',
              }}>{testStatus.instructions}</pre>
            )}
          </div>
        )}

        {/* Save error */}
        {saveStatus && typeof saveStatus === 'object' && saveStatus.error && (
          <div style={{
            padding: '10px 14px', borderRadius: 10,
            background: 'var(--red-bg)', border: '1px solid var(--red-border)',
            fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--red)',
          }}>
            Save error: {saveStatus.error}
          </div>
        )}
      </div>
    </div>
  );
}
