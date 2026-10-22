/*
 * The sign-in screen (spec §8 "Login", #305), on the shared components: one
 * brand mark, the header's (the helm mark on the accent, or the instance's own
 * logo, then its name, as the page's h1), over a Panel titled "Sign in" that
 * holds the form. No wordmark, gradient title or subtitle.
 *
 *  LoginForm    the brand and the card: a labelled Field per control
 *               (Username, Password), and the primary "Sign in" button, the
 *               width of the card. Controlled: `username`, `password`,
 *               `onUsernameChange(value)`, `onPasswordChange(value)`.
 *               `errors` is `{ username, password, form }`: a field's error
 *               sits under it, in its aria-describedby, and makes it
 *               aria-invalid; `form`, a failure no field caused (JagHelm
 *               didn't answer), is a crit Banner over the fields, an alert.
 *               Each new `errors` with a field error moves focus to the first
 *               invalid field and selects its text, so typing replaces it; the
 *               first render never takes focus (`autoFocus` puts it on
 *               Username). Enter in either field submits. While `busy` the
 *               button says "Signing in…", is disabled but keeps focus, and a
 *               submit does nothing, so a sign-in can't be sent twice.
 *  LoginScreen  the page: a UiRoot in `theme`, filling the window, the form
 *               centred in it at most 360px wide, with a 16px gutter on a
 *               phone. Takes LoginForm's props.
 *
 * It sends nothing itself: `onSubmit()` is the page's (src/components/LoginPage.jsx).
 */
import { useEffect, useRef } from 'react';
import { Banner } from './banner.jsx';
import { Button } from './button.jsx';
import { Field } from './field.jsx';
import { HelmMark } from './app-header.jsx';
import { Input } from './input.jsx';
import { Panel } from './panel.jsx';
import { UiRoot } from './root.jsx';
import { cn } from './lib/utils.js';

const NO_ERRORS = Object.freeze({});
/** The fields in screen order: focus goes to the first invalid one. */
const ORDER = ['username', 'password'];

function LoginForm({
  name = 'JagHelm',
  logoUrl,
  username = '',
  password = '',
  onUsernameChange,
  onPasswordChange,
  errors = NO_ERRORS,
  busy = false,
  onSubmit,
  autoFocus = false,
  className,
  ...props
}) {
  const inputs = { username: useRef(null), password: useRef(null) };
  // The errors last focused for; the first render's are taken as seen, so
  // mounting with an error (the gallery) never takes the page's focus.
  const seen = useRef(errors);
  useEffect(() => {
    if (errors === seen.current) return;
    seen.current = errors;
    const first = ORDER.find((field) => errors[field]);
    const input = first && inputs[first].current;
    if (input) {
      input.focus();
      input.select();
    }
  });

  const submit = (event) => {
    event.preventDefault();
    if (!busy) onSubmit?.();
  };

  return (
    <div
      data-slot="login-form"
      className={cn('flex w-full max-w-90 flex-col gap-6', className)}
      {...props}
    >
      <div className="flex items-center justify-center gap-3">
        {logoUrl ? (
          <img src={logoUrl} alt="" className="size-10 shrink-0 rounded-xl object-contain" />
        ) : (
          <HelmMark className="size-10 rounded-xl [&_svg]:size-6" />
        )}
        <h1 className="text-title font-extrabold text-text-1">{name}</h1>
      </div>
      <Panel title="Sign in">
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          {errors.form ? (
            <Banner role="alert" tone="crit" title="Couldn't sign in" cause={errors.form} />
          ) : null}
          <Field label="Username" error={errors.username}>
            <Input
              ref={inputs.username}
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus={autoFocus}
              value={username}
              onChange={(e) => onUsernameChange?.(e.target.value)}
            />
          </Field>
          <Field label="Password" error={errors.password}>
            <Input
              ref={inputs.password}
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => onPasswordChange?.(e.target.value)}
            />
          </Field>
          <Button
            type="submit"
            variant="primary"
            className="mt-1 w-full"
            disabled={busy}
            focusableWhenDisabled
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Panel>
    </div>
  );
}

function LoginScreen({ theme, ...props }) {
  return (
    <UiRoot
      theme={theme}
      data-slot="login-screen"
      className="relative flex min-h-dvh items-center justify-center px-4 py-10"
    >
      <main className="flex w-full justify-center">
        <LoginForm {...props} />
      </main>
    </UiRoot>
  );
}

export { LoginForm, LoginScreen };
