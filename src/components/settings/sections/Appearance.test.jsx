import { render, screen, fireEvent, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import Appearance from './Appearance.jsx';
import { ConfigProvider } from '../../../context/ConfigContext.jsx';
import { OverlayProvider } from '../../../context/OverlayContext.jsx';

// Settings → Appearance (#317): what was General, Typography and Appearance,
// the temperature unit, the utilities' switches and the weather and clock,
// moved as they were. The theme and the Overview sections have their own
// tests (AppearanceTab.test.jsx).

// Controlled wrapper so a test can swap the config from "outside" the
// section; `window.__config` is the latest.
function Harness({ initialConfig }) {
  const [config, setConfigState] = useState(initialConfig);
  const setConfig = (updater) => {
    setConfigState((prev) => (typeof updater === 'function' ? updater(prev) : updater));
  };
  window.__setConfig = setConfig;
  window.__config = config;
  return (
    <OverlayProvider>
      <ConfigProvider config={config} setConfig={setConfig}>
        <Appearance theme="dark" setTheme={vi.fn()} />
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

const card = (title) => screen.getByRole('heading', { name: title }).closest('.settings-card');

// The weather card keeps local DRAFT state for the lat/lon coordinate inputs
// (so it can show a validation error without committing garbage). The bug: the
// drafts seeded once at mount and never re-synced, so an external whole-config
// replace (Backup → Import) or reset left the inputs showing stale values
// while every other card read config live. These tests lock in the re-sync: an
// external config change updates the input value when the field is NOT
// focused, and does NOT clobber the user's input while the field IS focused.
describe('the weather card’s coordinate drafts re-sync on an external config change', () => {
  it('updates the lat/lon inputs when config is replaced and the field is unfocused', () => {
    render(<Harness initialConfig={baseConfig()} />);

    const latInput = screen.getByPlaceholderText('39.88');
    const lonInput = screen.getByPlaceholderText('-83.09');
    expect(latInput).toHaveValue('39.88');
    expect(lonInput).toHaveValue('-83.09');

    // Simulate a Backup → Import whole-config replace from outside the card.
    act(() => {
      window.__setConfig(baseConfig({ weatherLat: '51.5074', weatherLon: '-0.1278' }));
    });

    // Drafts re-sync to the new persisted values (the bug left them stale).
    expect(latInput).toHaveValue('51.5074');
    expect(lonInput).toHaveValue('-0.1278');
  });

  it('does NOT clobber the latitude input while the user is editing it', () => {
    render(<Harness initialConfig={baseConfig()} />);
    const latInput = screen.getByPlaceholderText('39.88');

    // User focuses and types a partial value.
    fireEvent.focus(latInput);
    fireEvent.change(latInput, { target: { value: '12.3' } });
    expect(latInput).toHaveValue('12.3');

    // An external config change arrives mid-edit; the focused field must keep
    // the user's in-progress draft rather than snapping to the new config.
    act(() => {
      window.__setConfig(baseConfig({ weatherLat: '99.9' }));
    });
    expect(latInput).toHaveValue('12.3');

    // After blur, a subsequent external change re-syncs normally.
    fireEvent.blur(latInput);
    act(() => {
      window.__setConfig(baseConfig({ weatherLat: '45.0' }));
    });
    expect(latInput).toHaveValue('45.0');
  });
});

// #307: the weather and the clock are back (the Overview's rail and the
// Launch page), so their switches say where; the dead "Show checklist panel"
// switch is gone (it never hid the Checklist, whose own switch is the
// Utilities card's). The web search's switch is Apps & links'.
describe('the weather and the clock (#307)', () => {
  it('says where each shows, each on by default', () => {
    render(<Harness initialConfig={baseConfig()} />);
    expect(
      screen.getByRole('checkbox', { name: 'Show the weather on the Overview and the Launch page' })
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Show the clock on the Overview and the Launch page' })
    ).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /checklist panel/i })).toBeNull();
    // The old board's scheduled jobs panel went with it (#306): the Jobs
    // section's switch is in Overview sections.
    expect(screen.queryByRole('checkbox', { name: /scheduled jobs/i })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /web search/i })).toBeNull();
  });

  it('switches the clock off and on', () => {
    render(<Harness initialConfig={baseConfig({ showClock: false })} />);
    const clock = screen.getByRole('checkbox', { name: /^Show the clock/ });
    expect(clock).not.toBeChecked();
    fireEvent.click(clock);
    expect(clock).toBeChecked();
  });
});

// One temperature unit (Layout and Widgets each had the same switch): the
// nodes' temperatures and the weather.
describe('the temperature unit', () => {
  it('is one switch, saved as tempUnit', async () => {
    const user = userEvent.setup();
    render(<Harness initialConfig={baseConfig()} />);
    expect(screen.getAllByRole('group', { name: 'Temperature Unit' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '°C' }));
    expect(window.__config.tempUnit).toBe('C');
  });
});

// #306: the old board's panels had a title, subtitle, icon and colours; the new
// sections have none. What stays is the utilities' switches, which the rail
// reads; the UPS's is the Power section's, in Overview sections.
describe('the utilities (Sections’ before #317)', () => {
  it('has a switch for Quick Launch, Pipeline and the Checklist, and nothing else of the old panels', async () => {
    const user = userEvent.setup();
    render(<Harness initialConfig={baseConfig({ sections: { pipeline: { visible: false } } })} />);
    const utilities = card('Utilities');
    const box = (name) => within(utilities).getByRole('checkbox', { name });
    expect(within(utilities).getAllByRole('checkbox')).toEqual(
      ['Quick Launch', 'Pipeline', 'Checklist'].map(box)
    );
    expect(box('Quick Launch')).toBeChecked();
    expect(box('Pipeline')).not.toBeChecked();
    for (const gone of [/UPS/, 'Title', 'Subtitle', 'Icon', /Background Opacity/])
      expect(within(utilities).queryByText(gone)).toBeNull();
    await user.click(box('Pipeline'));
    expect(window.__config.sections.pipeline).toEqual({ visible: true });
    await user.click(box('Checklist'));
    expect(window.__config.sections.todos).toEqual({ visible: false });
  });
});

// General's before #317: the title, subtitle and logo. The welcome message is
// gone: nothing has drawn it since the old header (spec §15).
describe('the branding (General’s before #317)', () => {
  it('has the title, subtitle and logo, and no welcome message', () => {
    render(<Harness initialConfig={baseConfig({ welcomeMessage: { enabled: true } })} />);
    expect(screen.getByPlaceholderText('JAGHELM')).toHaveValue('JAGHELM');
    expect(within(card('Branding')).getByText('Subtitle')).toBeInTheDocument();
    expect(within(card('Logo')).getByRole('button', { name: 'Upload New' })).toBeInTheDocument();
    expect(screen.queryByText(/Welcome/)).toBeNull();
  });
});

// The cards' blur draws only over a background image, so it sits with it
// (Layout's Visual card before #317).
describe('the background', () => {
  it('has the image, its opacity, the overlay and the cards’ blur', async () => {
    const user = userEvent.setup();
    render(<Harness initialConfig={baseConfig()} />);
    const bg = card('Background');
    expect(within(bg).getByRole('button', { name: 'Upload Image' })).toBeInTheDocument();
    expect(within(bg).getByText(/Image Opacity/)).toBeInTheDocument();
    expect(within(bg).getByText(/Overlay Opacity/)).toBeInTheDocument();
    await user.click(within(bg).getByRole('button', { name: 'md' }));
    expect(window.__config.cardBlur).toBe('md');
  });
});
