import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { Button } from '@ui/button';
import { Popover, PopoverClose } from '@ui/popover';

const NO_RING = /(^|\s|:)outline-(none|hidden|0)(\s|$)/;

function GroupPopover(props) {
  return (
    <Popover
      trigger={<Button>Group: Node</Button>}
      title="Group services"
      description="Rows group under the node they run on."
      {...props}
    >
      <PopoverClose render={<Button size="sm" />}>Done</PopoverClose>
    </Popover>
  );
}

describe('Popover', () => {
  it('opens from its trigger as a dialog named by its title, and moves focus into it', async () => {
    const user = userEvent.setup();
    render(<GroupPopover />);
    const trigger = screen.getByRole('button', { name: 'Group: Node' });
    await user.click(trigger);
    const popover = await screen.findByRole('dialog', { name: 'Group services' });
    expect(popover).toHaveAttribute('data-slot', 'popover');
    expect(popover).toHaveAccessibleDescription('Rows group under the node they run on.');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus());
  });

  it('is never unnamed: without a title, an aria-label names it, or else its trigger', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Popover trigger={<Button>Filter</Button>} aria-label="Filter the services">
          <PopoverClose render={<Button size="sm" />}>Done</PopoverClose>
        </Popover>
        <Popover trigger={<Button id="group-by">Group: Node</Button>}>
          <PopoverClose render={<Button size="sm" />}>Close</PopoverClose>
        </Popover>
      </>
    );
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    expect(await screen.findByRole('dialog', { name: 'Filter the services' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Group: Node' }));
    const popover = await screen.findByRole('dialog', { name: 'Group: Node' });
    // The trigger keeps the id it was given.
    expect(popover).toHaveAttribute('aria-labelledby', 'group-by');
  });

  it('is the mock’s floating card: surface-2, a strong edge, 12px radius, shadow-pop, 14 by 18px of padding', async () => {
    const user = userEvent.setup();
    render(<GroupPopover />);
    await user.click(screen.getByRole('button', { name: 'Group: Node' }));
    const popover = await screen.findByRole('dialog');
    expect(popover).toHaveClass(
      'bg-surface-2',
      'border-border-strong',
      'rounded-xl',
      'shadow-pop',
      'px-4.5',
      'py-3.5',
      'transition-opacity',
      'data-starting-style:opacity-0'
    );
    expect(popover.className).not.toMatch(NO_RING);
    expect(popover.className).not.toMatch(/(^|\s)duration-/);
    expect(popover.parentElement).toHaveClass('z-dialog');
  });

  it('closes on Escape and returns focus to its trigger', async () => {
    const user = userEvent.setup();
    render(<GroupPopover />);
    const trigger = screen.getByRole('button', { name: 'Group: Node' });
    await user.click(trigger);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('closes on a click outside, and from a PopoverClose', async () => {
    const user = userEvent.setup();
    render(
      <>
        <GroupPopover />
        <p>Elsewhere</p>
      </>
    );
    const trigger = screen.getByRole('button', { name: 'Group: Node' });
    await user.click(trigger);
    await screen.findByRole('dialog');
    await user.click(screen.getByText('Elsewhere'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(trigger);
    await user.click(await screen.findByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('is portalled as a .jh-ui root with the switches of the screen around its trigger', async () => {
    const user = userEvent.setup();
    render(
      <div className="jh-ui" data-theme="light" data-accent="fuchsia" data-testid="screen">
        <GroupPopover />
      </div>
    );
    await user.click(screen.getByRole('button', { name: 'Group: Node' }));
    const popover = await screen.findByRole('dialog');
    expect(screen.getByTestId('screen')).not.toContainElement(popover);
    const root = popover.closest('.jh-ui');
    expect(root).toHaveAttribute('data-theme', 'light');
    expect(root).toHaveAttribute('data-accent', 'fuchsia');
  });
});
