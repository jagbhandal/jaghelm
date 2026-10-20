import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { Button } from '@ui/button';
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
          {['Immich', 'Grafana'].map((name) => (
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
    const grafana = screen.getByRole('button', { name: 'Grafana' });
    await user.click(grafana);
    expect(await screen.findByRole('dialog', { name: 'Grafana' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(grafana).toHaveFocus());
  });
});
