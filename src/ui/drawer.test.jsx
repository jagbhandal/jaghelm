import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Button } from '@ui/button';
import { Confirm } from '@ui/confirm';
import { Drawer, DrawerClose } from '@ui/drawer';
import { tab } from '../testing/tab.js';

const NO_RING = /(^|\s|:)outline-(none|hidden|0)(\s|$)/;

function ImmichDrawer(props) {
  return (
    <Drawer
      trigger={<Button variant="ghost">Immich</Button>}
      eyebrow="Service"
      title="Immich"
      description="Production (vm-103)"
      {...props}
    >
      <p>Kuma: HTTP 502 for 4 min</p>
      <div className="flex gap-2">
        <Button variant="primary">Open Immich</Button>
        <DrawerClose render={<Button />}>Done</DrawerClose>
      </div>
    </Drawer>
  );
}

describe('Drawer', () => {
  it('opens from its row as a modal dialog named by its title, described by where the thing is', async () => {
    const user = userEvent.setup();
    render(<ImmichDrawer />);
    await user.click(screen.getByRole('button', { name: 'Immich' }));
    const drawer = await screen.findByRole('dialog', { name: 'Immich' });
    expect(drawer).toHaveAttribute('data-slot', 'drawer');
    expect(drawer).toHaveAccessibleDescription('Production (vm-103)');
    expect(screen.getByText('Service')).toHaveClass('text-overline', 'uppercase', 'text-text-3');
    expect(screen.getByRole('heading', { name: 'Immich' })).toHaveClass('text-title');
  });

  it('is the mock’s detail drawer: full height on the right, 460px, surface-1, a subtle left edge, shadow-pop', async () => {
    const user = userEvent.setup();
    render(<ImmichDrawer />);
    await user.click(screen.getByRole('button', { name: 'Immich' }));
    const drawer = await screen.findByRole('dialog');
    expect(drawer).toHaveClass(
      'fixed',
      'inset-y-0',
      'right-0',
      'w-[460px]',
      'max-w-full',
      'bg-surface-1',
      'border-l',
      'border-border',
      'shadow-pop',
      'z-dialog'
    );
    expect(drawer).not.toHaveClass('rounded-xl', 'border-border-strong');
    expect(drawer.className).not.toMatch(NO_RING);
    expect(drawer.querySelector('[data-slot="drawer-body"]')).toHaveClass('p-5', 'gap-5');
    expect(document.querySelector('[data-slot="scrim"]')).toHaveClass('bg-scrim');
  });

  it('slides in from the right over the standard 150ms (§5.3)', async () => {
    const user = userEvent.setup();
    render(<ImmichDrawer />);
    await user.click(screen.getByRole('button', { name: 'Immich' }));
    const drawer = await screen.findByRole('dialog');
    expect(drawer).toHaveClass(
      'transition-transform',
      'data-starting-style:translate-x-full',
      'data-ending-style:translate-x-full'
    );
    expect(drawer.className).not.toMatch(/(^|\s)duration-/);
  });

  it('traps focus: Tab and Shift+Tab cycle inside it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ImmichDrawer />
        <Button>Next row</Button>
      </>
    );
    await user.click(screen.getByRole('button', { name: 'Immich' }));
    const drawer = await screen.findByRole('dialog');
    const close = screen.getByRole('button', { name: 'Close' });
    await waitFor(() => expect(close).toHaveFocus());
    await tab(user);
    expect(screen.getByRole('button', { name: 'Open Immich' })).toHaveFocus();
    await tab(user);
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();
    await tab(user);
    expect(close).toHaveFocus();
    await tab(user, { shift: true });
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();
    expect(drawer).toContainElement(document.activeElement);
    const outside = screen.getByRole('button', { name: 'Next row', hidden: true });
    expect(outside.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('closes on Escape and returns focus to the row that opened it', async () => {
    const user = userEvent.setup();
    render(<ImmichDrawer />);
    const row = screen.getByRole('button', { name: 'Immich' });
    await user.click(row);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(row).toHaveFocus());
  });

  it('closes on a click on the scrim, and from a DrawerClose', async () => {
    const user = userEvent.setup();
    render(<ImmichDrawer />);
    const row = screen.getByRole('button', { name: 'Immich' });
    await user.click(row);
    await screen.findByRole('dialog');
    await user.click(document.querySelector('[data-slot="scrim"]'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(row);
    await user.click(await screen.findByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('one drawer for many rows: opened from code, focus returns to the row that opened it', async () => {
    const user = userEvent.setup();
    function Rows() {
      const [open, setOpen] = useState(null);
      return (
        <>
          {['Immich', 'Netdata'].map((name) => (
            <Button key={name} variant="ghost" onClick={() => setOpen(name)}>
              {name}
            </Button>
          ))}
          <Drawer
            open={open != null}
            onOpenChange={(next) => !next && setOpen(null)}
            title={open ?? ''}
          >
            <p>Details</p>
          </Drawer>
        </>
      );
    }
    render(<Rows />);
    const netdata = screen.getByRole('button', { name: 'Netdata' });
    await user.click(netdata);
    expect(await screen.findByRole('dialog', { name: 'Netdata' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(netdata).toHaveFocus());
  });

  it('needs a name: a title, or an aria-label without one', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<Drawer defaultOpen eyebrow="Service" />)).toThrow(/title/);
    } finally {
      quiet.mockRestore();
    }
    render(<Drawer defaultOpen aria-label="Immich" />);
    expect(screen.getByRole('dialog', { name: 'Immich' })).toBeInTheDocument();
  });

  it('a Confirm opened from it stacks above it on a lighter scrim of its own, and the drawer under it is inert', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <Drawer trigger={<Button variant="ghost">Immich</Button>} eyebrow="Service" title="Immich">
        <Button variant="primary">Open Immich</Button>
        <Confirm
          trigger={<Button variant="danger">Remove…</Button>}
          title="Remove this service?"
          name="Immich"
          confirmLabel="Remove"
          destructive
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      </Drawer>
    );
    const row = screen.getByRole('button', { name: 'Immich' });
    await user.click(row);
    const drawer = await screen.findByRole('dialog', { name: 'Immich' });
    const remove = screen.getByRole('button', { name: 'Remove…' });
    await user.click(remove);
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove this service?' });

    // Base UI draws no scrim for a nested dialog unless told to: here each
    // layer has its own, on the popups' layer, the nested one after the
    // drawer, so it covers it, and half as strong.
    const [scrim, nestedScrim] = document.querySelectorAll('[data-slot="scrim"]');
    expect(scrim).toHaveClass('bg-scrim', 'z-dialog');
    expect(nestedScrim).toHaveAttribute('data-nested');
    expect(nestedScrim).toHaveClass('bg-scrim-nested', 'z-dialog', 'fixed', 'inset-0');
    expect(nestedScrim).not.toHaveClass('bg-scrim');
    expect(
      drawer.compareDocumentPosition(nestedScrim) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      nestedScrim.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    // The drawer can't be clicked, focused or read until the Confirm closes.
    expect(drawer).toHaveAttribute('inert');
    expect(drawer.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(confirm).not.toHaveAttribute('inert');

    // A click where the drawer is lands on the Confirm's scrim (a browser
    // hit-tests it there): nothing behind closes, and nothing is answered.
    await user.click(nestedScrim);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(drawer).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();

    // Escape closes only the top one, as a cancel; focus goes back to Remove…
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Immich' })).not.toHaveAttribute('inert');
    await waitFor(() => expect(remove).toHaveFocus());
    expect(document.querySelectorAll('[data-slot="scrim"]')).toHaveLength(1);

    // Then the drawer, and focus goes back to its row.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(row).toHaveFocus());
  });
});
