import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { Button } from '@ui/button';
import { Dialog } from '@ui/dialog';
import { UiRoot } from '@ui/root';
import { useToast } from '@ui/toast';
import { ROOT_SWITCHES, SWITCHES, switchAttributes } from './lib/portal.js';

const viewport = () => document.querySelector('[data-slot="toast-viewport"]');

function Notify() {
  const toast = useToast();
  return <Button onClick={() => toast.add({ title: 'Saved' })}>Notify</Button>;
}

describe('UiRoot', () => {
  it('renders the .jh-ui root with the screen’s switches, setting none for a default', () => {
    render(
      <UiRoot
        theme="light"
        accent="cyan"
        density="compact"
        typeface="montserrat"
        data-testid="root"
      >
        <p>Overview</p>
      </UiRoot>
    );
    const root = screen.getByTestId('root');
    expect(root).toHaveClass('jh-ui');
    expect(root).toHaveAttribute('data-theme', 'light');
    expect(root).toHaveAttribute('data-accent', 'cyan');
    expect(root).toHaveAttribute('data-density', 'compact');
    expect(root).toHaveAttribute('data-typeface', 'montserrat');
    expect(root).toContainElement(screen.getByText('Overview'));
  });

  it('sets no attribute for the defaults, as tokens.css reads none as the default', () => {
    render(
      <UiRoot
        theme="dark"
        accent="violet"
        density="comfortable"
        typeface="manrope"
        data-testid="root"
      />
    );
    const root = screen.getByTestId('root');
    for (const name of ROOT_SWITCHES) expect(root).not.toHaveAttribute(name);
    expect(switchAttributes({})).toEqual({});
    expect(Object.values(SWITCHES).map((s) => s.attribute)).toEqual([...ROOT_SWITCHES]);
  });

  it('gives a toast, which has no anchor, the root’s light theme and compact density', async () => {
    const user = userEvent.setup();
    render(
      <UiRoot theme="light" density="compact" accent="fuchsia" data-testid="root">
        <Notify />
      </UiRoot>
    );
    await user.click(screen.getByRole('button', { name: 'Notify' }));
    const toast = await within(viewport()).findByRole('dialog', { name: 'Saved' });
    // Portalled out of the screen, into a root of its own with the same switches.
    expect(screen.getByTestId('root')).not.toContainElement(toast);
    const root = toast.closest('.jh-ui');
    expect(root).not.toBe(screen.getByTestId('root'));
    expect(root).toHaveAttribute('data-theme', 'light');
    expect(root).toHaveAttribute('data-density', 'compact');
    expect(root).toHaveAttribute('data-accent', 'fuchsia');
  });

  it('gives a dialog opened from code, with no trigger, the root’s switches', () => {
    render(
      <UiRoot theme="light" density="compact">
        <Dialog defaultOpen title="Edit node" />
      </UiRoot>
    );
    const root = screen.getByRole('dialog', { name: 'Edit node' }).closest('.jh-ui');
    expect(root).toHaveAttribute('data-theme', 'light');
    expect(root).toHaveAttribute('data-density', 'compact');
  });

  it('carries a switch change into overlays already open', async () => {
    const user = userEvent.setup();
    function Screen() {
      const [theme, setTheme] = useState('dark');
      return (
        <UiRoot theme={theme}>
          <Notify />
          <Button onClick={() => setTheme('light')}>Light</Button>
        </UiRoot>
      );
    }
    render(<Screen />);
    await user.click(screen.getByRole('button', { name: 'Notify' }));
    const toast = await within(viewport()).findByRole('dialog', { name: 'Saved' });
    expect(toast.closest('.jh-ui')).not.toHaveAttribute('data-theme');
    await user.click(screen.getByRole('button', { name: 'Light' }));
    await waitFor(() => expect(toast.closest('.jh-ui')).toHaveAttribute('data-theme', 'light'));
  });

  it('outside any root, an overlay falls back to a bare .jh-ui root: the defaults', () => {
    render(<Dialog defaultOpen title="Edit node" />);
    const root = screen.getByRole('dialog').closest('.jh-ui');
    expect(root).not.toBeNull();
    for (const name of ROOT_SWITCHES) expect(root).not.toHaveAttribute(name);
  });
});
