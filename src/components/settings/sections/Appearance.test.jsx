import { render, screen, fireEvent, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import Appearance from './Appearance.jsx';
import { ConfigProvider } from '../../../context/ConfigContext.jsx';
import { OverlayProvider } from '../../../context/OverlayContext.jsx';
import { ACCENTS } from '../../../ui/accents.js';

// Settings → Appearance (#321): theme, accent, density, font, branding, the
// background, the Overview's sections and the widgets, rebuilt in the design
// system, every setting it had kept (SettingsView.index.test.jsx walks them
// all), each change applied as it is made.

// Over a config held as App holds it, which a test can swap from "outside"
// the section; `window.__config` is the latest.
function Harness({ initialConfig, theme = 'dark', setTheme = vi.fn() }) {
  const [config, setConfigState] = useState(initialConfig);
  const setConfig = (updater) => {
    setConfigState((prev) => (typeof updater === 'function' ? updater(prev) : updater));
  };
  window.__setConfig = setConfig;
  window.__config = config;
  return (
    <OverlayProvider>
      <ConfigProvider config={config} setConfig={setConfig}>
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
      'temperature',
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
        initialConfig={baseConfig({ accent: 'cyan', accentNotice: { from: '#22c55e', to: 'cyan' } })}
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

describe('the font family (Typography’s before #317)', () => {
  it('has the presets, each drawn in its face, and no font-size sliders', async () => {
    const user = userEvent.setup();
    render(<Harness initialConfig={baseConfig({ fontSizes: { sectionTitle: 20 } })} />);
    const font = panel('Font family');
    const group = within(font).getByRole('radiogroup', { name: 'Font family' });
    expect(within(group).getAllByRole('radio').map((r) => r.getAttribute('aria-labelledby')))
      .toHaveLength(5);
    const def = within(group).getByRole('radio', { name: 'Default' });
    expect(def).toHaveAttribute('aria-checked', 'true');
    expect(def).toHaveAccessibleDescription('Manrope + JetBrains Mono');
    expect(def.style.fontFamily).toMatch(/Manrope Variable/);
    expect(within(font).queryByRole('slider')).toBeNull();
    expect(screen.queryByText('Font Sizes')).toBeNull();
    await user.click(within(group).getByRole('radio', { name: 'Rounded' }));
    expect(window.__config.fontFamily).toBe('rounded');
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

  it('one temperature unit, saved as tempUnit', async () => {
    const user = userEvent.setup();
    render(<Harness initialConfig={baseConfig()} />);
    expect(screen.getAllByRole('radiogroup', { name: 'Temperature unit' })).toHaveLength(1);
    await user.click(screen.getByRole('radio', { name: '°C' }));
    expect(window.__config.tempUnit).toBe('C');
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
