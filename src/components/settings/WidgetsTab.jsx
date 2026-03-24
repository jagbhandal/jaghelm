import React from 'react';
import { SEARCH_ENGINES } from '../../hooks/useData';

export default function WidgetsTab({ config, update }) {
  return (
    <div className="settings-section">
      <Card title="Search">
        <Chk
          label="Show search bar in navigation"
          checked={config.showSearch !== false}
          onChange={v => update('showSearch', v)}
        />
        <Field label="Search Engine">
          <select
            className="settings-input"
            value={config.searchEngine || 'google'}
            onChange={e => update('searchEngine', e.target.value)}
          >
            {SEARCH_ENGINES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      </Card>

      <Card title="Weather">
        <Chk
          label="Show weather in navigation"
          checked={config.showWeather !== false}
          onChange={v => update('showWeather', v)}
        />
        <Field label="Temperature Unit">
          <div className="settings-choice-group">
            {['F', 'C'].map(u => (
              <button
                key={u}
                onClick={() => update('tempUnit', u)}
                className={`settings-choice-btn ${(config.tempUnit || 'F') === u ? 'active' : ''}`}
              >
                °{u}
              </button>
            ))}
          </div>
        </Field>
        <div className="settings-grid-2">
          <Field label="Latitude">
            <input
              className="settings-input mono"
              value={config.weatherLat || ''}
              onChange={e => update('weatherLat', e.target.value)}
              placeholder="39.88"
            />
          </Field>
          <Field label="Longitude">
            <input
              className="settings-input mono"
              value={config.weatherLon || ''}
              onChange={e => update('weatherLon', e.target.value)}
              placeholder="-83.09"
            />
          </Field>
        </div>
        <Field label="City Name">
          <input
            className="settings-input"
            value={config.weatherCity || ''}
            onChange={e => update('weatherCity', e.target.value)}
            placeholder="Grove City"
          />
        </Field>
      </Card>

      <Card title="Features">
        <Chk
          label="Show checklist panel on dashboard"
          checked={config.showTodos !== false}
          onChange={v => update('showTodos', v)}
        />
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

function Chk({ label, checked, onChange }) {
  return (
    <label className="settings-toggle">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
