import { useState } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { Button } from '@ui/button';
import { Confirm } from '@ui/confirm';
import { Dialog } from '@ui/dialog';
import { Drawer } from '@ui/drawer';
import { UiRoot } from '@ui/root';
import { Select } from '@ui/select';
import { createToastManager, useToast } from '@ui/toast';
import { ROOT_SWITCHES, SWITCHES, switchAttributes } from './lib/portal.js';

const viewport = () => document.querySelector('[data-slot="toast-viewport"]');
const viewports = () => document.querySelectorAll('[data-slot="toast-viewport"]');
const themeOf = (el) => el.closest('.jh-ui').getAttribute('data-theme') ?? 'dark';

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

  it('carries a switch change into an overlay open inside another: a Select’s list in a Dialog', async () => {
    const user = userEvent.setup();
    let setTheme;
    function Screen() {
      const [theme, set] = useState('dark');
      setTheme = set;
      return (
        <UiRoot theme={theme}>
          <Dialog defaultOpen title="Edit monitor">
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
    }
    render(<Screen />);
    await user.click(screen.getByRole('combobox', { name: 'Interval' }));
    const list = await screen.findByRole('listbox');
    const dialog = screen.getByRole('dialog', { name: 'Edit monitor', hidden: true });
    expect([themeOf(dialog), themeOf(list)]).toEqual(['dark', 'dark']);
    // The list's anchor sits in the dialog's portal root, which takes the
    // change no sooner than the list does: both read the UiRoot.
    act(() => setTheme('light'));
    expect([themeOf(dialog), themeOf(list)]).toEqual(['light', 'light']);
    act(() => setTheme('dark'));
    expect([themeOf(dialog), themeOf(list)]).toEqual(['dark', 'dark']);
  });

  it('carries a switch change into a Confirm open from a Drawer', async () => {
    const user = userEvent.setup();
    let setDensity;
    function Screen() {
      const [density, set] = useState('comfortable');
      setDensity = set;
      return (
        <UiRoot density={density}>
          <Drawer defaultOpen title="Pixel 8">
            <Confirm
              trigger={<Button>Remove…</Button>}
              title="Remove this device?"
              name="Pixel 8"
            />
          </Drawer>
        </UiRoot>
      );
    }
    render(<Screen />);
    await user.click(screen.getByRole('button', { name: 'Remove…' }));
    const confirm = await screen.findByRole('alertdialog');
    act(() => setDensity('compact'));
    expect(confirm.closest('.jh-ui')).toHaveAttribute('data-density', 'compact');
  });

  it('roots nest in any theme: an overlay takes the nearest root’s switches', async () => {
    const user = userEvent.setup();
    render(
      <UiRoot>
        <UiRoot theme="light" data-testid="light">
          <Dialog trigger={<Button>Rename</Button>} title="Rename" />
        </UiRoot>
      </UiRoot>
    );
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    expect(themeOf(await screen.findByRole('dialog'))).toBe('light');
  });

  it('a page has one toast viewport, however many roots it holds, and shows a toast once', async () => {
    const user = userEvent.setup();
    const shared = createToastManager();
    render(
      <>
        <UiRoot data-testid="page">
          <UiRoot theme="light" density="compact">
            <Notify />
          </UiRoot>
          <UiRoot theme="light" toastManager={shared} />
        </UiRoot>
        <UiRoot theme="light">
          <Button>Beside</Button>
        </UiRoot>
        <UiRoot toastManager={shared} />
      </>
    );
    // One "Notifications" landmark (axe's landmark-unique), in the page
    // root's switches: the outermost, first root owns it.
    expect(viewports()).toHaveLength(1);
    expect(screen.getAllByRole('region', { name: 'Notifications' })).toHaveLength(1);
    expect(themeOf(viewport())).toBe('dark');
    // A nested root's toast shows there.
    await user.click(screen.getByRole('button', { name: 'Notify' }));
    expect(await within(viewport()).findByRole('dialog', { name: 'Saved' })).toBeInTheDocument();
    // A manager two roots share: each toast once.
    act(() => {
      shared.add({ title: 'Backups overdue' });
    });
    await within(viewport()).findByRole('dialog', { name: 'Backups overdue' });
    expect(within(viewport()).getAllByRole('dialog', { name: 'Backups overdue' })).toHaveLength(1);
    expect(viewports()).toHaveLength(1);
  });

  it('a root beside the page root sends its toasts to the one viewport, which passes on when its root goes', async () => {
    const user = userEvent.setup();
    function Page({ first }) {
      return (
        <>
          {first ? <UiRoot data-testid="first" /> : null}
          <UiRoot theme="light">
            <Notify />
          </UiRoot>
        </>
      );
    }
    const { rerender } = render(<Page first />);
    expect(viewports()).toHaveLength(1);
    expect(themeOf(viewport())).toBe('dark');
    await user.click(screen.getByRole('button', { name: 'Notify' }));
    expect(await within(viewport()).findByRole('dialog', { name: 'Saved' })).toBeInTheDocument();
    // The first root unmounts: the next one at the top of the page takes over.
    rerender(<Page first={false} />);
    expect(viewports()).toHaveLength(1);
    expect(themeOf(viewport())).toBe('light');
    await user.click(screen.getByRole('button', { name: 'Notify' }));
    expect(await within(viewport()).findByRole('dialog', { name: 'Saved' })).toBeInTheDocument();
  });

  it('outside any root, an overlay falls back to a bare .jh-ui root: the defaults', () => {
    render(<Dialog defaultOpen title="Edit node" />);
    const root = screen.getByRole('dialog').closest('.jh-ui');
    expect(root).not.toBeNull();
    for (const name of ROOT_SWITCHES) expect(root).not.toHaveAttribute(name);
  });
});
