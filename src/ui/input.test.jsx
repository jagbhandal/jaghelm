import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Input } from '@ui/input';

const NO_RING = /(^|\s|:)outline-(none|hidden|0)(\s|$)/;

describe('Input', () => {
  it("renders a text field drawn as the mock's .field", () => {
    render(<Input aria-label="Instance name" defaultValue="JagHelm" />);
    const input = screen.getByRole('textbox', { name: 'Instance name' });
    expect(input).toHaveValue('JagHelm');
    expect(input).toHaveAttribute('data-slot', 'input');
    expect(input).toHaveClass(
      'h-control',
      'rounded-lg',
      'border-border-strong',
      'bg-background',
      'px-2.5',
      'text-body-sm',
      'text-text-1',
      'placeholder:text-text-3',
      // The mock rings a focused field 1px out, closer than other controls.
      'focus-visible:outline-offset-1'
    );
    expect(input.className).not.toMatch(NO_RING);
  });

  it('takes focus with Tab and reports what is typed', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Input aria-label="Subtitle" onValueChange={onValueChange} />);
    await user.tab();
    const input = screen.getByRole('textbox', { name: 'Subtitle' });
    expect(input).toHaveFocus();
    await user.keyboard('homelab');
    expect(input).toHaveValue('homelab');
    expect(onValueChange).toHaveBeenLastCalledWith('homelab', expect.anything());
  });

  it('marks itself invalid with aria-invalid, and its edge turns crit', () => {
    render(<Input aria-label="URL" aria-invalid="true" />);
    const input = screen.getByRole('textbox', { name: 'URL' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveClass('aria-invalid:border-crit-border');
  });

  it('when disabled, is skipped by Tab and dimmed', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Input aria-label="Locked" disabled />
        <Input aria-label="Open" />
      </>
    );
    expect(screen.getByRole('textbox', { name: 'Locked' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Locked' })).toHaveClass('disabled:opacity-55');
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Open' })).toHaveFocus();
  });

  it('keeps a caller class, such as font-mono for a URL', () => {
    render(<Input aria-label="URL" className="font-mono" />);
    expect(screen.getByRole('textbox', { name: 'URL' })).toHaveClass('font-mono', 'text-body-sm');
  });
});
