import React, { useEffect, useRef, useState } from 'react';
import { Palette } from 'lucide-react';
import { useConfig } from '../../../context/ConfigContext.jsx';
import Field from '../Field';
import { Card, ChoiceGroup, Toggle } from '../primitives.jsx';
import { BackgroundCard, EffectsCard, OverviewSectionsCard, ThemeCard } from '../AppearanceTab.jsx';
import TypographyTab from '../TypographyTab.jsx';
import GeneralTab from '../GeneralTab.jsx';

/**
 * Settings → Appearance (#317): how JagHelm looks, in the mock's order. What
 * was General (branding, logo), Typography and Appearance, the temperature
 * unit (Layout's), the utilities' switches (Sections') and the weather and
 * the clock (Widgets'), moved as they were; #321 rebuilds it (theme, accent,
 * typeface, text size, density, Overview sections, branding).
 */
export default function Appearance({ theme, setTheme }) {
  return (
    <div className="settings-section">
      <ThemeCard theme={theme} setTheme={setTheme} />
      <TypographyTab />
      <TemperatureCard />
      <OverviewSectionsCard />
      <UtilitiesCard />
      <WeatherCard />
      <ClockCard />
      <GeneralTab />
      <BackgroundCard />
      <EffectsCard />
    </div>
  );
}

Appearance.icon = <Palette />;

// The utilities' switches (`sections.<key>.visible`, the rail reads them).
const UTILITIES = [
  { key: 'quicklaunch', label: 'Quick Launch', description: 'Your links, by group' },
  {
    key: 'pipeline',
    label: 'Pipeline',
    description: 'The newest commits, when Gitea is set up (JAGHELM_GITEA_URL)',
  },
  { key: 'todos', label: 'Checklist', description: 'Your to-dos' },
];

/**
 * A switch each for Quick Launch, Pipeline and the Checklist, which the
 * Overview's utilities rail draws (#301; the Launch page always has them).
 * The old board's panels had a title, subtitle, icon and colours of their own
 * here; the new sections have none (#306, the Settings map in spec §15).
 */
function UtilitiesCard() {
  const { config, update } = useConfig();
  const sections = config.sections || {};
  return (
    <Card title="Utilities" id="utilities">
      <p className="settings-hint-block" style={{ marginBottom: 8 }}>
        Beside the Overview from 1440px wide. The Launch page always has them.
      </p>
      {UTILITIES.map(({ key, label, description }) => (
        <Toggle
          key={key}
          label={label}
          description={description}
          checked={sections[key]?.visible !== false}
          onChange={(v) => update(`sections.${key}.visible`, v)}
        />
      ))}
    </Card>
  );
}

/** The temperature unit: the nodes' temperatures and the weather. */
function TemperatureCard() {
  const { config, update } = useConfig();
  return (
    <Card title="Temperature" id="temperature">
      <Field label="Temperature Unit">
        <ChoiceGroup
          ariaLabel="Temperature Unit"
          value={config.tempUnit || 'F'}
          options={[
            { value: 'F', label: '°F' },
            { value: 'C', label: '°C' },
          ]}
          onChange={(value) => update('tempUnit', value)}
        />
        <div className="settings-hint-block">The nodes&apos; temperatures and the weather</div>
      </Field>
    </Card>
  );
}

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

/**
 * The weather (the Overview's utilities rail from 1440px, and the Launch
 * page), as #307 brought it back: its switch and its place. Its unit is the
 * Temperature card's.
 */
function WeatherCard() {
  const { config, update } = useConfig();

  // Local drafts for the coordinate inputs: typing always updates the draft so
  // we never block input, but we only persist (via update) a valid value. The
  // draft seeds from the persisted config and is the source of truth while the
  // user edits — letting us show an error for garbage without committing it.
  const [latDraft, setLatDraft] = useState(config.weatherLat || '');
  const [lonDraft, setLonDraft] = useState(config.weatherLon || '');

  // Track focus so a config change from outside this card (System → Backup's
  // whole-config import, or a reset) re-syncs the draft to the new persisted
  // value, but only while the user isn't actively editing that field —
  // otherwise the re-sync would clobber mid-keystroke input.
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
    <Card title="Weather" id="weather">
      <Toggle
        label="Show the weather on the Overview and the Launch page"
        checked={config.showWeather !== false}
        onChange={(v) => update('showWeather', v)}
      />
      <div className="settings-grid-2">
        <Field label="Latitude" error={latError}>
          <input
            className="settings-input mono"
            value={latDraft}
            onChange={onCoord('weatherLat', setLatDraft, -90, 90, 'Latitude')}
            onFocus={() => {
              latFocused.current = true;
            }}
            onBlur={() => {
              latFocused.current = false;
            }}
            placeholder="39.88"
          />
        </Field>
        <Field label="Longitude" error={lonError}>
          <input
            className="settings-input mono"
            value={lonDraft}
            onChange={onCoord('weatherLon', setLonDraft, -180, 180, 'Longitude')}
            onFocus={() => {
              lonFocused.current = true;
            }}
            onBlur={() => {
              lonFocused.current = false;
            }}
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
  );
}

/** The clock (the utilities rail and the Launch page, #307). */
function ClockCard() {
  const { config, update } = useConfig();
  return (
    <Card title="Clock" id="clock">
      <Toggle
        label="Show the clock on the Overview and the Launch page"
        checked={config.showClock !== false}
        onChange={(v) => update('showClock', v)}
      />
    </Card>
  );
}
