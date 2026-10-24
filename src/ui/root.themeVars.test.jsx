import { useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { Button } from '@ui/button';
import { Dialog } from '@ui/dialog';
import { Select } from '@ui/select';
import { UiRoot } from '@ui/root';
import { portalRootProps } from './lib/portal.js';

// A custom theme (#331) is colours, not an attribute: UiRoot sets them as
// custom properties on its style and gives them to everything it portals, as it
// does its switches, so a dialog or a list open over a themed screen is themed.

const VARS = { '--jh-bg': 'oklch(0.15 0.02 255)', '--jh-text-1': '#f8f8fa' };

describe('themeVars', () => {
  it('are set as custom properties on the root’s style, beside any style it was given', () => {
    render(
      <UiRoot data-testid="root" themeVars={VARS} style={{ minHeight: 10 }}>
        <span />
      </UiRoot>
    );
    const root = screen.getByTestId('root');
    expect(root.style.getPropertyValue('--jh-bg')).toBe('oklch(0.15 0.02 255)');
    expect(root.style.getPropertyValue('--jh-text-1')).toBe('#f8f8fa');
    expect(root.style.minHeight).toBe('10px');
    expect(root.getAttributeNames().sort()).toEqual(['class', 'data-slot', 'data-testid', 'style']);
  });

  it('set nothing without a theme', () => {
    render(<UiRoot data-testid="root" />);
    expect(screen.getByTestId('root')).not.toHaveAttribute('style');
  });

  it('reach a dialog’s portal root, and follow a change while it is open', async () => {
    const user = userEvent.setup();
    let setVars;
    function Screen() {
      const [vars, set] = useState(VARS);
      setVars = set;
      return (
        <UiRoot themeVars={vars}>
          <Dialog trigger={<Button>Rename</Button>} title="Rename" />
        </UiRoot>
      );
    }
    render(<Screen />);
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename' });
    expect(dialog.closest('.jh-ui').style.getPropertyValue('--jh-bg')).toBe('oklch(0.15 0.02 255)');
    act(() => setVars({ '--jh-bg': '#101018' }));
    expect(dialog.closest('.jh-ui').style.getPropertyValue('--jh-bg')).toBe('#101018');
    expect(dialog.closest('.jh-ui').style.getPropertyValue('--jh-text-1')).toBe('');
    act(() => setVars(undefined));
    expect(dialog.closest('.jh-ui').style.length).toBe(0);
  });

  it('reach a Select’s list opened inside a dialog', async () => {
    const user = userEvent.setup();
    render(
      <UiRoot themeVars={VARS}>
        <Dialog defaultOpen title="Edit">
          <Select
            aria-label="Interval"
            defaultValue="30"
            items={[
              { value: '30', label: 'Every 30 s' },
              { value: '60', label: 'Every 60 s' },
            ]}
          />
        </Dialog>
      </UiRoot>
    );
    await user.click(screen.getByRole('combobox', { name: 'Interval' }));
    const list = await screen.findByRole('listbox');
    expect(list.closest('.jh-ui').style.getPropertyValue('--jh-bg')).toBe('oklch(0.15 0.02 255)');
  });

  it('a control in a bare root hands its portal the root’s theme properties, and only those', () => {
    const root = document.createElement('div');
    root.className = 'jh-ui';
    root.style.setProperty('--jh-bg', '#101018');
    root.style.setProperty('--other', 'x');
    root.style.minHeight = '3px';
    const anchor = document.createElement('button');
    root.append(anchor);
    expect(portalRootProps(anchor).style).toEqual({ '--jh-bg': '#101018' });
    expect(portalRootProps(document.createElement('button')).style).toBeUndefined();
  });
});
