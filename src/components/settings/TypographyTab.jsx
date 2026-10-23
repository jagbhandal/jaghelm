import React from 'react';
import { useConfig } from '../../context/ConfigContext.jsx';
import { Card } from './primitives.jsx';

const FONT_PRESETS = [
  {
    id: 'default',
    name: 'Default',
    desc: 'Manrope + JetBrains Mono',
    sample: "'Manrope Variable', sans-serif",
  },
  { id: 'clean', name: 'Clean', desc: 'Inter + Fira Code', sample: "'Inter', sans-serif" },
  {
    id: 'rounded',
    name: 'Rounded',
    desc: 'Nunito + Source Code Pro',
    sample: "'Nunito', sans-serif",
  },
  { id: 'sharp', name: 'Sharp', desc: 'Rajdhani + Roboto Mono', sample: "'Rajdhani', sans-serif" },
  {
    id: 'system',
    name: 'System',
    desc: 'OS default fonts (fastest)',
    sample: 'system-ui, sans-serif',
  },
];

/**
 * Settings → Typography: the font preset Settings draws in, until #321
 * brings the typeface and one text size. The per-element font sizes sized the
 * old board's panels and went with it (#306).
 */
export default function TypographyTab() {
  const { config, update } = useConfig();
  const currentFont = config.fontFamily || 'default';

  return (
    <div className="settings-section">
      <Card title="Font Family">
        <p className="settings-desc">
          Choose a font pairing for the dashboard. Each preset includes display, body, and monospace
          fonts.
        </p>
        <div className="settings-stack-sm">
          {FONT_PRESETS.map((f) => (
            <button
              key={f.id}
              onClick={() => update('fontFamily', f.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '14px 16px',
                borderRadius: 12,
                cursor: 'pointer',
                border:
                  currentFont === f.id
                    ? '2px solid var(--accent)'
                    : '1px solid var(--border-color)',
                background: currentFont === f.id ? 'var(--accent-glow)' : 'var(--bg-card-inner)',
                color: 'var(--text-primary)',
                textAlign: 'left',
                width: '100%',
                transition: 'all 0.15s',
              }}
            >
              <span
                style={{
                  fontFamily: f.sample,
                  fontSize: 22,
                  fontWeight: 700,
                  width: 36,
                  textAlign: 'center',
                  flexShrink: 0,
                  color: currentFont === f.id ? 'var(--accent)' : 'var(--text-secondary)',
                }}
              >
                Aa
              </span>
              <div>
                <div style={{ fontFamily: f.sample, fontSize: 15, fontWeight: 600 }}>{f.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {f.desc}
                </div>
              </div>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
