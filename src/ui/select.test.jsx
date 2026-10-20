import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Select } from '@ui/select';

const NO_RING = /(^|\s|:)outline-(none|hidden|0)(\s|$)/;
const REFRESH = [
  { value: '30', label: 'Every 30 s' },
  { value: '60', label: 'Every 60 s' },
  { value: '120', label: 'Every 2 min' },
];

describe('Select', () => {
  it('renders a combobox trigger, named, showing the chosen label', () => {
    render(<Select aria-label="Data refresh" items={REFRESH} defaultValue="30" />);
    const trigger = screen.getByRole('combobox', { name: 'Data refresh' });
    expect(trigger).toHaveTextContent('Every 30 s');
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('data-slot', 'select');
    // Drawn like the Input: the mock's .field select.
    expect(trigger).toHaveClass('h-control', 'border-border-strong', 'bg-background', 'text-body-sm');
    expect(trigger.className).not.toMatch(NO_RING);
    expect(trigger.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows a placeholder until something is chosen', () => {
    render(<Select aria-label="Search engine" items={REFRESH} placeholder="Choose one" />);
    expect(screen.getByRole('combobox', { name: 'Search engine' })).toHaveTextContent(
      'Choose one'
    );
  });

  it('opens with the arrow keys, moves, picks with Enter, and returns focus', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Select
        aria-label="Data refresh"
        items={REFRESH}
        defaultValue="30"
        onValueChange={onValueChange}
      />
    );
    const trigger = screen.getByRole('combobox', { name: 'Data refresh' });
    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    const listbox = await screen.findByRole('listbox');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('option', { name: 'Every 30 s' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Every 60 s' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onValueChange).toHaveBeenCalledWith('60', expect.anything());
    await waitFor(() => expect(listbox).not.toBeInTheDocument());
    expect(trigger).toHaveTextContent('Every 60 s');
    expect(trigger).toHaveFocus();
  });

  it('closes on Escape without changing the value', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Select
        aria-label="Data refresh"
        items={REFRESH}
        defaultValue="30"
        onValueChange={onValueChange}
      />
    );
    const trigger = screen.getByRole('combobox', { name: 'Data refresh' });
    trigger.focus();
    await user.keyboard('{Enter}');
    const listbox = await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}{Escape}');
    await waitFor(() => expect(listbox).not.toBeInTheDocument());
    expect(onValueChange).not.toHaveBeenCalled();
    expect(trigger).toHaveTextContent('Every 30 s');
    expect(trigger).toHaveFocus();
  });

  it('draws the list as a popover: surface-2, highlighted on surface-3, chosen ticked in the accent', async () => {
    const user = userEvent.setup();
    render(<Select aria-label="Data refresh" items={REFRESH} defaultValue="60" />);
    await user.click(screen.getByRole('combobox', { name: 'Data refresh' }));
    const listbox = await screen.findByRole('listbox');
    const popup = listbox.closest('[data-slot="select-popup"]');
    expect(popup).toHaveClass('bg-surface-2', 'border-border-strong', 'shadow-pop', 'rounded-lg');
    const chosen = screen.getByRole('option', { name: 'Every 60 s' });
    expect(chosen).toHaveClass('data-highlighted:bg-surface-3', 'h-control-sm');
    // The keyboard ring is inset, so it stays inside the list.
    expect(chosen).toHaveClass('-outline-offset-2');
    expect(chosen.className).not.toMatch(NO_RING);
    expect(chosen.querySelector('svg')).toHaveClass('text-accent-text');
    expect(screen.getByRole('option', { name: 'Every 30 s' }).querySelector('svg')).toBeNull();
  });

  it("portals the list into a .jh-ui root that carries the screen's switches", async () => {
    const user = userEvent.setup();
    render(
      <div
        className="jh-ui"
        data-theme="light"
        data-accent="cyan"
        data-density="compact"
        data-typeface="montserrat"
        data-testid="screen"
      >
        <Select aria-label="Data refresh" items={REFRESH} defaultValue="30" />
      </div>
    );
    await user.click(screen.getByRole('combobox', { name: 'Data refresh' }));
    const listbox = await screen.findByRole('listbox');
    expect(screen.getByTestId('screen')).not.toContainElement(listbox);
    const root = listbox.closest('.jh-ui');
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute('data-theme', 'light');
    expect(root).toHaveAttribute('data-accent', 'cyan');
    expect(root).toHaveAttribute('data-density', 'compact');
    expect(root).toHaveAttribute('data-typeface', 'montserrat');
  });

  it('when disabled, is skipped by Tab and never opens', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Select aria-label="Locked" items={REFRESH} defaultValue="30" disabled />
        <Select aria-label="Open" items={REFRESH} defaultValue="30" />
      </>
    );
    const locked = screen.getByRole('combobox', { name: 'Locked' });
    await user.tab();
    expect(screen.getByRole('combobox', { name: 'Open' })).toHaveFocus();
    await user.click(locked);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(locked).toHaveClass('data-disabled:opacity-55');
  });

  it('skips a disabled option with the arrow keys', async () => {
    const user = userEvent.setup();
    const items = [REFRESH[0], { ...REFRESH[1], disabled: true }, REFRESH[2]];
    render(<Select aria-label="Data refresh" items={items} defaultValue="30" />);
    screen.getByRole('combobox', { name: 'Data refresh' }).focus();
    await user.keyboard('{ArrowDown}');
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Every 2 min' })).toHaveFocus();
  });
});
