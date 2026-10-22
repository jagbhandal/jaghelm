import { useRef, useState } from 'react';
import { LoginScreen } from '@ui/login-form';
import { apiFetch } from '../api/client.js';
import { THEMES } from './settings/themes.js';

/**
 * The sign-in page (#305): LoginScreen (src/ui/login-form.jsx) wired to
 * POST /api/auth/login. The token goes to onLogin, which stores it (App.jsx).
 *
 * A refused sign-in (401) is one error on the password field, whichever of
 * the two was wrong: the server says no more, so the page can't leak which
 * usernames exist. Any other refusal (too many attempts) says the server's
 * reason, and no answer at all says so, as the form's alert.
 */
const REJECTED = 'Wrong username or password.';
const NO_ANSWER = "JagHelm didn't answer. Check the connection and try again.";
const NONE = Object.freeze({});

/** The theme the page draws in: the stored theme's, as the shell picks it (App.jsx). */
function loginTheme(stored) {
  return THEMES.find((t) => t.id === stored)?.light ? 'light' : 'dark';
}

function storedTheme() {
  try {
    return localStorage.getItem('jaghelm-theme');
  } catch {
    return null;
  }
}

/** The instance's name, as the header shows it: the stock 'JAGHELM' reads as the product's. */
function instanceName(title) {
  const t = typeof title === 'string' ? title.trim() : '';
  return t && t !== 'JAGHELM' ? t : 'JagHelm';
}

export default function LoginPage({ onLogin, config }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState(NONE);
  const [busy, setBusy] = useState(false);
  const [theme] = useState(() => loginTheme(storedTheme()));
  // Set before the first await, so a second submit in the same tick sends nothing.
  const sending = useRef(false);

  const submit = async () => {
    if (sending.current) return;
    const missing = {};
    if (!username.trim()) missing.username = 'Enter your username.';
    if (!password) missing.password = 'Enter your password.'; // pragma: allowlist secret
    if (missing.username || missing.password) {
      setErrors(missing);
      return;
    }
    sending.current = true;
    setBusy(true);
    let next;
    try {
      const r = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await r.json();
      if (r.ok && data.token) {
        onLogin(data.token);
        return;
      }
      if (r.ok || r.status === 401) next = { password: REJECTED };
      else if (typeof data?.error === 'string' && data.error) next = { form: data.error };
      else next = { form: `JagHelm refused the sign-in (HTTP ${r.status}). Try again.` };
    } catch {
      next = { form: NO_ANSWER };
    }
    sending.current = false;
    setBusy(false);
    setErrors(next);
  };

  return (
    <LoginScreen
      theme={theme}
      name={instanceName(config?.title)}
      logoUrl={config?.logoUrl || undefined}
      username={username}
      password={password}
      onUsernameChange={setUsername}
      onPasswordChange={setPassword}
      errors={errors}
      busy={busy}
      onSubmit={submit}
      autoFocus
    />
  );
}
