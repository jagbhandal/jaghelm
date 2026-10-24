import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Field } from '@ui/field';
import { Textarea } from '@ui/textarea';

describe('Textarea', () => {
  it('is a multi-line field that takes a Field’s label, help text and error', () => {
    render(
      <Field label="Theme JSON" description="Paste it" error="Not JSON">
        <Textarea defaultValue="{}" />
      </Field>
    );
    const box = screen.getByRole('textbox', { name: 'Theme JSON' });
    expect(box.tagName).toBe('TEXTAREA');
    expect(box).toHaveAccessibleDescription(/Paste it/);
    expect(box).toHaveAttribute('aria-invalid', 'true');
  });

  it('holds what is typed and pasted, in the monospace face when asked', async () => {
    const user = userEvent.setup();
    render(<Textarea aria-label="Data" mono />);
    const box = screen.getByRole('textbox', { name: 'Data' });
    await user.click(box);
    await user.paste('{"a":\n1}');
    expect(box).toHaveValue('{"a":\n1}');
    expect(box).toHaveClass('font-mono');
  });
});
