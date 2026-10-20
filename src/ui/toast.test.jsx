import { StrictMode, useEffect } from 'react';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Button } from '@ui/button';
import { UiRoot } from '@ui/root';
import { createToastManager, useToast } from '@ui/toast';

const NO_RING = /(^|\s|:)outline-(none|hidden|0)(\s|$)/;
const viewport = () => document.querySelector('[data-slot="toast-viewport"]');

function Notify({ options, label = 'Notify' }) {
  const toast = useToast();
  return <Button onClick={() => toast.add(options)}>{label}</Button>;
}

describe('Toast', () => {
  it('announces each toast: the viewport is a polite live region, a landmark named Notifications', async () => {
    const user = userEvent.setup();
    render(
      <UiRoot>
        <Notify
          options={{ title: 'Sent to 2 devices', description: 'Pixel 8 and Galaxy Tab S9' }}
        />
      </UiRoot>
    );
    // The region is in the page before any toast, so a screen reader hears the first.
    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(region).toBe(viewport());
    expect(region).toHaveAttribute('aria-live', 'polite');
    await user.click(screen.getByRole('button', { name: 'Notify' }));
    const toast = await within(region).findByRole('dialog', { name: 'Sent to 2 devices' });
    expect(toast).toHaveAccessibleDescription('Pixel 8 and Galaxy Tab S9');
    expect(toast).toHaveAttribute('data-slot', 'toast');
  });

  it('announces a crit toast assertively, as an alert, and keeps it until dismissed', async () => {
    const user = userEvent.setup();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(
        <UiRoot>
          <Notify
            options={{
              tone: 'crit',
              title: 'Couldn’t save the checklist',
              description: 'The server answered 503. The list is back to what it holds.',
            }}
          />
        </UiRoot>
      );
      await user.click(screen.getByRole('button', { name: 'Notify' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Couldn’t save the checklist');
      expect(alert).toHaveTextContent('The server answered 503.');
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      expect(viewport().querySelector('[data-slot="toast"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('goes by itself after 5 seconds when not urgent', async () => {
    const user = userEvent.setup();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(
        <UiRoot>
          <Notify options={{ title: 'Saved' }} />
        </UiRoot>
      );
      await user.click(screen.getByRole('button', { name: 'Notify' }));
      await within(viewport()).findByRole('dialog', { name: 'Saved' });
      await act(() => vi.advanceTimersByTimeAsync(5_500));
      await waitFor(() => expect(viewport().querySelector('[data-slot="toast"]')).toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });

  it('is the mock’s floating card at the bottom right: surface-2, a strong edge, 12px radius, shadow-pop', async () => {
    const user = userEvent.setup();
    render(
      <UiRoot>
        <Notify options={{ title: 'Saved' }} />
      </UiRoot>
    );
    await user.click(screen.getByRole('button', { name: 'Notify' }));
    const toast = await within(viewport()).findByRole('dialog', { name: 'Saved' });
    expect(toast).toHaveClass(
      'bg-surface-2',
      'border-border-strong',
      'rounded-xl',
      'shadow-pop',
      'text-body-sm',
      'transition-[opacity,translate]',
      'data-starting-style:translate-y-2',
      'data-starting-style:opacity-0'
    );
    expect(toast.className).not.toMatch(NO_RING);
    expect(toast.className).not.toMatch(/(^|\s)duration-/);
    expect(viewport()).toHaveClass(
      'fixed',
      'z-toast',
      'right-gutter',
      'bottom-gutter',
      'sm:w-[360px]'
    );
    // Neutral: no status icon.
    expect(toast.querySelector('svg[data-tone]')).toBeNull();
  });

  it('shows its tone as the lamp’s shape in the word colour, never colour alone', async () => {
    const user = userEvent.setup();
    render(
      <UiRoot>
        <Notify options={{ tone: 'ok', title: 'Connected in 142 ms' }} />
      </UiRoot>
    );
    await user.click(screen.getByRole('button', { name: 'Notify' }));
    const toast = await within(viewport()).findByRole('dialog', { name: 'Connected in 142 ms' });
    const icon = toast.querySelector('svg[data-tone="ok"]');
    expect(icon).toHaveClass('text-ok-fg', 'fill-current');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('dismisses with its button, and runs its action, which dismisses it too', async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    render(
      <UiRoot>
        <Notify
          options={{ title: 'Removed Pixel 8', action: { label: 'Undo', onClick: onUndo } }}
        />
      </UiRoot>
    );
    await user.click(screen.getByRole('button', { name: 'Notify' }));
    const toast = await within(viewport()).findByRole('dialog', { name: 'Removed Pixel 8' });
    const undo = within(toast).getByRole('button', { name: 'Undo' });
    expect(undo).toHaveClass('text-accent-text');
    await user.click(undo);
    expect(onUndo).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(viewport().querySelector('[data-slot="toast"]')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Notify' }));
    const next = await within(viewport()).findByRole('dialog', { name: 'Removed Pixel 8' });
    // Base UI hides the dismiss button from screen readers until the toasts
    // are expanded: under the pointer, or reached with F6.
    await user.hover(next);
    await user.click(within(next).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(viewport().querySelector('[data-slot="toast"]')).toBeNull());
  });

  it('takes toasts from code outside React through a manager handed to UiRoot', async () => {
    const toasts = createToastManager();
    render(<UiRoot toastManager={toasts} />);
    act(() => {
      toasts.add({ tone: 'warn', title: 'Backups overdue', description: 'Last success 27 h ago' });
    });
    const toast = await within(viewport()).findByRole('dialog', { name: 'Backups overdue' });
    expect(toast.querySelector('svg[data-tone="warn"]')).not.toBeNull();
  });

  it('shows a toast added while the screen mounts, before the toasts are listening', async () => {
    // A child's effect runs before UiRoot's: a failed first load reports there.
    // With an id, the second run in StrictMode updates the toast in place.
    function FailedLoad() {
      const toast = useToast();
      useEffect(() => {
        toast.add({
          id: 'overview-load',
          tone: 'crit',
          title: 'Couldn’t load the Overview',
          description: 'HTTP 502',
        });
      }, [toast]);
      return null;
    }
    render(
      <StrictMode>
        <UiRoot>
          <FailedLoad />
        </UiRoot>
      </StrictMode>
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the Overview');
  });

  it('holds what code outside React sends before UiRoot mounts', async () => {
    const toasts = createToastManager();
    const id = toasts.add({ title: 'Signed in again' });
    expect(id).toMatch(/^jh-toast-/);
    render(<UiRoot toastManager={toasts} />);
    expect(
      await within(viewport()).findByRole('dialog', { name: 'Signed in again' })
    ).toBeInTheDocument();
  });

  it('needs a UiRoot around it', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<Notify options={{ title: 'Saved' }} />)).toThrow(/UiRoot/);
    } finally {
      quiet.mockRestore();
    }
  });
});
