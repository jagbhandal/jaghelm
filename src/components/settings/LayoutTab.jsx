import React from 'react';

export default function LayoutTab({ config, update }) {
  return (
    <div className="settings-section">
      <Card title="Grid">
        <Field label={`Grid Columns: ${config.gridColumns || 24}`}>
          <input
            type="range" min="6" max="24" step="2"
            value={config.gridColumns || 24}
            onChange={e => update('gridColumns', parseInt(e.target.value))}
            className="settings-range"
          />
          <div className="settings-range-labels">
            <span>6 (compact)</span>
            <span>12 (default)</span>
            <span>24 (fine grid)</span>
          </div>
          <div className="settings-hint-block" style={{ marginTop: 8 }}>
            More columns = finer positioning and narrower panels possible.
            Changing this resets panel positions.
          </div>
        </Field>

        <div style={{ marginTop: 16 }}>
          <button
            className="settings-btn-danger"
            onClick={() => update('gridLayout', null)}
          >
            Reset Grid Layout
          </button>
          <p className="settings-hint-block" style={{ marginTop: 6 }}>
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
          <div className="settings-range-labels">
            <span>10s (fast)</span>
            <span>120s (slow)</span>
          </div>
        </Field>
      </Card>

      <Card title="Service Cards">
        <Field label="Docker Metrics (CPU, MEM, RX, TX)">
          <label className="settings-checkbox-label">
            <input
              type="checkbox"
              checked={config.showDockerStats !== false}
              onChange={e => update('showDockerStats', e.target.checked)}
              className="settings-checkbox"
            />
            <span className="settings-checkbox-text">Show per-container CPU, memory, and network stats</span>
          </label>
        </Field>

        <Field label="App Integration Data">
          <label className="settings-checkbox-label">
            <input
              type="checkbox"
              checked={config.showAppData !== false}
              onChange={e => update('showAppData', e.target.checked)}
              className="settings-checkbox"
            />
            <span className="settings-checkbox-text">Show app-specific API data (queries blocked, streams, etc.)</span>
          </label>
        </Field>

        <Field label={`Service Columns per Row: ${config.serviceColumns || 'Auto'}`}>
          <div className="settings-choice-group">
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
          <div className="settings-hint-block" style={{ marginTop: 8 }}>
            <strong>Auto:</strong> Cards fill available space responsively<br />
            <strong>2–6:</strong> Maximum columns — cards reflow to fewer columns as the panel narrows
          </div>
        </Field>

        <Field label="Card Layout">
          <div className="settings-choice-group">
            {[
              { id: 'list', label: 'List' },
              { id: 'row', label: 'Row' },
              { id: 'grid', label: 'Grid' },
            ].map(mode => (
              <button
                key={mode.id}
                onClick={() => update('cardLayout', mode.id)}
                className={`settings-choice-btn ${(config.cardLayout || 'row') === mode.id ? 'active' : ''}`}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <div className="settings-hint-block">
            List: clean rows, no backgrounds. Row: subtle card per service (default). Grid: compact card boxes.
          </div>
        </Field>

        <Field label="Status Style">
          <div className="settings-choice-group">
            {['dot', 'badge', 'minimal'].map(style => (
              <button
                key={style}
                onClick={() => update('statusStyle', style)}
                className={`settings-choice-btn ${(config.statusStyle || 'badge') === style ? 'active' : ''}`}
              >
                {style}
              </button>
            ))}
          </div>
          <div className="settings-hint-block">
            How container status is displayed on service cards
          </div>
        </Field>
      </Card>

      <Card title="Behavior">
        <Field label="Link Target">
          <div className="settings-choice-group">
            {['_blank', '_self'].map(target => (
              <button
                key={target}
                onClick={() => update('linkTarget', target)}
                className={`settings-choice-btn ${(config.linkTarget || '_blank') === target ? 'active' : ''}`}
              >
                {target === '_blank' ? 'New Tab' : 'Same Tab'}
              </button>
            ))}
          </div>
          <div className="settings-hint-block">
            Where Quick Launch links and service links open
          </div>
        </Field>

        <Field label="Temperature Unit">
          <div className="settings-choice-group">
            {['F', 'C'].map(unit => (
              <button
                key={unit}
                onClick={() => update('tempUnit', unit)}
                className={`settings-choice-btn ${(config.tempUnit || 'F') === unit ? 'active' : ''}`}
              >
                °{unit}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Collapsible Sections">
          <label className="settings-checkbox-label">
            <input
              type="checkbox"
              checked={config.collapsibleSections || false}
              onChange={e => update('collapsibleSections', e.target.checked)}
              className="settings-checkbox"
            />
            <span className="settings-checkbox-text">Allow clicking section headers to collapse/expand</span>
          </label>
        </Field>
      </Card>

      <Card title="Visual">
        <Field label={`Card Blur: ${config.cardBlur || 'none'}`}>
          <div className="settings-choice-group">
            {['none', 'sm', 'md', 'lg'].map(blur => (
              <button
                key={blur}
                onClick={() => update('cardBlur', blur)}
                className={`settings-choice-btn ${(config.cardBlur || 'none') === blur ? 'active' : ''}`}
              >
                {blur}
              </button>
            ))}
          </div>
          <div className="settings-hint-block">
            Backdrop blur effect on cards (requires a background image to be visible)
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
