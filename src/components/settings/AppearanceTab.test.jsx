import { render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AppearanceTab from './AppearanceTab.jsx';
import { ConfigProvider } from '../../context/ConfigContext.jsx';

const renderTab = (theme = 'dark', setTheme = vi.fn(), config = {}) => {
  render(<Harness config={config} theme={theme} setTheme={setTheme} />);
  return setTheme;
};

// The tab over a config it can change, as App holds it; `window.__config` is the latest.
function Harness({ config: initial, theme, setTheme }) {
  const [config, setConfig] = useState(initial);
  window.__config = config;
  return (
    <ConfigProvider config={config} setConfig={setConfig}>
      <AppearanceTab theme={theme} setTheme={setTheme} />
    </ConfigProvider>
  );
}

describe('Settings → Appearance, Theme (#304)', () => {
  it('offers Dark, Light and System as one choice, the current one checked', () => {
    renderTab('system');
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    const options = within(group).getAllByRole('radio');
    expect(options).toEqual([
      within(group).getByRole('radio', { name: 'Dark' }),
      within(group).getByRole('radio', { name: 'Light' }),
      within(group).getByRole('radio', { name: 'System' }),
    ]);
    expect(options.map((o) => o.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
    expect(options[2]).toHaveAccessibleDescription('Follows the device');
  });

  it('switches the theme', async () => {
    const user = userEvent.setup();
    const setTheme = renderTab('dark');
    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(setTheme).toHaveBeenLastCalledWith('light');
    await user.click(screen.getByRole('radio', { name: 'System' }));
    expect(setTheme).toHaveBeenLastCalledWith('system');
  });

  it('has no accent colour picker: one accent, violet, until #321 offers three', () => {
    renderTab();
    expect(screen.queryByRole('heading', { name: /accent/i })).toBeNull();
    expect(screen.queryByText('Click swatch to change')).toBeNull();
  });
});

// #307: a show/hide switch per Overview section, saved in the display config
// (the server's), so it holds on every device.
describe('Settings → Appearance, Overview sections (#307)', () => {
  const card = () => screen.getByRole('heading', { name: 'Overview sections' }).parentElement;

  it('has a switch per section, every one on by default, the attention panel locked on', () => {
    renderTab();
    const named = (name) => within(card()).getByRole('checkbox', { name });
    expect(within(card()).getAllByRole('checkbox')).toEqual(
      [
        'Needs attention',
        'Subsystem strip',
        'Infrastructure',
        'Jobs',
        'Services',
        'Utilities rail',
      ].map(named)
    );
    for (const name of [
      'Subsystem strip',
      'Infrastructure',
      'Jobs',
      'Services',
      'Utilities rail',
    ]) {
      expect(named(name)).toBeChecked();
      expect(named(name)).toBeEnabled();
    }
    expect(named('Needs attention')).toBeChecked();
    expect(named('Needs attention')).toBeDisabled();
    expect(named('Needs attention')).toHaveAccessibleDescription(
      'Always shown when something is wrong; one quiet line when all is well'
    );
  });

  it('switching one off saves it in the display config, and on again', async () => {
    const user = userEvent.setup();
    renderTab('dark', vi.fn(), { overviewSections: { strip: false } });
    const strip = within(card()).getByRole('checkbox', { name: 'Subsystem strip' });
    expect(strip).not.toBeChecked();
    await user.click(within(card()).getByRole('checkbox', { name: 'Services' }));
    expect(window.__config.overviewSections).toEqual({ strip: false, services: false });
    await user.click(strip);
    expect(window.__config.overviewSections).toEqual({ strip: true, services: false });
  });

  it('the attention panel stays on, even with a config that says otherwise', async () => {
    const user = userEvent.setup();
    renderTab('dark', vi.fn(), { overviewSections: { attention: false } });
    const box = within(card()).getByRole('checkbox', { name: 'Needs attention' });
    expect(box).toBeChecked();
    await user.click(box);
    expect(window.__config.overviewSections).toEqual({ attention: false });
  });
});
