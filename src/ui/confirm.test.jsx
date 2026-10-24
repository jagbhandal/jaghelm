import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Button } from '@ui/button';
import { Confirm } from '@ui/confirm';
import { tab } from '../testing/tab.js';

// A device as the server stores it: the key is how JagHelm finds it, the name
// is what the person calls it.
const DEVICE = { key: '3f9a1c77e0b2', name: 'Pixel 8', detail: 'Registered 12 d ago' };

function RemoveDevice(props) {
  return (
    <Confirm
      trigger={<Button variant="ghost">Remove</Button>}
      title="Remove this device?"
      name={DEVICE.name}
      detail={DEVICE.detail}
      value={DEVICE.key}
      description="It stops getting pushes until it signs in again."
      confirmLabel="Remove device"
      destructive
      {...props}
    />
  );
}

describe('Confirm', () => {
  it('is an alertdialog named by its question, describing the thing by its display name', async () => {
    const user = userEvent.setup();
    render(<RemoveDevice />);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove this device?' });
    expect(dialog).toHaveAttribute('data-slot', 'confirm');
    expect(dialog).toHaveAccessibleDescription(
      'Pixel 8 Registered 12 d ago It stops getting pushes until it signs in again.'
    );
    const subject = dialog.querySelector('[data-slot="confirm-subject"]');
    expect(subject).toHaveTextContent('Pixel 8');
    expect(dialog).toHaveClass('w-[440px]', 'bg-surface-1', 'rounded-xl', 'shadow-pop');
  });

  it('quotes the subject on surface-2 without an edge, so it never reads as a field', async () => {
    const user = userEvent.setup();
    render(<RemoveDevice />);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    const subject = dialog.querySelector('[data-slot="confirm-subject"]');
    expect(subject).toHaveClass('bg-surface-2', 'rounded-lg', 'px-3', 'py-2.5');
    // Not the Input's recipe: no edge, not the page colour.
    expect(subject.className).not.toMatch(/(^|\s)(border|border-[\w-]+|bg-background)(\s|$)/);
    expect(screen.getByText('Pixel 8')).toHaveClass('font-semibold', 'text-text-1');
    expect(screen.getByText(DEVICE.detail)).toHaveClass('text-caption', 'text-text-3');
  });

  it('never shows the storage key: it travels as `value` and comes back to onConfirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<RemoveDevice onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).not.toContain(DEVICE.key);
    for (const el of [dialog, ...dialog.querySelectorAll('*')]) {
      for (const { value } of el.attributes) expect(value).not.toContain(DEVICE.key);
    }
    await user.click(screen.getByRole('button', { name: 'Remove device' }));
    expect(onConfirm).toHaveBeenCalledWith(DEVICE.key);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('requires a display name: it throws in development', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() =>
        render(<Confirm defaultOpen title="Remove this device?" value={DEVICE.key} />)
      ).toThrow(/name/);
      expect(() => render(<Confirm defaultOpen title="Remove this device?" name="  " />)).toThrow(
        /storage key/
      );
    } finally {
      quiet.mockRestore();
    }
  });

  it('logs a missing name in a production build instead of taking the screen down', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('DEV', false);
    try {
      render(<Confirm defaultOpen title="Remove this device?" />);
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      expect(logged).toHaveBeenCalledWith(expect.stringMatching(/display name/));
    } finally {
      vi.unstubAllEnvs();
      logged.mockRestore();
    }
  });

  it('destructive: the quiet danger button leads, Cancel is a ghost, and focus starts on Cancel', async () => {
    const user = userEvent.setup();
    render(<RemoveDevice />);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await screen.findByRole('alertdialog');
    const confirm = screen.getByRole('button', { name: 'Remove device' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    // Danger is never filled (design-system rule 3, #285): red text, a red edge.
    expect(confirm).toHaveClass('text-crit-fg', 'border-crit-border', 'bg-surface-1');
    expect(confirm.className).not.toMatch(/bg-crit|bg-accent/);
    expect(cancel).toHaveClass('text-text-2');
    expect(cancel.className).not.toMatch(/(^|\s)(border|bg-accent|bg-surface-1)(\s|$)/);
    // The main action first, as the mock orders its buttons.
    expect(confirm.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(cancel).toHaveFocus());
  });

  it('not destructive: the primary button confirms, and focus starts on it', async () => {
    const user = userEvent.setup();
    render(
      <Confirm
        trigger={<Button>Restart</Button>}
        title="Restart this container?"
        name="Immich"
        confirmLabel="Restart"
      />
    );
    await user.click(screen.getByRole('button', { name: 'Restart' }));
    await screen.findByRole('alertdialog');
    const confirm = screen.getByRole('button', { name: 'Restart', hidden: false });
    expect(confirm).toHaveClass('bg-accent', 'text-on-accent');
    await waitFor(() => expect(confirm).toHaveFocus());
  });

  it('Escape cancels: nothing is removed, and focus returns to the button that asked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<RemoveDevice onConfirm={onConfirm} onCancel={onCancel} />);
    const opener = screen.getByRole('button', { name: 'Remove' });
    await user.click(opener);
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('Cancel cancels; the confirm button confirms without a cancel', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<RemoveDevice onConfirm={onConfirm} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(await screen.findByRole('button', { name: 'Remove device' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('stays open when onConfirm throws, and a Cancel after that still cancels', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn(() => {
      throw new Error('The server said no');
    });
    // React reports an event handler's error to the window; keep it quiet.
    const swallow = (event) => event.preventDefault();
    window.addEventListener('error', swallow);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<RemoveDevice onConfirm={onConfirm} onCancel={onCancel} />);
      await user.click(screen.getByRole('button', { name: 'Remove' }));
      await user.click(await screen.findByRole('button', { name: 'Remove device' }));
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      expect(onCancel).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('error', swallow);
      quiet.mockRestore();
    }
  });

  it('needs its question as a title: without one it throws in development', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<Confirm defaultOpen name="Pixel 8" />)).toThrow(/title/);
    } finally {
      quiet.mockRestore();
    }
  });

  it('only its buttons or Escape close it, never a click on the scrim', async () => {
    const user = userEvent.setup();
    render(<RemoveDevice />);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await screen.findByRole('alertdialog');
    await user.click(document.querySelector('[data-slot="scrim"]'));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('traps focus between its two buttons', async () => {
    const user = userEvent.setup();
    render(<RemoveDevice />);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await screen.findByRole('alertdialog');
    const confirm = screen.getByRole('button', { name: 'Remove device' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(cancel).toHaveFocus());
    await tab(user);
    expect(confirm).toHaveFocus();
    await tab(user);
    expect(cancel).toHaveFocus();
    await tab(user, { shift: true });
    expect(confirm).toHaveFocus();
  });

  it('opened from inside an open native dialog (the phone’s sheet) is drawn inside it, in its top layer (#688)', async () => {
    const user = userEvent.setup();
    render(
      <dialog open data-testid="sheet">
        <RemoveDevice />
      </dialog>
    );
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const alert = await screen.findByRole('alertdialog');
    expect(screen.getByTestId('sheet')).toContainElement(alert);
  });

  it('opened from the page is drawn at the end of the body', async () => {
    const user = userEvent.setup();
    render(<RemoveDevice />);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const alert = await screen.findByRole('alertdialog');
    expect(alert.closest('dialog')).toBeNull();
  });
});
