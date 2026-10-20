import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Button } from '@ui/button';
import { Dialog, DialogClose } from '@ui/dialog';
import { Input } from '@ui/input';
import { tab } from '../testing/tab.js';

const NO_RING = /(^|\s|:)outline-(none|hidden|0)(\s|$)/;

function RenameDialog(props) {
  return (
    <Dialog
      trigger={<Button>Rename</Button>}
      title="Rename this node"
      description="The new name shows everywhere the node does."
      footer={
        <>
          <Button variant="primary">Save</Button>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        </>
      }
      {...props}
    >
      <Input aria-label="Name" defaultValue="Production" />
    </Dialog>
  );
}

describe('Dialog', () => {
  it('opens from its trigger as a modal dialog named and described by its title and description', async () => {
    const user = userEvent.setup();
    render(<RenameDialog />);
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename this node' });
    expect(dialog).toHaveAccessibleDescription('The new name shows everywhere the node does.');
    expect(dialog).toHaveAttribute('data-slot', 'dialog');
  });

  it('is drawn as the mock’s command palette: surface-1, a strong edge, 12px radius, shadow-pop, over the scrim', async () => {
    const user = userEvent.setup();
    render(<RenameDialog />);
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveClass(
      'bg-surface-1',
      'border-border-strong',
      'rounded-xl',
      'shadow-pop',
      'z-dialog',
      'top-24',
      'p-6',
      'w-[540px]'
    );
    expect(dialog.className).not.toMatch(NO_RING);
    expect(dialog.className).not.toMatch(/blur/);
    const scrim = document.querySelector('[data-slot="scrim"]');
    expect(scrim).toHaveClass('bg-scrim', 'z-overlay', 'fixed', 'inset-0');
    // The title is the type scale's title step (20/26 bold).
    expect(screen.getByRole('heading', { name: 'Rename this node' })).toHaveClass('text-title');
  });

  it('comes in three widths', async () => {
    const user = userEvent.setup();
    render(<RenameDialog size="lg" />);
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    expect(await screen.findByRole('dialog')).toHaveClass('w-[600px]');
  });

  it('traps focus: Tab and Shift+Tab cycle inside it, and the page under it is hidden', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Button>Before</Button>
        <RenameDialog />
        <Button>After</Button>
      </>
    );
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const dialog = await screen.findByRole('dialog');
    // Focus starts on the first control inside: the close button, top right.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus());
    const order = [];
    for (let i = 0; i < 6; i += 1) {
      await tab(user);
      order.push(document.activeElement);
    }
    for (const el of order) expect(dialog).toContainElement(el);
    expect(order.map((el) => el.getAttribute('aria-label') ?? el.textContent)).toEqual([
      'Name',
      'Save',
      'Cancel',
      'Close',
      'Name',
      'Save',
    ]);
    await tab(user, { shift: true });
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
    await tab(user, { shift: true });
    await tab(user, { shift: true });
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    // Screen readers can't wander out either: the page is aria-hidden.
    for (const name of ['Before', 'After']) {
      const outside = screen.getByRole('button', { name, hidden: true });
      expect(outside.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('closes on Escape and returns focus to the button that opened it', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<RenameDialog onOpenChange={onOpenChange} />);
    const opener = screen.getByRole('button', { name: 'Rename' });
    await user.click(opener);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onOpenChange).toHaveBeenLastCalledWith(false, expect.anything());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('closes from its close button and from a DialogClose in the footer', async () => {
    const user = userEvent.setup();
    render(<RenameDialog />);
    const opener = screen.getByRole('button', { name: 'Rename' });
    await user.click(opener);
    await user.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
    await user.click(opener);
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('opened from code, returns focus to whatever had it', async () => {
    const user = userEvent.setup();
    function Screen() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Edit node</Button>
          <Dialog open={open} onOpenChange={setOpen} title="Edit node">
            <Input aria-label="Name" />
          </Dialog>
        </>
      );
    }
    render(<Screen />);
    const opener = screen.getByRole('button', { name: 'Edit node' });
    await user.click(opener);
    expect(await screen.findByRole('dialog', { name: 'Edit node' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('fades over the standard 150ms, scrim and all (§5.3)', async () => {
    const user = userEvent.setup();
    render(<RenameDialog />);
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const dialog = await screen.findByRole('dialog');
    for (const el of [dialog, document.querySelector('[data-slot="scrim"]')]) {
      expect(el).toHaveClass(
        'transition-opacity',
        'data-starting-style:opacity-0',
        'data-ending-style:opacity-0'
      );
      // The token's duration, never one of its own (scripts/ui-stack.test.mjs).
      expect(el.className).not.toMatch(/(^|\s)duration-/);
    }
  });

  it('is portalled as a .jh-ui root with the switches of the screen around its trigger', async () => {
    const user = userEvent.setup();
    render(
      <div className="jh-ui" data-theme="light" data-density="compact" data-testid="screen">
        <RenameDialog />
      </div>
    );
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const dialog = await screen.findByRole('dialog');
    expect(screen.getByTestId('screen')).not.toContainElement(dialog);
    const root = dialog.closest('.jh-ui');
    expect(root).toHaveAttribute('data-theme', 'light');
    expect(root).toHaveAttribute('data-density', 'compact');
  });
});
