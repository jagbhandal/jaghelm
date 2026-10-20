import { createRef } from 'react';
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
    expect(trigger).toHaveClass(
      'h-control',
      'border-border-strong',
      'bg-background',
      'text-body-sm'
    );
    expect(trigger.className).not.toMatch(NO_RING);
    expect(trigger.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows a placeholder until something is chosen', () => {
    render(<Select aria-label="Search engine" items={REFRESH} placeholder="Choose one" />);
    expect(screen.getByRole('combobox', { name: 'Search engine' })).toHaveTextContent('Choose one');
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
    // Closed: no longer exposed to assistive tech (Base UI keeps it mounted, hidden).
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(listbox).not.toBeVisible();
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
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(onValueChange).not.toHaveBeenCalled();
    expect(trigger).toHaveTextContent('Every 30 s');
    expect(trigger).toHaveFocus();
  });

  it('draws the list as a popover: surface-2, the palette’s row tint, chosen ticked in the accent', async () => {
    const user = userEvent.setup();
    render(<Select aria-label="Data refresh" items={REFRESH} defaultValue="60" />);
    await user.click(screen.getByRole('combobox', { name: 'Data refresh' }));
    const listbox = await screen.findByRole('listbox');
    const popup = listbox.closest('[data-slot="select-popup"]');
    expect(popup).toHaveClass(
      'bg-surface-2',
      'border-border-strong',
      'shadow-pop',
      'rounded-lg',
      'p-1.5'
    );
    const chosen = screen.getByRole('option', { name: 'Every 60 s' });
    // The mock's command palette rows: row-hover, 8px radius, 10px padding;
    // never shadcn's neutral highlight.
    expect(chosen).toHaveClass(
      'data-highlighted:bg-row-hover',
      'rounded-lg',
      'px-2.5',
      'h-control-sm'
    );
    expect(chosen.className).not.toMatch(/surface-3/);
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

  it('reads the switches again when it opens, after the screen changed them', async () => {
    const user = userEvent.setup();
    render(
      <div className="jh-ui" data-testid="screen">
        <Select aria-label="Data refresh" items={REFRESH} defaultValue="30" />
      </div>
    );
    const screenRoot = screen.getByTestId('screen');
    screenRoot.setAttribute('data-theme', 'light');
    screenRoot.setAttribute('data-density', 'compact');
    await user.click(screen.getByRole('combobox', { name: 'Data refresh' }));
    const root = (await screen.findByRole('listbox')).closest('.jh-ui');
    expect(root).not.toBe(screenRoot);
    expect(root).toHaveAttribute('data-theme', 'light');
    expect(root).toHaveAttribute('data-density', 'compact');
  });

  it('moves to an option by typing its first letters', async () => {
    const user = userEvent.setup();
    const engines = [
      { value: 'google', label: 'Google' },
      { value: 'duckduckgo', label: 'DuckDuckGo' },
      { value: 'searxng', label: 'SearXNG' },
    ];
    render(<Select aria-label="Search engine" items={engines} defaultValue="google" />);
    screen.getByRole('combobox', { name: 'Search engine' }).focus();
    await user.keyboard('{ArrowDown}');
    await screen.findByRole('listbox');
    await user.keyboard('s');
    await waitFor(() => expect(screen.getByRole('option', { name: 'SearXNG' })).toHaveFocus());
    await user.keyboard('{Enter}');
    expect(screen.getByRole('combobox', { name: 'Search engine' })).toHaveTextContent('SearXNG');
  });

  it('carries its value in a form, by name', async () => {
    const user = userEvent.setup();
    render(
      <form data-testid="form">
        <Select aria-label="Data refresh" name="refresh" items={REFRESH} defaultValue="30" />
      </form>
    );
    const form = screen.getByTestId('form');
    expect(new FormData(form).get('refresh')).toBe('30');
    await user.click(screen.getByRole('combobox', { name: 'Data refresh' }));
    await user.click(await screen.findByRole('option', { name: 'Every 2 min' }));
    expect(new FormData(form).get('refresh')).toBe('120');
  });

  it('puts style, data-*, ref, title and focus handlers on the trigger', () => {
    const ref = createRef();
    const onFocus = vi.fn();
    render(
      <Select
        aria-label="Data refresh"
        items={REFRESH}
        defaultValue="30"
        ref={ref}
        style={{ width: 160 }}
        data-testid="refresh"
        title="How often the server polls"
        onFocus={onFocus}
      />
    );
    const trigger = screen.getByRole('combobox', { name: 'Data refresh' });
    expect(screen.getByTestId('refresh')).toBe(trigger);
    expect(ref.current).toBe(trigger);
    expect(trigger).toHaveStyle({ width: '160px' });
    expect(trigger).toHaveAttribute('title', 'How often the server polls');
    trigger.focus();
    expect(onFocus).toHaveBeenCalled();
  });

  it('renders with no items yet, as while they load', () => {
    render(<Select aria-label="Engine" placeholder="Loading" />);
    expect(screen.getByRole('combobox', { name: 'Engine' })).toHaveTextContent('Loading');
  });

  it('lists options whose values are objects, each its own', async () => {
    const user = userEvent.setup();
    const noisy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const hosts = [
        { value: { id: 1 }, label: 'pi-1' },
        { value: { id: 2 }, label: 'pi-2' },
      ];
      render(
        <Select
          aria-label="Host"
          items={hosts}
          isItemEqualToValue={(a, b) => a.id === b.id}
          itemToStringValue={(v) => String(v.id)}
          defaultValue={hosts[0].value}
        />
      );
      await user.click(screen.getByRole('combobox', { name: 'Host' }));
      expect(await screen.findAllByRole('option')).toHaveLength(2);
      expect(noisy.mock.calls.flat().join(' ')).not.toMatch(/same key/);
    } finally {
      noisy.mockRestore();
    }
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

  it('lets the arrow keys reach a disabled option, which Enter cannot pick', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const items = [REFRESH[0], { ...REFRESH[1], disabled: true }, REFRESH[2]];
    render(
      <Select
        aria-label="Data refresh"
        items={items}
        defaultValue="30"
        onValueChange={onValueChange}
      />
    );
    const trigger = screen.getByRole('combobox', { name: 'Data refresh' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    await screen.findByRole('listbox');
    // The list puts focus on the chosen option a frame after it opens.
    await waitFor(() => expect(screen.getByRole('option', { name: 'Every 30 s' })).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    const disabled = screen.getByRole('option', { name: 'Every 60 s' });
    expect(disabled).toHaveFocus();
    expect(disabled).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Enter}');
    expect(onValueChange).not.toHaveBeenCalled();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Every 2 min' })).toHaveFocus();
  });
});
