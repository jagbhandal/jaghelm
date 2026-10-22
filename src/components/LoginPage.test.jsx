/*
 * The sign-in page (#305): JagHelm's logo (#530), the shared components,
 * labelled fields, the error tied to its field with focus on it, Enter to
 * submit, one sign-in at a time, and the same request and answer handling as
 * before (POST /api/auth/login, the token handed to onLogin, which stores it).
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import LoginPage from './LoginPage.jsx';

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A fetch that answers each call in turn; an Error rejects, as a network failure. */
function stubFetch(...answers) {
  const fetch = vi.fn(async () => {
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next;
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const username = () => screen.getByRole('textbox', { name: 'Username' });
const password = () => screen.getByLabelText('Password');
const signIn = () => screen.getByRole('button', { name: /^Sign(ing)? in/ });

describe('LoginPage', () => {
  it("draws JagHelm's logo and labelled fields on the shared components", () => {
    render(<LoginPage onLogin={() => {}} />);
    // The lockup (shield, wordmark, tagline) is the page's h1, with no title
    // or subtitle beside it (#530).
    const heading = screen.getByRole('heading', { level: 1, name: 'JagHelm' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(heading.querySelector('img')).toHaveAttribute('src', '/logo-login.svg');
    expect(heading).toHaveTextContent(/^$/);
    expect(document.querySelectorAll('img')).toHaveLength(1);
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Sign in' })).toBeInTheDocument();
    expect(username()).toHaveAttribute('autocomplete', 'username');
    expect(password()).toHaveAttribute('type', 'password');
    expect(password()).toHaveAttribute('autocomplete', 'current-password');
    expect(signIn()).toHaveTextContent('Sign in');
    expect(username()).toHaveFocus();
  });

  it("in the light theme, the lockup's light version: only its text is darker", () => {
    render(<LoginPage onLogin={() => {}} theme="light" />);
    expect(document.querySelector('[data-slot="login-screen"]')).toHaveAttribute(
      'data-theme',
      'light'
    );
    const heading = screen.getByRole('heading', { level: 1, name: 'JagHelm' });
    expect(heading.querySelector('img')).toHaveAttribute('src', '/logo-login-light.svg');
  });

  it("draws App's name, logo and theme: a custom logo replaces the lockup", () => {
    for (const theme of ['dark', 'light']) {
      const { unmount } = render(
        <LoginPage onLogin={() => {}} theme={theme} name="Homelab" logoUrl="/my-logo.png" />
      );
      const heading = screen.getByRole('heading', { level: 1, name: 'Homelab' });
      const logos = document.querySelectorAll('img');
      expect(logos).toHaveLength(1);
      expect(heading).toContainElement(logos[0]);
      expect(logos[0]).toHaveAttribute('src', '/my-logo.png');
      expect(logos[0]).toHaveAttribute('alt', 'Homelab');
      unmount();
    }
  });

  it('a wrong password: the error is tied to the password field, and focus lands there', async () => {
    const user = userEvent.setup();
    stubFetch(json(401, { error: 'Invalid credentials' }));
    render(<LoginPage onLogin={() => {}} />);
    await user.type(username(), 'admin');
    await user.type(password(), 'wrong');
    await user.click(signIn());

    await waitFor(() => expect(password()).toHaveAttribute('aria-invalid', 'true'));
    expect(password()).toHaveAccessibleDescription('Wrong username or password.');
    expect(password()).toHaveFocus();
    // Its text is selected, so typing replaces it.
    expect([password().selectionStart, password().selectionEnd]).toEqual([0, 5]);
    expect(username()).not.toHaveAttribute('aria-invalid');
    expect(signIn()).toHaveTextContent('Sign in');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('the same wrong password twice moves focus back to the field again', async () => {
    const user = userEvent.setup();
    stubFetch(json(401, {}), json(401, {}));
    render(<LoginPage onLogin={() => {}} />);
    await user.type(username(), 'admin');
    await user.type(password(), 'wrong');
    await user.click(signIn());
    await waitFor(() => expect(password()).toHaveFocus());
    await user.click(signIn());
    await waitFor(() => expect(password()).toHaveFocus());
  });

  it('an empty field is named, with focus on the first one, and nothing is sent', async () => {
    const user = userEvent.setup();
    const fetch = stubFetch();
    render(<LoginPage onLogin={() => {}} />);
    await user.click(signIn());
    expect(username()).toHaveAttribute('aria-invalid', 'true');
    expect(username()).toHaveAccessibleDescription('Enter your username.');
    expect(password()).toHaveAccessibleDescription('Enter your password.');
    expect(username()).toHaveFocus();

    await user.type(username(), 'admin');
    await user.click(signIn());
    expect(username()).not.toHaveAttribute('aria-invalid');
    expect(password()).toHaveFocus();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('Enter submits; the button is busy and a second Enter sends nothing more', async () => {
    const user = userEvent.setup();
    let answer;
    const fetch = stubFetch(() => new Promise((resolve) => (answer = resolve)));
    const onLogin = vi.fn();
    render(<LoginPage onLogin={onLogin} />);
    await user.type(username(), 'admin');
    await user.type(password(), 'secret{Enter}'); // pragma: allowlist secret

    await waitFor(() => expect(signIn()).toHaveTextContent('Signing in…'));
    expect(signIn()).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Enter}');
    await user.click(signIn());
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('/api/auth/login');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ username: 'admin', password: 'secret' }); // pragma: allowlist secret

    await act(async () => answer(json(200, { token: 'tok-1', user: 'admin' })));
    expect(onLogin).toHaveBeenCalledWith('tok-1');
  });

  it("JagHelm not answering is the form's alert, not a field's error", async () => {
    const user = userEvent.setup();
    stubFetch(new TypeError('Failed to fetch'));
    render(<LoginPage onLogin={() => {}} />);
    await user.type(username(), 'admin');
    await user.type(password(), 'secret{Enter}'); // pragma: allowlist secret

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't sign in");
    expect(alert).toHaveTextContent("JagHelm didn't answer. Check the connection and try again.");
    expect(username()).not.toHaveAttribute('aria-invalid');
    expect(password()).not.toHaveAttribute('aria-invalid');
    expect(signIn()).toHaveTextContent('Sign in');
    expect(signIn()).not.toHaveAttribute('aria-disabled', 'true');
  });

  it("another refusal (too many attempts) says the server's reason in the alert", async () => {
    const user = userEvent.setup();
    stubFetch(json(429, { error: 'Too many login attempts. Try again in 15 minutes.' }));
    render(<LoginPage onLogin={() => {}} />);
    await user.type(username(), 'admin');
    await user.type(password(), 'secret{Enter}'); // pragma: allowlist secret

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Too many login attempts. Try again in 15 minutes.');
    expect(password()).not.toHaveAttribute('aria-invalid');
  });

  it("a field's error goes as soon as that field is edited; focus stays where you type", async () => {
    const user = userEvent.setup();
    stubFetch(json(401, {}));
    render(<LoginPage onLogin={() => {}} />);
    await user.click(signIn());
    expect(username()).toHaveAttribute('aria-invalid', 'true');
    expect(password()).toHaveAttribute('aria-invalid', 'true');

    await user.type(username(), 'a');
    expect(username()).not.toHaveAttribute('aria-invalid');
    expect(username()).not.toHaveAccessibleDescription();
    expect(username()).toHaveFocus();
    expect(password()).toHaveAccessibleDescription('Enter your password.');

    await user.type(password(), 'wrong{Enter}');
    await waitFor(() => expect(password()).toHaveAttribute('aria-invalid', 'true'));
    await user.keyboard('x');
    expect(password()).not.toHaveAttribute('aria-invalid');
    expect(password()).not.toHaveAccessibleDescription();
    expect(password()).toHaveValue('x');
  });
});
