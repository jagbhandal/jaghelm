/*
 * The sign-in screen (spec §8 "Login", #305), on the shared components:
 * JagHelm's logo over a Panel titled "Sign in" that holds the form (#530). The
 * logo is the lockup, the shield over the JAGHELM wordmark and "Infrastructure
 * Dashboard" (public/logo-login.svg, drawn for dark; public/logo-login-light.svg
 * in the light theme, the same artwork with only its text darker), or the
 * instance's own logo when `logoUrl` is set, 156px tall. It is the page's h1,
 * the instance's name its text alternative. No title or subtitle beside it.
 *
 *  LoginForm    the logo and the card: a labelled Field per control
 *               (Username, Password), and the primary "Sign in" button, the
 *               width of the card. Controlled: `username`, `password`,
 *               `onUsernameChange(value)`, `onPasswordChange(value)`.
 *               `errors` is `{ username, password, form }`: a field's error
 *               sits under it, in its aria-describedby, and makes it
 *               aria-invalid, until that field is edited; `form`, a
 *               failure no field caused (JagHelm didn't answer), is a crit
 *               Banner over the fields, an alert.
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
import { useContext, useEffect, useRef, useState } from 'react';
import { Banner } from './banner.jsx';
import { Button } from './button.jsx';
import { Field } from './field.jsx';
import { Input } from './input.jsx';
import { Panel } from './panel.jsx';
import { UiRoot } from './root.jsx';
import { RootSwitchesContext, SWITCHES } from './lib/portal.js';
import { cn } from './lib/utils.js';

/** The lockup, by theme: its viewBox is 300 × 270, drawn here 156px tall. */
const LOCKUP = { dark: '/logo-login.svg', light: '/logo-login-light.svg' };
const LOCKUP_SIZE = { width: 173, height: 156 };

const NO_ERRORS = Object.freeze({});
const NONE_EDITED = Object.freeze([]);
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
  const light = useContext(RootSwitchesContext)?.[SWITCHES.theme.attribute] === 'light';
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

  // The fields edited since `errors` came: their errors are gone (and with
  // them aria-invalid), while `errors` itself, and so the focus, stay as given.
  const [edited, setEdited] = useState({ errors, fields: NONE_EDITED });
  const editedNow = edited.errors === errors ? edited.fields : NONE_EDITED;
  const error = (field) => (editedNow.includes(field) ? undefined : errors[field]);
  const change = (field, onChange) => (event) => {
    if (errors[field] && !editedNow.includes(field)) {
      setEdited({ errors, fields: [...editedNow, field] });
    }
    onChange?.(event.target.value);
  };

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
      <h1 className="flex justify-center">
        {logoUrl ? (
          <img src={logoUrl} alt={name} className="h-39 w-auto max-w-full object-contain" />
        ) : (
          <img
            src={light ? LOCKUP.light : LOCKUP.dark}
            alt={name}
            {...LOCKUP_SIZE}
            className="h-39 w-auto"
          />
        )}
      </h1>
      <Panel title="Sign in">
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          {errors.form ? (
            <Banner role="alert" tone="crit" title="Couldn't sign in" cause={errors.form} />
          ) : null}
          <Field label="Username" error={error('username')}>
            <Input
              ref={inputs.username}
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus={autoFocus}
              value={username}
              onChange={change('username', onUsernameChange)}
            />
          </Field>
          <Field label="Password" error={error('password')}>
            <Input
              ref={inputs.password}
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={change('password', onPasswordChange)}
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
