import React, { useState } from 'react';
import { testConnection } from './connect.js';
import { validateFirstRun, normalizeBaseUrl, BASE_URL_KEY, TOKEN_KEY, URL_PRESENT_KEY } from './runtimeConfig.js';
import { secureStore } from '@shared/storage/index.js';
import { setPref } from './storage/prefsAdapter.js';
import './FirstRun.css';

export default function FirstRun({ onConnected }) {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setServerError('');
    const v = validateFirstRun({ url, token });
    setErrors(v.errors);
    if (!v.ok) return;

    setBusy(true);
    const result = await testConnection({ url, token });
    setBusy(false);
    if (!result.ok) {
      setServerError(result.error || `HTTP ${result.status}`);
      return;
    }
    // Success: persist secrets to the Keystore, presence breadcrumb to Preferences.
    const base = normalizeBaseUrl(url);
    await secureStore.setItem(TOKEN_KEY, token.trim());
    await secureStore.setItem(BASE_URL_KEY, base);
    await setPref(URL_PRESENT_KEY, 'true');
    onConnected();
  };

  return (
    <form className="firstrun" onSubmit={onSubmit}>
      <h1>Connect to JagHelm</h1>
      <label>
        Backend URL
        <input
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          placeholder="http://vm-101:3099"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      {errors.url && <span className="err">{errors.url}</span>}
      <label>
        Access token
        <input
          type="password"
          autoCapitalize="none"
          autoCorrect="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </label>
      {errors.token && <span className="err">{errors.token}</span>}
      <button type="submit" disabled={busy}>
        {busy ? 'Connecting…' : 'Test & Connect'}
      </button>
      {serverError && <span className="err">{serverError}</span>}
      <p className="note">
        Your backend must be reachable on the tailnet. The URL and token are stored
        in the Android Keystore — never in plain storage.
      </p>
    </form>
  );
}
