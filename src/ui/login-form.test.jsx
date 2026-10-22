import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LoginForm, LoginScreen } from '@ui/login-form';

describe('LoginForm', () => {
  it('ties each error to its field, and never takes focus on its first render', () => {
    render(<LoginForm username="admin" errors={{ password: 'Wrong username or password.' }} />);
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(password).toHaveAccessibleDescription('Wrong username or password.');
    expect(screen.getByRole('textbox', { name: 'Username' })).toHaveValue('admin');
    expect(document.body).toHaveFocus();
  });

  it("the form's error is an alert over the fields, with no field invalid", () => {
    render(<LoginForm errors={{ form: "JagHelm didn't answer." }} />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't sign in");
    expect(screen.getByRole('textbox', { name: 'Username' })).not.toHaveAttribute('aria-invalid');
  });

  it('busy: "Signing in…", focusable, and a submit does nothing', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<LoginForm busy onSubmit={onSubmit} />);
    const button = screen.getByRole('button', { name: 'Signing in…' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await user.tab();
    await user.tab();
    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.type(screen.getByRole('textbox', { name: 'Username' }), '{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('LoginScreen: a root in the theme, the form in the main landmark', () => {
    render(<LoginScreen theme="light" name="Homelab" />);
    const root = document.querySelector('[data-slot="login-screen"]');
    expect(root).toHaveClass('jh-ui');
    expect(root).toHaveAttribute('data-theme', 'light');
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { level: 1 }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Homelab');
  });
});
