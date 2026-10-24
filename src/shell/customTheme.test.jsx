import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCustomTheme } from './customTheme.js';
import midnight from '../../docs/examples/midnight-theme.json';

// useCustomTheme (#331): the chosen custom theme once the validator has passed
// it, else null; and the choice kept honest against the config.

const BAD = { ...midnight, tokens: { ...midnight.tokens, 'text-2': 'oklch(0.5 0.02 255)' } };
const setup = (themes, theme = 'custom:dark:midnight', ready = true) => {
  const setTheme = vi.fn();
  const onGone = vi.fn();
  const hook = renderHook(
    ({ themes, theme, ready }) => useCustomTheme({ themes }, { theme, setTheme }, ready, onGone),
    { initialProps: { themes, theme, ready } }
  );
  return { ...hook, setTheme, onGone };
};

describe('useCustomTheme', () => {
  it('is null with a built-in theme chosen, and loads nothing', () => {
    const { result } = setup([midnight], 'dark');
    expect(result.current).toBeNull();
  });

  it('gives the theme’s base, its custom properties and whether it sets its own accent', async () => {
    const { result } = setup([midnight]);
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current.id).toBe('midnight');
    expect(result.current.base).toBe('dark');
    expect(result.current.setsAccent).toBe(false);
    expect(result.current.vars['--jh-surface-1']).toBe('oklch(0.195 0.024 255)');
    expect(Object.isFrozen(result.current.vars)).toBe(true);
  });

  it('is null for a theme that fails, and applies it once the config is fixed', async () => {
    const { result, rerender, setTheme } = setup([BAD]);
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current).toBeNull();
    expect(setTheme).not.toHaveBeenCalled(); // still chosen
    rerender({ themes: [midnight], theme: 'custom:dark:midnight', ready: true });
    await waitFor(() => expect(result.current?.id).toBe('midnight'));
  });

  it('is null for hostile values, whatever the list holds', async () => {
    const evil = { ...midnight, tokens: { bg: 'red; background: url(x)' } };
    const { result } = setup([evil, null, 'x', 5]);
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current).toBeNull();
  });

  it('puts the choice back to the theme’s base when the config says another', async () => {
    const { setTheme } = setup([midnight], 'custom:light:midnight');
    await waitFor(() => expect(setTheme).toHaveBeenCalledWith('custom:dark:midnight'));
  });

  it('goes back to the default for a theme the config does not have, only once the config is in', async () => {
    const early = setup([], 'custom:dark:gone', false);
    await new Promise((r) => setTimeout(r, 10));
    expect(early.setTheme).not.toHaveBeenCalled();
    early.rerender({ themes: [], theme: 'custom:dark:gone', ready: true });
    await waitFor(() => expect(early.setTheme).toHaveBeenCalledWith('dark'));
    // And says so, by the theme's id, once.
    expect(early.onGone).toHaveBeenCalledTimes(1);
    expect(early.onGone).toHaveBeenCalledWith('gone');
  });

  it('says nothing for a theme that is there', async () => {
    const { result, onGone } = setup([midnight]);
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(onGone).not.toHaveBeenCalled();
  });
});
