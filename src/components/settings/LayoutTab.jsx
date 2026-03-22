import React from 'react';

export default function LayoutTab({ config, update }) {
  return (
    <div className="settings-section">
      <Card title="Grid">
        <Field label={`Grid Columns: ${config.gridColumns || 12}`}>
          <input
            type="range" min="4" max="16" step="1"
            value={config.gridColumns || 12}
            onChange={e => update('gridColumns', parseInt(e.target.value))}
            className="settings-range"
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 4 }}>
            <span>4 (compact)</span>
            <span>12 (default)</span>
            <span>16 (wide)</span>
          </div>
        </Field>

        <div style={{ marginTop: 16 }}>
          <button
            className="settings-btn-sm"
            onClick={() => update('gridLayout', null)}
            style={{ color: 'var(--red)', borderColor: 'var(--red-border)' }}
          >
            Reset Grid Layout
          </button>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            Resets all panel positions and sizes to defaults.
          </p>
        </div>
      </Card>

      <Card title="Refresh">
        <Field label={`Auto-refresh Interval: ${config.refreshInterval || 30}s`}>
          <input
            type="range" min="10" max="120" step="5"
            value={config.refreshInterval || 30}
            onChange={e => update('refreshInterval', parseInt(e.target.value))}
            className="settings-range"
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 4 }}>
            <span>10s (fast)</span>
            <span>30s</span>
            <span>120s (slow)</span>
          </div>
        </Field>
      </Card>

      <Card title="Service Cards">
        <Field label="Detail Level">
          <div style={{ display: 'flex', gap: 8 }}>
            {['minimal', 'stats', 'full'].map(lv => (
              <button
                key={lv}
                onClick={() => update('serviceDetailLevel', lv)}
                className={`settings-choice-btn ${(config.serviceDetailLevel || 'minimal') === lv ? 'active' : ''}`}
              >
                {lv}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>
            <strong>Minimal:</strong> Status + latency badge<br />
            <strong>Stats:</strong> + CPU, MEM, RX, TX per container<br />
            <strong>Full:</strong> + app-specific API data (queries, hosts, etc.)
          </div>
        </Field>

        <Field label={`Service Columns per Row: ${config.serviceColumns || 'Auto'}`}>
          <div style={{ display: 'flex', gap: 6 }}>
            {[0, 2, 3, 4, 5, 6].map(n => (
              <button
                key={n}
                onClick={() => update('serviceColumns', n)}
                className={`settings-choice-btn ${(config.serviceColumns || 0) === n ? 'active' : ''}`}
              >
                {n === 0 ? 'Auto' : n}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>
            <strong>Auto:</strong> Cards fill available space responsively<br />
            <strong>2–6:</strong> Fixed columns — each card takes equal width of the panel
          </div>
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

function Field({ label, children }) {
  return (
    <div className="settings-field">
      <label className="settings-label">{label}</label>
      {children}
    </div>
  );
}
