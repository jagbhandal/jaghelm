import { StrictMode, useEffect } from 'react';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Button } from '@ui/button';
import { UiRoot } from '@ui/root';
import { createToastManager, useToast } from '@ui/toast';

const NO_RING = /(^|\s|:)outline-(none|hidden|0)(\s|$)/;
const viewport = () => document.querySelector('[data-slot="toast-viewport"]');
const toastSaying = (title) =>
  [...viewport().querySelectorAll('[data-slot="toast"]')].find((t) =>
    t.textContent.includes(title)
  );

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

  it('a promise’s toast keeps its tone: ok when it succeeds, crit when it fails, unless it names one', async () => {
    let toast;
    function Grab() {
      toast = useToast();
      return null;
    }
    render(
      <UiRoot>
        <Grab />
      </UiRoot>
    );
    await act(() => toast.promise(Promise.resolve(), { loading: 'Saving', success: 'Saved' }));
    const saved = await within(viewport()).findByRole('dialog', { name: 'Saved' });
    expect(saved.querySelector('svg[data-tone="ok"]')).toHaveClass('text-ok-fg');
    // Without a success state, the loading toast's words stay, with the ok shape.
    await act(() => toast.promise(Promise.resolve(), { loading: 'Restarting Immich' }));
    const restarted = await within(viewport()).findByRole('dialog', { name: 'Restarting Immich' });
    await waitFor(() => expect(restarted.querySelector('svg[data-tone="ok"]')).not.toBeNull());
    await act(() =>
      toast
        .promise(Promise.reject(new Error('503')), {
          loading: 'Restarting',
          success: 'Restarted',
          error: { tone: 'warn', title: 'Restarted, but slow to answer' },
        })
        .catch(() => {})
    );
    const slow = await within(viewport()).findByRole('dialog', {
      name: 'Restarted, but slow to answer',
    });
    expect(slow.querySelector('svg[data-tone="warn"]')).not.toBeNull();
  });

  it('a failed promise’s toast is urgent: crit, an alert, and it stays', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let toast;
      function Grab() {
        toast = useToast();
        return null;
      }
      render(
        <UiRoot>
          <Grab />
        </UiRoot>
      );
      await act(() =>
        toast
          .promise(Promise.reject(new Error('503')), {
            loading: { title: 'Saving the checklist' },
            success: { title: 'Saved' },
            error: (e) => ({ tone: 'crit', title: 'Couldn’t save', description: e.message }),
          })
          .catch(() => {})
      );
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Couldn’t save');
      // Base UI hides an urgent toast itself from screen readers: its alert
      // copy is what they hear.
      const failed = toastSaying('Couldn’t save');
      expect(failed).toHaveAttribute('role', 'alertdialog');
      expect(failed.querySelector('svg[data-tone="crit"]')).not.toBeNull();
      // An error with no tone is crit too.
      await act(() =>
        toast.promise(Promise.reject(new Error('x')), { error: 'Couldn’t restart' }).catch(() => {})
      );
      await waitFor(() => expect(toastSaying('Couldn’t restart')).toBeDefined());
      const plain = toastSaying('Couldn’t restart');
      expect(plain).toHaveAttribute('role', 'alertdialog');
      expect(plain.querySelector('svg[data-tone="crit"]')).not.toBeNull();
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      expect(viewport().querySelectorAll('[data-slot="toast"]')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an update to crit makes a toast urgent, and an update back makes it polite again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let toast;
      function Grab() {
        toast = useToast();
        return null;
      }
      render(
        <UiRoot>
          <Grab />
        </UiRoot>
      );
      act(() => {
        toast.add({ id: 'save', title: 'Saving the checklist' });
      });
      const saving = await within(viewport()).findByRole('dialog', {
        name: 'Saving the checklist',
      });
      expect(saving.querySelector('svg[data-tone]')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
      act(() => {
        toast.update('save', { tone: 'crit', title: 'Couldn’t save the checklist' });
      });
      // Announced assertively, with the crit shape, and it stays.
      expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save the checklist');
      const failed = toastSaying('Couldn’t save the checklist');
      expect(failed).toHaveAttribute('role', 'alertdialog');
      expect(failed.querySelector('svg[data-tone="crit"]')).not.toBeNull();
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      expect(viewport().querySelector('[data-slot="toast"]')).not.toBeNull();
      act(() => {
        toast.update('save', { tone: 'ok', title: 'Saved on the second try' });
      });
      const saved = await within(viewport()).findByRole('dialog', {
        name: 'Saved on the second try',
      });
      expect(saved.querySelector('svg[data-tone="ok"]')).not.toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
      await act(() => vi.advanceTimersByTimeAsync(5_500));
      await waitFor(() => expect(viewport().querySelector('[data-slot="toast"]')).toBeNull());
    } finally {
      vi.useRealTimers();
    }
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

  it('drops a held toast that went stale before any UiRoot listened, but keeps a crit one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // Sent while a legacy screen was up, with no UiRoot to show them.
      const toasts = createToastManager();
      toasts.add({ title: 'Sent to 2 devices' });
      toasts.add({ tone: 'crit', title: 'Couldn’t reach JagNAS' });
      vi.setSystemTime(Date.now() + 6_000);
      toasts.add({ title: 'Signed in again' });
      render(<UiRoot toastManager={toasts} />);
      expect(
        await within(viewport()).findByRole('dialog', { name: 'Signed in again' })
      ).toBeInTheDocument();
      expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t reach JagNAS');
      expect(within(viewport()).queryByRole('dialog', { name: 'Sent to 2 devices' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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
