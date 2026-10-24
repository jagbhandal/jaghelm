import React, { useEffect, useRef, useState } from 'react';
import { Palette } from 'lucide-react';
import {
  AccentChoice,
  FieldGrid,
  FontChoice,
  ImagePicker,
  RangeField,
  SettingBlock,
  SettingRow,
  SettingRows,
  ThemeChoice,
  ToggleRow,
} from '@ui/appearance';
import { Banner } from '@ui/banner';
import { Button } from '@ui/button';
import { Field } from '@ui/field';
import { Input } from '@ui/input';
import { Panel } from '@ui/panel';
import { SegmentedControl } from '@ui/segmented-control';
import { Select } from '@ui/select';
import { SettingsPart } from '@ui/settings';
import { useConfig } from '../../../context/ConfigContext.jsx';
import { uploadFile } from '../../../hooks/useData';
import { FONT_FAMILIES } from '../../../hooks/useThemeVars.js';
import { DENSITIES, appearanceOf } from '../../../shell/appearance.js';
import { OVERVIEW_SECTIONS, sectionShown } from '../../../shell/overviewSections.js';
import { THEMES } from '../../../shell/theme.js';
import { unitsFromConfig } from '../../../util/format.js';
import { DEFAULT_ACCENT } from '../../../ui/accents.js';
import { ACCENT_SET } from './accentSet.js';

/**
 * Settings → Appearance (#321, spec §7): how JagHelm looks, in the design
 * system (src/ui/appearance.jsx and the controls), each change applied as it
 * is made (no preview, #317). Theme (dark, light or system: per browser,
 * theme.js); Accent (src/ui/accents.js's set, Violet by default) and Density
 * (comfortable or compact), which the shell gives every root
 * (src/shell/appearance.js); the font preset; Branding (the instance's name,
 * subtitle and logo, JagHelm's own by default); the background; the
 * Overview's sections; and Widgets (the weather, the clock, the utilities'
 * switches and the temperature unit). Accent, density and the rest are saved
 * in the display config, so every device draws the same.
 *
 * Each part has the id sections.js names as its anchor. An accent colour a
 * config saved before #304 was mapped to the nearest of the set when the app
 * loaded (accentSet.js); the Accent panel says so until it is dismissed or
 * another accent is picked.
 */
export default function Appearance({ theme, setTheme }) {
  return (
    <SettingsPart>
      <Panel
        title="Theme"
        description="Dark, light, or the device’s own setting."
        {...part('theme')}
      >
        <ThemeChoice
          aria-label="Theme"
          options={THEME_OPTIONS}
          value={theme}
          onValueChange={(value) => setTheme(value)}
        />
      </Panel>
      <AccentPanel />
      <DensityPanel />
      <TypePanel />
      <BrandingPanel />
      <BackgroundPanel />
      <OverviewSectionsPanel />
      <WidgetsPanel />
    </SettingsPart>
  );
}

Appearance.icon = <Palette />;

// A part a link opens at stops under the header (global.css).
const part = (id) => ({ id, className: 'settings-anchor' });

const THEME_OPTIONS = THEMES.map((t) => ({
  value: t.id,
  label: t.label,
  description: t.description,
}));

const ACCENT_OPTIONS = ACCENT_SET.map((a) => ({
  value: a.id,
  label: a.id === DEFAULT_ACCENT ? `${a.label} (default)` : a.label,
}));
const accentLabel = (id) => ACCENT_SET.find((a) => a.id === id)?.label ?? id;

function AccentPanel() {
  const { config, setConfig } = useConfig();
  const { accent } = appearanceOf(config);
  const notice = config.accentNotice;
  // Picking an accent, or dismissing, ends the notice.
  const withoutNotice = (prev) => {
    const { accentNotice: _, ...rest } = prev;
    return rest;
  };
  return (
    <Panel
      title="Accent"
      description="Buttons, links, selection and focus. Never a status colour: no green, amber, red or grey is offered."
      {...part('accent')}
    >
      {notice?.from && notice?.to ? (
        <Banner
          tone="info"
          title={`Your accent is now ${accentLabel(notice.to)}`}
          cause={`JagHelm no longer offers your own colour, ${notice.from}. ${accentLabel(notice.to)} is the nearest of the three.`}
          action={
            <Button size="sm" variant="ghost" onClick={() => setConfig(withoutNotice)}>
              Dismiss
            </Button>
          }
        />
      ) : null}
      <AccentChoice
        aria-label="Accent"
        options={ACCENT_OPTIONS}
        value={accent}
        onValueChange={(id) => setConfig((prev) => ({ ...withoutNotice(prev), accent: id }))}
      />
    </Panel>
  );
}

const DENSITY_OPTIONS = DENSITIES.map((d) => ({ value: d.id, label: d.label }));

function DensityPanel() {
  const { config, update } = useConfig();
  return (
    <Panel
      title="Density"
      description="Row height and panel padding on the screens already redrawn in the new design: 40px rows, or 32px with less padding. The rest of JagHelm keeps its own spacing."
      {...part('density')}
    >
      <SegmentedControl
        aria-label="Density"
        options={DENSITY_OPTIONS}
        value={appearanceOf(config).density}
        onValueChange={(value) => update('density', value)}
      />
    </Panel>
  );
}

// The font presets (Typography's before #317), each drawn in its own face.
const FONT_PRESETS = [
  { value: 'default', label: 'Default', description: 'Manrope + JetBrains Mono' },
  { value: 'clean', label: 'Clean', description: 'Inter + Fira Code' },
  { value: 'rounded', label: 'Rounded', description: 'Nunito + Source Code Pro' },
  { value: 'sharp', label: 'Sharp', description: 'Rajdhani + Roboto Mono' },
  { value: 'system', label: 'System', description: 'The device’s own fonts (fastest)' },
].map((f) => ({ ...f, family: FONT_FAMILIES[f.value].body }));

function TypePanel() {
  const { config, update } = useConfig();
  return (
    <Panel
      title="Font family"
      description="The font of the screens not yet redrawn in the new design. The rest of JagHelm draws in Manrope."
      {...part('font')}
    >
      <FontChoice
        aria-label="Font family"
        options={FONT_PRESETS}
        value={FONT_FAMILIES[config.fontFamily] ? config.fontFamily : 'default'}
        onValueChange={(value) => update('fontFamily', value)}
      />
    </Panel>
  );
}

/** An image upload: its error, and `pick(file)`, which uploads it and saves its URL at `key`. */
function useUpload(kind, key, what) {
  const { update } = useConfig();
  const [error, setError] = useState('');
  const pick = async (file) => {
    setError('');
    try {
      const r = await uploadFile(file, kind);
      update(key, r.url);
    } catch (e) {
      setError(`${what} upload failed: ${e.message}`);
    }
  };
  return [error, pick];
}

function BrandingPanel() {
  const { config, update } = useConfig();
  const [error, pick] = useUpload('logo', 'logoUrl', 'Logo');
  return (
    <Panel
      title="Branding"
      description="Shown in the header, the browser tab and the sign-in page."
      {...part('branding')}
    >
      <FieldGrid>
        <Field label="Instance name">
          <Input
            value={config.title || ''}
            onChange={(e) => update('title', e.target.value)}
            placeholder="JAGHELM"
          />
        </Field>
        <Field label="Subtitle">
          <Input
            value={config.subtitle || ''}
            onChange={(e) => update('subtitle', e.target.value)}
            placeholder="Infrastructure Dashboard"
          />
        </Field>
      </FieldGrid>
      <ImagePicker
        {...part('logo')}
        label="Logo"
        labelAs="h3"
        src={config.logoUrl || '/logo.svg'}
        alt="Logo"
        description={config.logoUrl ? 'Your own logo' : 'JagHelm’s logo (the default)'}
        pickLabel="Upload New"
        onPick={pick}
        clearLabel="Restore Default"
        onClear={config.logoUrl ? () => update('logoUrl', '') : undefined}
        error={error}
      />
    </Panel>
  );
}

const BLURS = [
  { value: 'none', label: 'None' },
  { value: 'sm', label: 'Small' },
  { value: 'md', label: 'Medium' },
  { value: 'lg', label: 'Large' },
];
const percent = (x) => `${Math.round(x * 100)}%`;

function BackgroundPanel() {
  const { config, update } = useConfig();
  const [error, pick] = useUpload('bg', 'bgImage', 'Background');
  const bgOpacity = config.bgOpacity ?? 0.3;
  const overlayOpacity = config.overlayOpacity ?? 0.75;
  return (
    <Panel
      flush
      title="Background"
      description="An image behind the page, and the dot grid. The cards blur only over an image."
      {...part('background')}
    >
      <SettingRows>
        <SettingBlock>
          <ImagePicker
            label="Image"
            src={config.bgImage || undefined}
            wide
            pickLabel={config.bgImage ? 'Change Image' : 'Upload Image'}
            onPick={pick}
            clearLabel="Remove"
            onClear={config.bgImage ? () => update('bgImage', '') : undefined}
            error={error}
          />
          <RangeField
            label={`Image opacity: ${percent(bgOpacity)}`}
            min={0}
            max={1}
            step={0.05}
            value={bgOpacity}
            onValueChange={(v) => update('bgOpacity', v)}
          />
          <RangeField
            label={`Overlay opacity: ${percent(overlayOpacity)}`}
            min={0}
            max={1}
            step={0.02}
            value={overlayOpacity}
            onValueChange={(v) => update('overlayOpacity', v)}
          />
          <Field label="Card blur">
            <SegmentedControl
              options={BLURS}
              value={config.cardBlur || 'none'}
              onValueChange={(value) => update('cardBlur', value)}
            />
          </Field>
        </SettingBlock>
        <ToggleRow
          {...part('effects')}
          titleAs="h3"
          label="Dot grid"
          description="A grid of dots behind the Overview"
          checked={config.showDots !== false}
          onCheckedChange={(on) => update('showDots', on)}
        />
      </SettingRows>
    </Panel>
  );
}

function OverviewSectionsPanel() {
  const { config, update } = useConfig();
  return (
    <Panel
      flush
      title="Overview sections"
      description="Show or hide each section of the Overview, on every device. Reordering comes with Edit layout; until then the order is fixed."
      {...part('overview-sections')}
    >
      <SettingRows>
        {OVERVIEW_SECTIONS.map((section) => (
          <ToggleRow
            key={section.id}
            label={section.label}
            description={section.description}
            checked={sectionShown(config, section.id)}
            disabled={section.locked}
            onCheckedChange={(on) => update(`overviewSections.${section.id}`, on)}
          />
        ))}
      </SettingRows>
    </Panel>
  );
}

// The utilities' switches (`sections.<key>.visible`): the rail reads them.
const UTILITIES = [
  { key: 'quicklaunch', label: 'Quick Launch', description: 'Your links, by group' },
  {
    key: 'pipeline',
    label: 'Pipeline',
    description: 'The newest commits, when Gitea is set up (JAGHELM_GITEA_URL)',
  },
  { key: 'todos', label: 'Checklist', description: 'Your to-dos' },
];

// The one units setting (#322, #260).
const UNITS = [
  { value: 'metric', label: 'Metric (°C)' },
  { value: 'imperial', label: 'Imperial (°F)' },
];

// Dates and times follow the browser unless one is picked here.
const AUTO = 'auto';
const LOCALES = [
  { value: AUTO, label: 'Browser default' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'es-ES', label: 'Español' },
  { value: 'it-IT', label: 'Italiano' },
  { value: 'nl-NL', label: 'Nederlands' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'sv-SE', label: 'Svenska' },
  { value: 'ja-JP', label: '日本語' },
];

function WidgetsPanel() {
  const { config, update } = useConfig();
  const sections = config.sections || {};
  return (
    <Panel
      flush
      title="Widgets"
      description="What the Overview shows beside its sections from 1440px wide, and the Launch page."
    >
      <SettingRows>
        <ToggleRow
          {...part('weather')}
          titleAs="h3"
          label="Weather"
          description="On the Overview and the Launch page; its place below, or the browser’s"
          checked={config.showWeather !== false}
          onCheckedChange={(on) => update('showWeather', on)}
        >
          <WeatherPlace />
        </ToggleRow>
        <ToggleRow
          {...part('clock')}
          titleAs="h3"
          label="Clock"
          description="On the Overview and the Launch page"
          checked={config.showClock !== false}
          onCheckedChange={(on) => update('showClock', on)}
        />
        <SettingRows
          {...part('utilities')}
          title="Utilities"
          description="Beside the Overview from 1440px wide. The Launch page always has them."
        >
          {UTILITIES.map(({ key, label, description }) => (
            <ToggleRow
              key={key}
              label={label}
              description={description}
              checked={sections[key]?.visible !== false}
              onCheckedChange={(on) => update(`sections.${key}.visible`, on)}
            />
          ))}
        </SettingRows>
        <SettingRow
          {...part('units')}
          titleAs="h3"
          label="Units"
          description="Temperatures"
          control={(ids) => (
            <SegmentedControl
              {...ids}
              options={UNITS}
              value={unitsFromConfig(config)}
              onValueChange={(value) => update('units', value)}
            />
          )}
        />
        <SettingRow
          {...part('locale')}
          titleAs="h3"
          label="Dates and times"
          description="How they are written; the browser’s own unless you pick one"
          control={(ids) => (
            <Select
              {...ids}
              items={localeItems(config.locale)}
              value={config.locale ? config.locale : AUTO}
              onValueChange={(value) => update('locale', value === AUTO ? '' : value)}
            />
          )}
        />
      </SettingRows>
    </Panel>
  );
}

// The list, with a locale a config carries by hand if it isn't in it.
function localeItems(locale) {
  return !locale || LOCALES.some((l) => l.value === locale)
    ? LOCALES
    : [...LOCALES, { value: locale, label: locale }];
}

// Coordinates are figures: the mono face (tokens.css), as the old fields had.
const MONO = { fontFamily: 'var(--jh-font-mono)' };

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
 * The weather's place. Local drafts for the coordinates: typing always
 * updates the draft, so input is never blocked, but only a valid value (in
 * range, or empty) is saved, and garbage shows an error without being
 * committed. A change from outside (System → Backup's import, a reset)
 * re-syncs a field's draft, but only while that field isn't focused, so it
 * never clobbers a keystroke.
 */
function WeatherPlace() {
  const { config, update } = useConfig();
  const [latDraft, setLatDraft] = useState(config.weatherLat || '');
  const [lonDraft, setLonDraft] = useState(config.weatherLon || '');
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

  const coord = (key, draft, setDraft, focused, min, max, label, placeholder, error) => (
    <Field label={label} error={error}>
      <Input
        style={MONO}
        value={draft}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          if (coordError(raw, min, max, label) === null) update(key, raw);
        }}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
        }}
        placeholder={placeholder}
      />
    </Field>
  );

  return (
    <FieldGrid columns={3}>
      {coord(
        'weatherLat',
        latDraft,
        setLatDraft,
        latFocused,
        -90,
        90,
        'Latitude',
        '51.51',
        latError
      )}
      {coord(
        'weatherLon',
        lonDraft,
        setLonDraft,
        lonFocused,
        -180,
        180,
        'Longitude',
        '-0.13',
        lonError
      )}
      <Field label="City">
        <Input
          value={config.weatherCity || ''}
          onChange={(e) => update('weatherCity', e.target.value)}
          placeholder="London"
        />
      </Field>
    </FieldGrid>
  );
}
