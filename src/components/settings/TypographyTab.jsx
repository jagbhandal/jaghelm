import React from 'react';

const FONT_PRESETS = [
  { id: 'default', name: 'Default', desc: 'Outfit + DM Sans + JetBrains Mono', sample: "'Outfit', sans-serif" },
  { id: 'clean', name: 'Clean', desc: 'Inter + Fira Code', sample: "'Inter', sans-serif" },
  { id: 'rounded', name: 'Rounded', desc: 'Nunito + Source Code Pro', sample: "'Nunito', sans-serif" },
  { id: 'sharp', name: 'Sharp', desc: 'Rajdhani + Roboto Mono', sample: "'Rajdhani', sans-serif" },
  { id: 'system', name: 'System', desc: 'OS default fonts (fastest)', sample: "system-ui, sans-serif" },
];

const SIZE_CONTROLS = [
  { key: 'sectionTitle', label: 'Section Headers', desc: 'Gateway Services, Production, etc.', min: 14, max: 24, default: 17 },
  { key: 'sectionSubtitle', label: 'Section Subtitles', desc: 'VM 103, Raspberry Pi 5, etc.', min: 10, max: 16, default: 12 },
  { key: 'metricValue', label: 'Metric Values', desc: 'CPU %, RAM GB, Uptime', min: 18, max: 32, default: 24 },
  { key: 'metricValueSm', label: 'Metric Values (Small)', desc: 'RAM used/total, Disk, Uptime text', min: 14, max: 24, default: 18 },
  { key: 'metricLabel', label: 'Metric Labels', desc: 'CPU, RAM, DISK, UPTIME headings', min: 8, max: 14, default: 10 },
  { key: 'serviceName', label: 'Service Names', desc: 'Container names on service cards', min: 11, max: 18, default: 13 },
  { key: 'serviceStatValue', label: 'Service Stat Values', desc: '1.4%, 1235 MB on service cards', min: 11, max: 18, default: 13 },
  { key: 'serviceStatLabel', label: 'Service Stat Labels', desc: 'CPU, MEM, RX, TX on service cards', min: 8, max: 14, default: 10 },
];

export default function TypographyTab({ config, update }) {
  const currentFont = config.fontFamily || 'default';
  const fontSizes = config.fontSizes || {};

  const updateSize = (key, value) => {
    update('fontSizes', { ...fontSizes, [key]: value });
  };

  const resetSizes = () => {
    update('fontSizes', {});
  };

  return (
    <div className="settings-section">
      <Card title="Font Family">
        <p className="settings-desc">
          Choose a font pairing for the dashboard. Each preset includes display, body, and monospace fonts.
        </p>
        <div className="settings-stack-sm">
          {FONT_PRESETS.map(f => (
            <button
              key={f.id}
              onClick={() => update('fontFamily', f.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '14px 16px', borderRadius: 12, cursor: 'pointer',
                border: currentFont === f.id ? '2px solid var(--accent)' : '1px solid var(--border-color)',
                background: currentFont === f.id ? 'var(--accent-glow)' : 'var(--bg-card-inner)',
                color: 'var(--text-primary)', textAlign: 'left', width: '100%',
                transition: 'all 0.15s',
              }}
            >
              <span style={{
                fontFamily: f.sample, fontSize: 22, fontWeight: 700,
                width: 36, textAlign: 'center', flexShrink: 0,
                color: currentFont === f.id ? 'var(--accent)' : 'var(--text-secondary)',
              }}>Aa</span>
              <div>
                <div style={{ fontFamily: f.sample, fontSize: 15, fontWeight: 600 }}>{f.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{f.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </Card>

      <Card title="Font Sizes">
        <p className="settings-desc">
          Fine-tune the size of specific dashboard elements. Drag a slider or click Reset to restore defaults.
        </p>

        {SIZE_CONTROLS.map(ctrl => {
          const value = fontSizes[ctrl.key] || ctrl.default;
          return (
            <div key={ctrl.key} style={{ marginBottom: 16 }}>
              <div className="settings-row-spread" style={{ marginBottom: 4 }}>
                <div>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                    {ctrl.label}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                    {value}px
                  </span>
                </div>
                {fontSizes[ctrl.key] && (
                  <button
                    onClick={() => {
                      const next = { ...fontSizes };
                      delete next[ctrl.key];
                      update('fontSizes', next);
                    }}
                    style={{
                      fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
                      background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px',
                    }}
                  >
                    reset
                  </button>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{ctrl.desc}</div>
              <input
                type="range"
                min={ctrl.min}
                max={ctrl.max}
                step={1}
                value={value}
                onChange={e => updateSize(ctrl.key, parseInt(e.target.value))}
                className="settings-range"
              />
              <div className="settings-range-labels">
                <span>{ctrl.min}px</span>
                <span>{ctrl.default}px (default)</span>
                <span>{ctrl.max}px</span>
              </div>
            </div>
          );
        })}

        <div style={{ marginTop: 8, paddingTop: 16, borderTop: '1px solid var(--border-color)' }}>
          <button
            className="settings-btn-danger"
            onClick={resetSizes}
          >
            Reset All Sizes to Defaults
          </button>
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
