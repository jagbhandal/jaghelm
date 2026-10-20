import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Switch } from '@ui/switch';

const NO_RING = /(^|\s|:)outline-(none|hidden|0)(\s|$)/;

describe('Switch', () => {
  it("renders a switch, off, drawn as the mock's toggle", () => {
    render(<Switch aria-label="Show Pipeline" />);
    const sw = screen.getByRole('switch', { name: 'Show Pipeline' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(sw).toHaveAttribute('data-slot', 'switch');
    // 36 x 20 track: surface-3 off, the accent on; a 16px white thumb. Off,
    // a 1px control-edge edge carries 3:1 against the page (WCAG 1.4.11);
    // on, the edge is the accent, so the track is the mock's. 1px border and
    // 1px padding keep the thumb 2px in, as the mock's.
    expect(sw).toHaveClass(
      'h-5',
      'w-9',
      'rounded-full',
      'bg-surface-3',
      'border',
      'border-control-edge',
      'p-px',
      'data-checked:bg-accent',
      'data-checked:border-accent'
    );
    expect(sw.firstElementChild).toHaveClass(
      'size-4',
      'bg-switch-thumb',
      'shadow-thumb',
      'data-checked:translate-x-4'
    );
    expect(sw.className).not.toMatch(NO_RING);
  });

  it('toggles with Space once focused with Tab, and reports the change', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Weekly digest" onCheckedChange={onCheckedChange} />);
    await user.tab();
    const sw = screen.getByRole('switch', { name: 'Weekly digest' });
    expect(sw).toHaveFocus();
    await user.keyboard(' ');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(onCheckedChange).toHaveBeenLastCalledWith(true, expect.anything());
    await user.keyboard(' ');
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });

  it('carries its state in a form, by name', async () => {
    const user = userEvent.setup();
    render(
      <form data-testid="form">
        <Switch aria-label="Weekly digest" name="digest" />
      </form>
    );
    const form = screen.getByTestId('form');
    expect(new FormData(form).get('digest')).toBeNull();
    await user.click(screen.getByRole('switch', { name: 'Weekly digest' }));
    expect(new FormData(form).get('digest')).toBe('on');
  });

  it('is named by an enclosing label, and clicking the label toggles it', async () => {
    const user = userEvent.setup();
    render(
      <label>
        <Switch />A host stops answering
      </label>
    );
    const sw = screen.getByRole('switch', { name: 'A host stops answering' });
    await user.click(screen.getByText('A host stops answering'));
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('when disabled (the mock’s locked toggle), keeps its state and is skipped by Tab', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Switch aria-label="Needs attention" defaultChecked disabled />
        <Switch aria-label="Services" />
      </>
    );
    const locked = screen.getByRole('switch', { name: 'Needs attention' });
    expect(locked).toHaveAttribute('aria-checked', 'true');
    expect(locked).toHaveAttribute('data-disabled');
    expect(locked).toHaveClass('data-disabled:opacity-55');
    await user.click(locked);
    expect(locked).toHaveAttribute('aria-checked', 'true');
    await user.tab();
    expect(screen.getByRole('switch', { name: 'Services' })).toHaveFocus();
  });
});
