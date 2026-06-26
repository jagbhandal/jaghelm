import React, { useState } from 'react';
import { login } from './login.js';
import { validateLogin, normalizeBaseUrl, BASE_URL_KEY, TOKEN_KEY, URL_PRESENT_KEY, REMEMBER_KEY } from './runtimeConfig.js';
import { secureStore } from '@shared/storage/index.js';
import { setPref } from './storage/prefsAdapter.js';
import './Login.css';

/**
 * Login screen for Path A (direct-over-tailnet). Two modes:
 *   - askUrl (first run): backend URL + username + password.
 *   - !askUrl (re-auth):  username + password only, reusing `knownUrl`.
 * On success login() has already set the in-memory token + base; here we persist
 * the URL + the token PER the keep-signed-in choice. The token — never the
 * password — is what lands in the Keystore, and only when "keep me signed in" is
 * on; session-only logins keep the token in memory and wipe any at-rest copy.
 */
export default function Login({ askUrl = true, knownUrl = '', onConnected }) {
  const [url, setUrl] = useState(knownUrl);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setServerError('');
    const effectiveUrl = askUrl ? url : knownUrl;
    const v = validateLogin({ url: effectiveUrl, username, password, askUrl });
    setErrors(v.errors);
    if (!v.ok) return;

    setBusy(true);
    const result = await login({ url: effectiveUrl, username, password });
    setBusy(false);
    if (!result.ok) {
      setServerError(result.error || `HTTP ${result.status}`);
      return;
    }

    const base = normalizeBaseUrl(effectiveUrl);
    await secureStore.setItem(BASE_URL_KEY, base);
    await setPref(URL_PRESENT_KEY, 'true');
    await setPref(REMEMBER_KEY, remember ? 'true' : 'false');
    if (remember) {
      await secureStore.setItem(TOKEN_KEY, result.token);
    } else {
      // Session-only: never leave the token at rest between launches.
      await secureStore.removeItem(TOKEN_KEY);
    }
    onConnected();
  };

  return (
    <form className="firstrun" onSubmit={onSubmit}>
      <h1>{askUrl ? 'Connect to JagHelm' : 'Sign in'}</h1>
      {askUrl && (
        <>
          <label>
            Backend URL
            <input
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="http://<tailnet-ip>:3099"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          {errors.url && <span className="err">{errors.url}</span>}
        </>
      )}
      {!askUrl && knownUrl && <p className="note">Connected to {knownUrl}</p>}
      <label>
        Username
        <input
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </label>
      {errors.username && <span className="err">{errors.username}</span>}
      <label>
        Password
        <input
          type="password"
          autoCapitalize="none"
          autoCorrect="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {errors.password && <span className="err">{errors.password}</span>}
      <label className="remember-row">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />
        Keep me signed in on this device
      </label>
      <button type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      {serverError && <span className="err">{serverError}</span>}
      <p className="note">
        Your phone reaches the backend over the tailnet. Only a session token is
        stored in the Android Keystore — never your password.
      </p>
    </form>
  );
}
