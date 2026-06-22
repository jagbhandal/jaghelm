import React from 'react';
import { cachedIconUrl } from '../../../hooks/useData';
import { presetIconUrl } from '../primitives.jsx';

/**
 * HomeView — list of configured integrations + entry points for adding new ones.
 *
 * Props:
 *   presets            — array of available preset objects (used to look up icons/names)
 *   configured         — { storageKey: configObject } map of currently-saved integrations
 *   onAddFromPresets   — () => void, opens the gallery view
 *   onCustomBuilder    — () => void, opens the config view in custom mode
 *   onEdit             — (preset, existingConfig, storageKey) => void
 *   onDelete           — (storageKey) => void
 *   onToggle           — (storageKey, currentConfig) => void
 */
export default function HomeView({
  presets,
  configured,
  onAddFromPresets,
  onCustomBuilder,
  onEdit,
  onDelete,
  onToggle,
}) {
  const configEntries = Object.entries(configured);

  return (
    <div>
      <p className="settings-desc" style={{ marginBottom: 20 }}>
        Connect app APIs to show live stats on service cards. Credentials are encrypted with AES-256-GCM.
      </p>

      {/* Add buttons */}
      <div className="settings-row" style={{ marginBottom: 24 }}>
        <button className="settings-btn-primary" onClick={onAddFromPresets}>
          + Add from Presets
        </button>
        <button className="settings-btn-sm" onClick={onCustomBuilder}>
          + Custom Integration
        </button>
      </div>

      {/* Configured integrations */}
      {configEntries.length === 0 ? (
        <div style={{
          padding: 40, textAlign: 'center', color: 'var(--text-muted)',
          background: 'var(--bg-card-inner)', borderRadius: 16,
          border: '1px dashed var(--border-color)',
        }}>
          <span style={{ fontSize: 36, display: 'block', marginBottom: 12 }}>🔌</span>
          <p style={{ fontSize: 14, marginBottom: 6 }}>No integrations configured yet</p>
          <p style={{ fontSize: 12 }}>Add a preset or create a custom integration to get started.</p>
        </div>
      ) : (
        <div className="settings-stack-sm" style={{ gap: 6 }}>
          {configEntries.map(([storageKey, cfg]) => {
            // Find the preset by checking the preset field or the base type
            const presetType = cfg.preset || (storageKey.includes('_') ? storageKey.split('_')[0] : storageKey);
            const preset = presets.find(p => p.type === presetType);
            const isEnabled = cfg.enabled !== false;
            const displayName = cfg.instance
              ? `${preset?.name || presetType} (${cfg.instance})`
              : preset?.name || storageKey;

            return (
              <div key={storageKey} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px', borderRadius: 12,
                background: 'var(--bg-card-inner)',
                border: `1px solid ${isEnabled ? 'var(--border-color)' : 'var(--border-color)'}`,
                opacity: isEnabled ? 1 : 0.55,
                transition: 'all 0.2s',
              }}>
                {/* Icon */}
                <img
                  src={cachedIconUrl(presetIconUrl(preset?.icon || presetType))}
                  alt=""
                  style={{ width: 28, height: 28, borderRadius: 6 }}
                  onError={e => { e.target.style.display = 'none'; }}
                />

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 500 }}>
                    {displayName}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {cfg.url}
                    {cfg.target && <span style={{ marginLeft: 8, color: 'var(--accent)' }}>→ {cfg.target}</span>}
                  </div>
                </div>

                {/* Status badge */}
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 8px',
                  borderRadius: 4, flexShrink: 0,
                  background: isEnabled ? 'var(--green-bg)' : 'var(--amber-bg)',
                  color: isEnabled ? 'var(--green)' : 'var(--amber)',
                  border: `1px solid ${isEnabled ? 'var(--green-border)' : 'var(--amber-border)'}`,
                }}>
                  {isEnabled ? 'active' : 'disabled'}
                </span>

                {/* Toggle */}
                <button
                  className="settings-btn-sm"
                  onClick={() => onToggle(storageKey, cfg)}
                  style={{ padding: '4px 10px', fontSize: 11, color: isEnabled ? 'var(--amber)' : 'var(--green)' }}
                >
                  {isEnabled ? 'Disable' : 'Enable'}
                </button>

                {/* Edit */}
                <button
                  className="settings-btn-sm"
                  onClick={() => onEdit(preset || null, cfg, storageKey)}
                  style={{ padding: '4px 10px', fontSize: 11 }}
                >
                  Edit
                </button>

                {/* Delete */}
                <button
                  className="settings-btn-sm"
                  onClick={() => onDelete(storageKey)}
                  style={{ padding: '4px 10px', fontSize: 11, color: 'var(--red)', borderColor: 'var(--red-border)' }}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
