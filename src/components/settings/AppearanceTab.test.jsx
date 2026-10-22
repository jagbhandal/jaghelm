import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AppearanceTab from './AppearanceTab.jsx';
import { ConfigProvider } from '../../context/ConfigContext.jsx';

const renderTab = (theme = 'dark', setTheme = vi.fn()) => {
  render(
    <ConfigProvider config={{}} setConfig={vi.fn()}>
      <AppearanceTab theme={theme} setTheme={setTheme} />
    </ConfigProvider>
  );
  return setTheme;
};

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
