import React, { useEffect, useRef, useState } from 'react';
import { SEARCH_ENGINES } from '../../hooks/useData';
import { useConfig } from '../../context/ConfigContext.jsx';
import Field from './Field';
import { Card, Toggle, ChoiceGroup } from './primitives.jsx';

// Returns an error string if `raw` is a non-empty value outside [min, max] or
// not a finite number; null when empty (cleared) or valid. Empty is allowed so
// the user can clear the field — geolocation simply falls back.
function coordError(raw, min, max, label) {
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return `${label} must be a number.`;
  if (n < min || n > max) return `${label} must be between ${min} and ${max}.`;
  return null;
}

export default function WidgetsTab() {
  const { config, update } = useConfig();

  // Local drafts for the coordinate inputs: typing always updates the draft so
  // we never block input, but we only persist (via update) a valid value. The
  // draft seeds from the persisted config and is the source of truth while the
  // user edits — letting us show an error for garbage without committing it.
  const [latDraft, setLatDraft] = useState(config.weatherLat || '');
  const [lonDraft, setLonDraft] = useState(config.weatherLon || '');

  // Track focus so a config change from outside this tab (Backup → Import whole-
  // config replace, or a reset) re-syncs the draft to the new persisted value,
  // but only while the user isn't actively editing that field — otherwise the
  // re-sync would clobber mid-keystroke input.
  const latFocused = useRef(false);
  const lonFocused = useRef(false);

  useEffect(() => {
    if (!latFocused.current) setLatDraft(config.weatherLat || '');
  }, [config.weatherLat]);

  useEffect(() => {
    if (!lonFocused.current) setLonDraft(config.weatherLon || '');
  }, [config.weatherLon]);

  const latError = coordError(latDraft, -90, 90, 'Latitude');
  const lonError = coordError(lonDraft, -180, 180, 'Longitude');

  // Update the draft on every keystroke (never blocking input); persist to
  // config only when the new value validates clean (in-range/finite, or empty).
  const onCoord = (key, setDraft, min, max, label) => (e) => {
    const raw = e.target.value;
    setDraft(raw);
    if (coordError(raw, min, max, label) === null) update(key, raw);
  };

  return (
    <div className="settings-section">
      <Card title="Search">
        <Toggle
          label="Show search bar in navigation"
          checked={config.showSearch !== false}
          onChange={(v) => update('showSearch', v)}
        />
        <Field label="Search Engine">
          <select
            className="settings-input"
            value={config.searchEngine || 'google'}
            onChange={(e) => update('searchEngine', e.target.value)}
          >
            {SEARCH_ENGINES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      </Card>

      <Card title="Weather">
        <Toggle
          label="Show weather in navigation"
          checked={config.showWeather !== false}
          onChange={(v) => update('showWeather', v)}
        />
        <Field label="Temperature Unit">
          <ChoiceGroup
            value={config.tempUnit || 'F'}
            options={[
              { value: 'F', label: '°F' },
              { value: 'C', label: '°C' },
            ]}
            onChange={(v) => update('tempUnit', v)}
            ariaLabel="Temperature Unit"
          />
        </Field>
        <div className="settings-grid-2">
          <Field label="Latitude" error={latError}>
            <input
              className="settings-input mono"
              value={latDraft}
              onChange={onCoord('weatherLat', setLatDraft, -90, 90, 'Latitude')}
              onFocus={() => { latFocused.current = true; }}
              onBlur={() => { latFocused.current = false; }}
              placeholder="39.88"
            />
          </Field>
          <Field label="Longitude" error={lonError}>
            <input
              className="settings-input mono"
              value={lonDraft}
              onChange={onCoord('weatherLon', setLonDraft, -180, 180, 'Longitude')}
              onFocus={() => { lonFocused.current = true; }}
              onBlur={() => { lonFocused.current = false; }}
              placeholder="-83.09"
            />
          </Field>
        </div>
        <Field label="City Name">
          <input
            className="settings-input"
            value={config.weatherCity || ''}
            onChange={(e) => update('weatherCity', e.target.value)}
            placeholder="Grove City"
          />
        </Field>
      </Card>

      <Card title="Features">
        <Toggle
          label="Show checklist panel on dashboard"
          checked={config.showTodos !== false}
          onChange={(v) => update('showTodos', v)}
        />
        <Toggle
          label="Show scheduled jobs panel on dashboard"
          checked={config.showCronJobs !== false}
          onChange={(v) => update('showCronJobs', v)}
        />
      </Card>
    </div>
  );
}
