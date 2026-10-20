import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Checkbox } from '@ui/checkbox';

const NO_RING = /(^|\s|:)outline-(none|hidden|0)(\s|$)/;

describe('Checkbox', () => {
  it('renders an unchecked 16px box, named by an enclosing label', () => {
    render(
      <label>
        <Checkbox /> Open in a new browser tab
      </label>
    );
    const box = screen.getByRole('checkbox', { name: 'Open in a new browser tab' });
    expect(box).toHaveAttribute('aria-checked', 'false');
    expect(box).toHaveAttribute('data-slot', 'checkbox');
    // Its edge is control-edge, 3:1 against the page (WCAG 1.4.11), not the
    // 1.4:1 border-strong; an invalid box keeps 3:1 in crit's word colour.
    expect(box).toHaveClass(
      'size-4',
      'rounded-sm',
      'border',
      'border-control-edge',
      'bg-background',
      'data-checked:bg-accent',
      'data-checked:border-accent',
      'aria-invalid:border-crit-fg'
    );
    expect(box.className).not.toMatch(/border-border-strong|crit-border/);
    expect(box.className).not.toMatch(NO_RING);
    expect(box.querySelector('svg')).toBeNull();
  });

  it('toggles with Space once focused with Tab, and from its label', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <label>
        <Checkbox onCheckedChange={onCheckedChange} /> Rotate backups
      </label>
    );
    const box = screen.getByRole('checkbox', { name: 'Rotate backups' });
    await user.tab();
    expect(box).toHaveFocus();
    await user.keyboard(' ');
    expect(box).toHaveAttribute('aria-checked', 'true');
    expect(onCheckedChange).toHaveBeenLastCalledWith(true, expect.anything());
    // The tick is a Lucide icon in on-accent (currentColor), hidden from assistive tech.
    expect(box.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(box).toHaveClass('text-on-accent');
    await user.click(screen.getByText('Rotate backups'));
    expect(box).toHaveAttribute('aria-checked', 'false');
    expect(onCheckedChange).toHaveBeenCalledTimes(2);
  });

  it('shows the mixed state as aria-checked="mixed"', () => {
    render(<Checkbox aria-label="Select all" indeterminate />);
    expect(screen.getByRole('checkbox', { name: 'Select all' })).toHaveAttribute(
      'aria-checked',
      'mixed'
    );
  });

  it('carries its state in a form, by name', async () => {
    const user = userEvent.setup();
    render(
      <form data-testid="form">
        <Checkbox aria-label="Rotate backups" name="rotate" />
      </form>
    );
    const form = screen.getByTestId('form');
    expect(new FormData(form).get('rotate')).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Rotate backups' }));
    expect(new FormData(form).get('rotate')).toBe('on');
  });

  it('when disabled, ignores clicks and is skipped by Tab', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Checkbox aria-label="Locked" disabled />
        <Checkbox aria-label="Open" />
      </>
    );
    const locked = screen.getByRole('checkbox', { name: 'Locked' });
    await user.click(locked);
    expect(locked).toHaveAttribute('aria-checked', 'false');
    expect(locked).toHaveClass('data-disabled:opacity-55');
    await user.tab();
    expect(screen.getByRole('checkbox', { name: 'Open' })).toHaveFocus();
  });
});
