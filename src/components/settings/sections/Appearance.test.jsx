import { render, screen, fireEvent, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import Appearance from './Appearance.jsx';
import { ConfigProvider } from '../../../context/ConfigContext.jsx';
import { OverlayProvider } from '../../../context/OverlayContext.jsx';
import { ACCENTS } from '../../../ui/accents.js';
import { TYPEFACES } from '../../../ui/typefaces.js';

// Settings → Appearance (#321): theme, accent, density, font, branding, the
// background, the Overview's sections and the widgets, rebuilt in the design
// system, every setting it had kept (SettingsView.index.test.jsx walks them
// all), each change applied as it is made.

// Over a config held as App holds it, which a test can swap from "outside"
// the section; `window.__config` is the latest.
function Harness({ initialConfig, theme = 'dark', setTheme = vi.fn(), refresh }) {
  const [config, setConfigState] = useState(initialConfig);
  const setConfig = (updater) => {
    setConfigState((prev) => (typeof updater === 'function' ? updater(prev) : updater));
  };
  window.__setConfig = setConfig;
  window.__config = config;
  return (
    <OverlayProvider>
      <ConfigProvider config={config} setConfig={setConfig} refresh={refresh}>
        <Appearance theme={theme} setTheme={setTheme} />
      </ConfigProvider>
    </OverlayProvider>
  );
}

const baseConfig = (extra = {}) => ({
  title: 'JAGHELM',
  weatherLat: '39.88',
  weatherLon: '-83.09',
  ...extra,
});

/** The panel named `title`. */
const panel = (title) => screen.getByRole('region', { name: title });

describe('the section, in the design system', () => {
  it('is its parts in order, each a panel under the anchor sections.js names', () => {
    const { container } = render(<Harness initialConfig={baseConfig()} />);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Theme',
      'Custom themes',
      'Accent',
      'Density',
      'Font family',
      'Branding',
      'Background',
      'Overview sections',
      'Widgets',
    ]);
    for (const id of [
      'theme',
      'custom-themes',
      'accent',
      'density',
      'font',
      'branding',
      'logo',
      'background',
      'effects',
      'overview-sections',
      'weather',
      'clock',
      'utilities',
      'units',
      'locale',
    ])
      expect(container.querySelector(`#${id}`), id).not.toBeNull();
  });

  it('has no control in the old look: every one is inside a root of the new UI', () => {
    const { container } = render(<Harness initialConfig={baseConfig()} />);
    const old = container.querySelectorAll(
      '.settings-card, .settings-toggle, .settings-choice-group, .settings-input, .settings-theme-btn, .settings-btn-sm, .settings-range'
    );
    expect(old).toHaveLength(0);
    const controls = container.querySelectorAll('button, input, [role="radiogroup"]');
    expect(controls.length).toBeGreaterThan(20);
    for (const el of controls) expect(el.closest('.jh-ui'), el.outerHTML).not.toBeNull();
  });
});

describe('the theme (#304)', () => {
  it('offers Dark, Light and System as one choice, the current one checked', () => {
    render(<Harness initialConfig={baseConfig()} theme="system" />);
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    const options = within(group).getAllByRole('radio');
    expect(options).toEqual(
      ['Dark', 'Light', 'System'].map((name) => within(group).getByRole('radio', { name }))
    );
    expect(options.map((o) => o.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
    expect(options[2]).toHaveAccessibleDescription('Follows the device');
  });

  it('switches the theme', async () => {
    const user = userEvent.setup();
    const setTheme = vi.fn();
    render(<Harness initialConfig={baseConfig()} setTheme={setTheme} />);
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    await user.click(within(group).getByRole('radio', { name: 'Light' }));
    expect(setTheme).toHaveBeenLastCalledWith('light');
    await user.click(within(group).getByRole('radio', { name: 'System' }));
    expect(setTheme).toHaveBeenLastCalledWith('system');
  });
});

describe('the accent', () => {
  it('offers the set the contrast check passes, Violet by default and chosen', () => {
    render(<Harness initialConfig={baseConfig()} />);
    const group = screen.getByRole('radiogroup', { name: 'Accent' });
    const options = within(group).getAllByRole('radio');
    expect(options.map((o) => o.textContent)).toEqual(
      ACCENTS.map((a) => (a.id === 'violet' ? `${a.label} (default)` : a.label))
    );
    expect(options.map((o) => o.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    // No free colour picker: green, amber and red are never offered.
    expect(screen.queryByText(/Click swatch/)).toBeNull();
    expect(within(panel('Accent')).queryByRole('textbox')).toBeNull();
  });

  it('a pick is saved in the display config and applies at once', async () => {
    const user = userEvent.setup();
    render(<Harness initialConfig={baseConfig()} />);
    await user.click(screen.getByRole('radio', { name: 'Cyan' }));
    expect(window.__config.accent).toBe('cyan');
    expect(screen.getByRole('radio', { name: 'Cyan' })).toHaveAttribute('aria-checked', 'true');
  });

  it('draws each swatch as a root of that accent, in the theme around it', () => {
    const { container } = render(<Harness initialConfig={baseConfig()} />);
    const swatches = [...container.querySelectorAll('[data-slot="accent-choice"] .jh-ui')];
    expect(swatches.map((s) => s.getAttribute('data-accent'))).toEqual([null, 'fuchsia', 'cyan']);
    for (const s of swatches) expect(s).toHaveClass('bg-accent');
  });

  it('says so when an old colour was mapped to the nearest, until dismissed', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialConfig={baseConfig({
          accent: 'fuchsia',
          accentNotice: { from: '#ec4899', to: 'fuchsia' },
        })}
      />
    );
    const accent = panel('Accent');
    expect(within(accent).getByText('Your accent is now Fuchsia')).toBeInTheDocument();
    expect(
      within(accent).getByText(
        'JagHelm no longer offers your own colour, #ec4899. Fuchsia is the nearest of the three.'
      )
    ).toBeInTheDocument();
    await user.click(within(accent).getByRole('button', { name: 'Dismiss' }));
    expect(within(accent).queryByText(/Your accent is now/)).toBeNull();
    expect(window.__config).not.toHaveProperty('accentNotice');
    expect(window.__config.accent).toBe('fuchsia');
  });

  it('picking another accent ends the notice too', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialConfig={baseConfig({
          accent: 'cyan',
          accentNotice: { from: '#22c55e', to: 'cyan' },
        })}
      />
    );
    await user.click(screen.getByRole('radio', { name: 'Violet (default)' }));
    expect(window.__config.accent).toBe('violet');
    expect(window.__config).not.toHaveProperty('accentNotice');
    expect(screen.queryByText(/Your accent is now/)).toBeNull();
  });
});

describe('the density', () => {
  it('is comfortable or compact, saved in the display config', async () => {
    const user = userEvent.setup();
    render(<Harness initialConfig={baseConfig()} />);
    const group = screen.getByRole('radiogroup', { name: 'Density' });
    expect(within(group).getByRole('radio', { name: 'Comfortable' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await user.click(within(group).getByRole('radio', { name: 'Compact' }));
    expect(window.__config.density).toBe('compact');
  });
});

describe('the font family (#660)', () => {
  it('lists exactly the registry’s faces in its order, each in its own face, and no font-size sliders', () => {
    render(<Harness initialConfig={baseConfig({ fontSizes: { sectionTitle: 20 } })} />);
    const font = panel('Font family');
    const group = within(font).getByRole('radiogroup', { name: 'Font family' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.textContent.replace('Aa', '').replace('The default', ''))).toEqual(
      TYPEFACES.map((t) => t.label)
    );
    radios.forEach((radio, i) => {
      expect(radio.style.fontFamily).toContain(TYPEFACES[i].family);
      expect(radio).toHaveTextContent('Aa');
    });
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    expect(radios[0]).toHaveAccessibleDescription('The default');
    expect(within(font).queryByRole('slider')).toBeNull();
    expect(screen.queryByText('Font Sizes')).toBeNull();
  });

  it('saves the pick as typeface, and the radios work from the keyboard', async () => {
    const user = userEvent.setup();
    render(<Harness initialConfig={baseConfig()} />);
    const group = within(panel('Font family')).getByRole('radiogroup', { name: 'Font family' });
    await user.click(within(group).getByRole('radio', { name: 'Montserrat' }));
    expect(window.__config.typeface).toBe('montserrat');
    expect(within(group).getByRole('radio', { name: 'Montserrat' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    // Keyboard: focus the checked radio, arrow back to the previous face.
    within(group).getByRole('radio', { name: 'Montserrat' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(window.__config.typeface).toBe('plus-jakarta-sans');
  });

  it('an old fontFamily shows Manrope picked, and is left in the config untouched', () => {
    render(<Harness initialConfig={baseConfig({ fontFamily: 'rounded' })} />);
    const group = within(panel('Font family')).getByRole('radiogroup', { name: 'Font family' });
    expect(within(group).getByRole('radio', { name: 'Manrope' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(window.__config.fontFamily).toBe('rounded');
    expect(window.__config.typeface).toBeUndefined();
  });

  it('an unknown typeface shows the default picked', () => {
    render(<Harness initialConfig={baseConfig({ typeface: 'comic-sans' })} />);
    const group = within(panel('Font family')).getByRole('radiogroup', { name: 'Font family' });
    expect(within(group).getByRole('radio', { name: 'Manrope' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });
});

// General's before #317: the title, subtitle and logo. The welcome message is
// gone: nothing has drawn it since the old header (spec §15).
describe('the branding', () => {
  it('has the name, subtitle and logo, JagHelm’s own by default, and no welcome message', async () => {
    const user = userEvent.setup();
    render(<Harness initialConfig={baseConfig({ welcomeMessage: { enabled: true } })} />);
    const branding = panel('Branding');
    const name = within(branding).getByLabelText('Instance name');
    expect(name).toHaveValue('JAGHELM');
    await user.clear(name);
    await user.type(name, 'Home');
    expect(window.__config.title).toBe('Home');
    expect(within(branding).getByLabelText('Subtitle')).toHaveAttribute(
      'placeholder',
      'Infrastructure Dashboard'
    );
    const logo = within(branding).getByRole('group', { name: 'Logo' });
    expect(within(logo).getByRole('img', { name: 'Logo' })).toHaveAttribute('src', '/logo.svg');
    expect(within(logo).getByRole('button', { name: 'Upload New' })).toBeInTheDocument();
    expect(within(logo).queryByRole('button', { name: 'Restore Default' })).toBeNull();
    expect(screen.queryByText(/Welcome/)).toBeNull();
  });

  it('a custom logo can go back to JagHelm’s', async () => {
    const user = userEvent.setup();
    render(<Harness initialConfig={baseConfig({ logoUrl: '/uploads/mine.png' })} />);
    const logo = screen.getByRole('group', { name: 'Logo' });
    expect(within(logo).getByRole('img', { name: 'Logo' })).toHaveAttribute(
      'src',
      '/uploads/mine.png'
    );
    await user.click(within(logo).getByRole('button', { name: 'Restore Default' }));
    expect(window.__config.logoUrl).toBe('');
  });
});

// The cards' blur draws only over a background image, so it sits with it
// (Layout's Visual card before #317), and the dot grid (Effects).
describe('the background', () => {
  it('has the image, its opacity, the overlay, the cards’ blur and the dot grid', async () => {
    const user = userEvent.setup();
    render(<Harness initialConfig={baseConfig()} />);
    const bg = panel('Background');
    expect(within(bg).getByRole('button', { name: 'Upload Image' })).toBeInTheDocument();
    expect(within(bg).getByRole('slider', { name: 'Image opacity: 30%' })).toHaveValue('0.3');
    const overlay = within(bg).getByRole('slider', { name: 'Overlay opacity: 75%' });
    fireEvent.change(overlay, { target: { value: '0.5' } });
    expect(window.__config.overlayOpacity).toBe(0.5);
    await user.click(
      within(within(bg).getByRole('radiogroup', { name: 'Card blur' })).getByRole('radio', {
        name: 'Medium',
      })
    );
    expect(window.__config.cardBlur).toBe('md');
    const dots = within(bg).getByRole('switch', { name: 'Dot grid' });
    expect(dots).toBeChecked();
    await user.click(dots);
    expect(window.__config.showDots).toBe(false);
  });
});

// #307: a show/hide switch per Overview section, saved in the display config
// (the server's), so it holds on every device.
describe('the Overview sections (#307)', () => {
  it('has a switch per section, every one on by default, the attention panel locked on', () => {
    render(<Harness initialConfig={baseConfig()} />);
    const sections = panel('Overview sections');
    const named = (name) => within(sections).getByRole('switch', { name });
    const all = [
      'Needs attention',
      'Subsystem strip',
      'Infrastructure',
      'Power',
      'Jobs',
      'Services',
      'Pending host steps',
      'Expiry',
      'Utilities rail',
    ];
    expect(within(sections).getAllByRole('switch')).toEqual(all.map(named));
    for (const name of all.slice(1)) {
      expect(named(name)).toBeChecked();
      expect(named(name)).toBeEnabled();
    }
    expect(named('Needs attention')).toBeChecked();
    expect(named('Needs attention')).toHaveAttribute('aria-disabled', 'true');
    expect(named('Needs attention')).toHaveAccessibleDescription(
      'Always shown when something is wrong; one quiet line when all is well'
    );
  });

  it('switching one off saves it in the display config, and on again', async () => {
    const user = userEvent.setup();
    render(<Harness initialConfig={baseConfig({ overviewSections: { strip: false } })} />);
    const sections = panel('Overview sections');
    const strip = within(sections).getByRole('switch', { name: 'Subsystem strip' });
    expect(strip).not.toBeChecked();
    await user.click(within(sections).getByRole('switch', { name: 'Services' }));
    expect(window.__config.overviewSections).toEqual({ strip: false, services: false });
    await user.click(strip);
    expect(window.__config.overviewSections).toEqual({ strip: true, services: false });
  });

  it('the attention panel stays on, even with a config that says otherwise', async () => {
    const user = userEvent.setup();
    render(<Harness initialConfig={baseConfig({ overviewSections: { attention: false } })} />);
    const box = screen.getByRole('switch', { name: 'Needs attention' });
    expect(box).toBeChecked();
    await user.click(box);
    expect(window.__config.overviewSections).toEqual({ attention: false });
  });
});

// #307: the weather and the clock (the Overview's rail and the Launch page),
// whose switches say where; the dead "Show checklist panel" switch is gone
// (the Checklist's own switch is a utility's). The web search's is Apps &
// links'.
describe('the widgets', () => {
  it('the weather and the clock say where they show, each on by default', () => {
    render(<Harness initialConfig={baseConfig()} />);
    const widgets = panel('Widgets');
    const weather = within(widgets).getByRole('switch', { name: 'Weather' });
    expect(weather).toBeChecked();
    expect(weather).toHaveAccessibleDescription(/On the Overview and the Launch page/);
    expect(within(widgets).getByRole('switch', { name: 'Clock' })).toBeChecked();
    expect(screen.queryByRole('switch', { name: /checklist panel/i })).toBeNull();
    expect(screen.queryByRole('switch', { name: /scheduled jobs/i })).toBeNull();
    expect(screen.queryByRole('switch', { name: /web search/i })).toBeNull();
  });

  it('switches the clock off and on', async () => {
    const user = userEvent.setup();
    render(<Harness initialConfig={baseConfig({ showClock: false })} />);
    const clock = screen.getByRole('switch', { name: 'Clock' });
    expect(clock).not.toBeChecked();
    await user.click(clock);
    expect(clock).toBeChecked();
    expect(window.__config.showClock).toBe(true);
  });

  it('the utilities: Quick Launch, Pipeline and the Checklist, and nothing else of the old panels', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Harness initialConfig={baseConfig({ sections: { pipeline: { visible: false } } })} />
    );
    const utilities = container.querySelector('#utilities');
    const box = (name) => within(utilities).getByRole('switch', { name });
    expect(within(utilities).getAllByRole('switch')).toEqual(
      ['Quick Launch', 'Pipeline', 'Checklist'].map(box)
    );
    expect(box('Quick Launch')).toBeChecked();
    expect(box('Pipeline')).not.toBeChecked();
    for (const gone of [/UPS/, 'Title', 'Icon', /Background Opacity/])
      expect(within(utilities).queryByText(gone)).toBeNull();
    await user.click(box('Pipeline'));
    expect(window.__config.sections.pipeline).toEqual({ visible: true });
    await user.click(box('Checklist'));
    expect(window.__config.sections.todos).toEqual({ visible: false });
  });

  it('one units setting, metric on a fresh install, saved as units (#322)', async () => {
    const user = userEvent.setup();
    render(<Harness initialConfig={{ ...baseConfig(), units: 'metric' }} />);
    expect(screen.getAllByRole('radiogroup', { name: 'Units' })).toHaveLength(1);
    expect(screen.getByRole('radio', { name: 'Metric (°C)' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Imperial (°F)' }));
    expect(window.__config.units).toBe('imperial');
    expect(window.__config.tempUnit).toBeUndefined();
  });

  it('an old tempUnit of F still shows as imperial', () => {
    render(<Harness initialConfig={{ ...baseConfig(), tempUnit: 'F' }} />);
    expect(screen.getByRole('radio', { name: 'Imperial (°F)' })).toBeChecked();
  });

  it('dates and times follow the browser until a locale is picked (#322)', async () => {
    const user = userEvent.setup();
    render(<Harness initialConfig={baseConfig()} />);
    const select = screen.getByRole('combobox', { name: 'Dates and times' });
    expect(select).toHaveTextContent('Browser default');
    await user.click(select);
    await user.click(await screen.findByRole('option', { name: 'English (UK)' }));
    expect(window.__config.locale).toBe('en-GB');
    await user.click(screen.getByRole('combobox', { name: 'Dates and times' }));
    await user.click(await screen.findByRole('option', { name: 'Browser default' }));
    expect(window.__config.locale).toBe('');
  });
});

// The weather's coordinates keep local DRAFT state (so a field can show a
// validation error without committing garbage). The drafts once seeded at
// mount and never re-synced, so an external whole-config replace (Backup →
// Import) or a reset left the inputs stale while every other part read the
// config live. An external change updates a field that is NOT focused, and
// never clobbers one that IS.
describe('the weather’s coordinates re-sync on an external config change', () => {
  it('updates the lat/lon inputs when config is replaced and the field is unfocused', () => {
    render(<Harness initialConfig={baseConfig()} />);
    const latInput = screen.getByLabelText('Latitude');
    const lonInput = screen.getByLabelText('Longitude');
    expect(latInput).toHaveValue('39.88');
    expect(lonInput).toHaveValue('-83.09');
    act(() => {
      window.__setConfig(baseConfig({ weatherLat: '51.5074', weatherLon: '-0.1278' }));
    });
    expect(latInput).toHaveValue('51.5074');
    expect(lonInput).toHaveValue('-0.1278');
  });

  it('does NOT clobber the latitude input while the user is editing it', () => {
    render(<Harness initialConfig={baseConfig()} />);
    const latInput = screen.getByLabelText('Latitude');
    fireEvent.focus(latInput);
    fireEvent.change(latInput, { target: { value: '12.3' } });
    expect(latInput).toHaveValue('12.3');
    act(() => {
      window.__setConfig(baseConfig({ weatherLat: '99.9' }));
    });
    expect(latInput).toHaveValue('12.3');
    fireEvent.blur(latInput);
    act(() => {
      window.__setConfig(baseConfig({ weatherLat: '45.0' }));
    });
    expect(latInput).toHaveValue('45.0');
  });

  it('shows an error for a value out of range, and does not save it', () => {
    render(<Harness initialConfig={baseConfig()} />);
    const latInput = screen.getByLabelText('Latitude');
    fireEvent.change(latInput, { target: { value: '120' } });
    expect(screen.getByText('Latitude must be between -90 and 90.')).toBeInTheDocument();
    expect(window.__config.weatherLat).toBe('39.88');
  });
});

// ---- Custom themes (#331) ----------------------------------------------------

describe('Custom themes', () => {
  const MIDNIGHT = {
    id: 'midnight',
    name: 'Midnight',
    base: 'dark',
    tokens: {
      bg: 'oklch(0.15 0.02 255)',
      sidebar: 'oklch(0.168 0.022 255)',
      'surface-1': 'oklch(0.195 0.024 255)',
      'surface-2': 'oklch(0.235 0.026 255)',
      'surface-3': 'oklch(0.285 0.028 255)',
      'text-1': 'oklch(0.975 0.006 255)',
      'text-2': 'oklch(0.78 0.02 255)',
      'text-3': 'oklch(0.68 0.02 255)',
    },
  };
  const DIM = {
    ...MIDNIGHT,
    id: 'dim',
    name: 'Dim',
    tokens: { ...MIDNIGHT.tokens, 'text-2': 'oklch(0.5 0.02 255)' },
  };
  const themes = () => panel('Custom themes');
  const choices = () => within(screen.getByRole('radiogroup', { name: 'Theme' }));

  it('with none: only dark, light and system, and the list says there are none', () => {
    render(<Harness initialConfig={baseConfig()} />);
    expect(
      choices()
        .getAllByRole('radio')
        .map((r) => r.textContent)
    ).toEqual([
      expect.stringContaining('Dark'),
      expect.stringContaining('Light'),
      expect.stringContaining('System'),
    ]);
    expect(within(themes()).getByText(/None yet/)).toBeInTheDocument();
    expect(within(themes()).queryByRole('region', { name: 'Rejected' })).toBeNull();
    expect(within(themes()).getByRole('button', { name: 'Import theme' })).toBeDisabled();
  });

  it('a theme that loads is a card of its own, previewed in its colours, and picking it calls setTheme', async () => {
    const user = userEvent.setup();
    const setTheme = vi.fn();
    render(<Harness initialConfig={baseConfig({ themes: [MIDNIGHT] })} setTheme={setTheme} />);
    const card = choices().getByRole('radio', { name: /Midnight/ });
    expect(card).toHaveTextContent('Custom, dark base');
    const preview = card.querySelector('.jh-ui');
    expect(preview.style.getPropertyValue('--jh-bg')).toBe('oklch(0.15 0.02 255)');
    await user.click(card);
    expect(setTheme).toHaveBeenCalledWith('custom:dark:midnight');
    const yours = within(within(themes()).getByRole('region', { name: 'Your themes' }));
    expect(yours.getByText('Midnight')).toBeInTheDocument();
  });

  it('a rejected theme is listed apart with why, never dropped, and can be removed', async () => {
    const user = userEvent.setup();
    render(<Harness initialConfig={baseConfig({ themes: [MIDNIGHT, DIM, { id: 'x' }] })} />);
    expect(choices().queryByRole('radio', { name: /Dim/ })).toBeNull();
    const rejected = within(within(themes()).getByRole('region', { name: 'Rejected' }));
    expect(rejected.getByText('Dim is rejected')).toBeInTheDocument();
    expect(rejected.getByText(/text-2 on surface-1: \d\.\d\d:1, needs 4\.5:1/)).toBeInTheDocument();
    expect(rejected.getByText('x is rejected')).toBeInTheDocument();
    await user.click(rejected.getByRole('button', { name: 'Remove Dim' }));
    expect(window.__config.themes.map((t) => t.id)).toEqual(['midnight', 'x']);
    expect(rejected.queryByText('Dim is rejected')).toBeNull();
    await user.click(within(themes()).getByRole('button', { name: 'Remove Midnight' }));
    expect(window.__config.themes).toEqual([{ id: 'x' }]);
  });

  it('a chosen theme that is rejected says so above the cards, and shows its base', () => {
    render(<Harness initialConfig={baseConfig({ themes: [DIM] })} theme="custom:dark:dim" />);
    const theme = panel('Theme');
    expect(within(theme).getByText('Dim is rejected, so Dark is showing')).toBeInTheDocument();
    expect(within(theme).getByText(/text-2 on surface-1/)).toBeInTheDocument();
  });

  it('pasted JSON is checked as it is typed: not JSON, rejected with the pairing, and ready', async () => {
    const user = userEvent.setup();
    render(<Harness initialConfig={baseConfig()} />);
    const box = within(themes()).getByRole('textbox', { name: /Theme JSON/ });
    const importButton = within(themes()).getByRole('button', { name: 'Import theme' });
    await user.click(box);
    await user.paste('{ nope');
    expect(within(themes()).getByText('That is not valid JSON')).toBeInTheDocument();
    expect(importButton).toBeDisabled();

    await user.clear(box);
    await user.paste(JSON.stringify(DIM));
    expect(within(themes()).getByText('Dim would be rejected')).toBeInTheDocument();
    expect(
      within(themes()).getByText(/text-2 on surface-1: \d\.\d\d:1, needs 4\.5:1/)
    ).toBeInTheDocument();
    expect(importButton).toBeDisabled();

    await user.clear(box);
    await user.paste(JSON.stringify(MIDNIGHT));
    expect(
      within(themes()).getByText(/Midnight: dark base, 8 colours\. Ready to import\./)
    ).toBeInTheDocument();
    expect(importButton).toBeEnabled();
  });

  it('importing adds the theme as written, clears the box, and offers it as a card', async () => {
    const user = userEvent.setup();
    render(<Harness initialConfig={baseConfig()} />);
    const box = within(themes()).getByRole('textbox', { name: /Theme JSON/ });
    await user.click(box);
    await user.paste(JSON.stringify(MIDNIGHT));
    await user.click(within(themes()).getByRole('button', { name: 'Import theme' }));
    expect(window.__config.themes).toEqual([MIDNIGHT]);
    expect(box).toHaveValue('');
    expect(choices().getByRole('radio', { name: /Midnight/ })).toBeInTheDocument();
  });

  it('importing a theme with an id already used replaces it, and says so', async () => {
    const user = userEvent.setup();
    render(<Harness initialConfig={baseConfig({ themes: [MIDNIGHT] })} />);
    const box = within(themes()).getByRole('textbox', { name: /Theme JSON/ });
    await user.click(box);
    await user.paste(JSON.stringify({ ...MIDNIGHT, name: 'Midnight II' }));
    expect(
      within(themes()).getByText(/It replaces the theme with the same id/)
    ).toBeInTheDocument();
    await user.click(within(themes()).getByRole('button', { name: 'Replace theme' }));
    expect(window.__config.themes.map((t) => t.name)).toEqual(['Midnight II']);
  });

  it('a hostile theme can be pasted but never imported', async () => {
    const user = userEvent.setup();
    render(<Harness initialConfig={baseConfig()} />);
    const box = within(themes()).getByRole('textbox', { name: /Theme JSON/ });
    await user.click(box);
    await user.paste(
      JSON.stringify({
        ...MIDNIGHT,
        tokens: { bg: 'red; } body { display: none }', 'text-1': 'url(//evil.example/a)' },
      })
    );
    expect(within(themes()).getByText(/bg is not a colour/)).toBeInTheDocument();
    expect(within(themes()).getByRole('button', { name: 'Import theme' })).toBeDisabled();
    expect(window.__config.themes).toBeUndefined();
  });

  it('a full list says so and imports nothing more', async () => {
    const user = userEvent.setup();
    const eight = Array.from({ length: 8 }, (_, i) => ({
      ...MIDNIGHT,
      id: `t${i}`,
      name: `T${i}`,
    }));
    render(<Harness initialConfig={baseConfig({ themes: eight })} />);
    const box = within(themes()).getByRole('textbox', { name: /Theme JSON/ });
    await user.click(box);
    await user.paste(JSON.stringify(MIDNIGHT));
    expect(within(themes()).getByText('JagHelm keeps 8 themes')).toBeInTheDocument();
    expect(within(themes()).getByRole('button', { name: 'Import theme' })).toBeDisabled();
  });

  it('a file chosen is read into the box, checked like pasted text', async () => {
    const user = userEvent.setup();
    render(<Harness initialConfig={baseConfig()} />);
    const file = new File([JSON.stringify(MIDNIGHT)], 'midnight.json', {
      type: 'application/json',
    });
    await user.upload(within(themes()).getByLabelText('Theme file'), file);
    expect(await within(themes()).findByText(/Ready to import/)).toBeInTheDocument();
    const big = new File(['x'.repeat(70 * 1024)], 'big.json', { type: 'application/json' });
    await user.upload(within(themes()).getByLabelText('Theme file'), big);
    expect(await within(themes()).findByText(/too large for a theme/)).toBeInTheDocument();
  });

  it('a theme that sets its own accent leaves the Accent panel nothing to change, and says so', () => {
    const own = {
      ...MIDNIGHT,
      tokens: {
        ...MIDNIGHT.tokens,
        accent: 'oklch(0.55 0.2 330)',
        'accent-hover': 'oklch(0.5 0.2 330)',
        'accent-text': 'oklch(0.8 0.12 330)',
        'accent-tint': 'oklch(0.55 0.2 330 / 0.16)',
        'accent-border': 'oklch(0.6 0.2 330 / 0.38)',
        'focus-ring': 'oklch(0.64 0.2 330)',
        'row-hover': 'oklch(0.55 0.2 330 / 0.07)',
        meter: 'oklch(0.7 0.16 330)',
      },
    };
    render(<Harness initialConfig={baseConfig({ themes: [own] })} theme="custom:dark:midnight" />);
    const accent = panel('Accent');
    expect(within(accent).getByText('Midnight sets its own accent')).toBeInTheDocument();
    for (const radio of within(accent).getAllByRole('radio')) {
      expect(radio).toHaveAttribute('data-disabled');
    }
  });

  it('the accent choice is live for a theme that leaves it alone', () => {
    render(
      <Harness initialConfig={baseConfig({ themes: [MIDNIGHT] })} theme="custom:dark:midnight" />
    );
    const accent = panel('Accent');
    expect(within(accent).queryByText(/sets its own accent/)).toBeNull();
    for (const radio of within(accent).getAllByRole('radio')) {
      expect(radio).not.toHaveAttribute('data-disabled');
    }
  });
  it('Clear empties the box and the verdict with it', async () => {
    const user = userEvent.setup();
    render(<Harness initialConfig={baseConfig()} />);
    const box = within(themes()).getByRole('textbox', { name: /Theme JSON/ });
    expect(within(themes()).queryByRole('button', { name: 'Clear' })).toBeNull();
    await user.click(box);
    await user.paste(JSON.stringify(MIDNIGHT));
    expect(within(themes()).getByText(/Ready to import/)).toBeInTheDocument();
    await user.click(within(themes()).getByRole('button', { name: 'Clear' }));
    expect(box).toHaveValue('');
    expect(within(themes()).queryByText(/Ready to import/)).toBeNull();
    expect(within(themes()).getByRole('button', { name: 'Import theme' })).toBeDisabled();
    expect(within(themes()).queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('the verdict describes the box, and is announced once it settles, not on every keystroke', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness initialConfig={baseConfig()} />);
    const box = within(themes()).getByRole('textbox', { name: /Theme JSON/ });
    const live = within(themes()).getByRole('status');
    await user.click(box);
    await user.paste(JSON.stringify(DIM));
    expect(box).toHaveAccessibleDescription(/Dim would be rejected/);
    // Typing on: nothing is said until it settles, then once.
    expect(live).toHaveTextContent('');
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(live).toHaveTextContent(/^Dim would be rejected: text-2 on bg/);
    const said = live.textContent;
    await user.type(box, ' ');
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(live.textContent).toBe(said);
    vi.useRealTimers();
  });

  it('an import starts from the server’s copy: it reads it again first and adds to what it holds', async () => {
    const user = userEvent.setup();
    const OTHER = { ...MIDNIGHT, id: 'other', name: 'Other' };
    const refresh = vi.fn(async () => {
      window.__setConfig((prev) => ({ ...prev, themes: [OTHER] }));
    });
    render(<Harness initialConfig={baseConfig()} refresh={refresh} />);
    const box = within(themes()).getByRole('textbox', { name: /Theme JSON/ });
    await user.click(box);
    await user.paste(JSON.stringify(MIDNIGHT));
    await user.click(within(themes()).getByRole('button', { name: 'Import theme' }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(window.__config.themes.map((t) => t.id)).toEqual(['other', 'midnight']);
  });

  it('a removal starts from the server’s copy too, and removes only what was shown', async () => {
    const user = userEvent.setup();
    const OTHER = { ...MIDNIGHT, id: 'other', name: 'Other' };
    const refresh = vi.fn(async () => {
      window.__setConfig((prev) => ({ ...prev, themes: [OTHER, ...prev.themes] }));
    });
    render(<Harness initialConfig={baseConfig({ themes: [MIDNIGHT] })} refresh={refresh} />);
    await user.click(within(themes()).getByRole('button', { name: 'Remove Midnight' }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(window.__config.themes.map((t) => t.id)).toEqual(['other']);
  });

  it('an unreadable server copy does not stop the edit', async () => {
    const user = userEvent.setup();
    const refresh = vi.fn(async () => {
      throw new Error('offline');
    });
    render(<Harness initialConfig={baseConfig({ themes: [MIDNIGHT] })} refresh={refresh} />);
    await user.click(within(themes()).getByRole('button', { name: 'Remove Midnight' }));
    expect(window.__config.themes).toEqual([]);
  });
});
