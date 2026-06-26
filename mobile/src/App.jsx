import React, { useState, useEffect } from 'react';
import MobileApp from './MobileApp.jsx';
import Login from './Login.jsx';
import { secureStore } from '@shared/storage/index.js';
import { setAuthExpiredHandler, setAuthToken } from '@shared/api/client.js';
import { setPref } from './storage/prefsAdapter.js';
import { setAuthHandlers } from './auth/authState.js';
import { TOKEN_KEY, BASE_URL_KEY, URL_PRESENT_KEY, REMEMBER_KEY } from './runtimeConfig.js';

/**
 * Auth-aware shell with three states driven by { hasUrl, hasToken } from boot:
 *   no URL              → first-run Login (URL + credentials)
 *   URL but no token    → re-auth Login (credentials only, reuses the URL)
 *   URL + token         → the app
 * Registers the 401 self-heal hook (token expired/revoked → drop to re-auth) and
 * the user-initiated session controls (logout / forget-device) the settings
 * screen calls. Only a session token is ever cleared/persisted — never a password.
 */
export default function App({ initial }) {
  const [hasUrl, setHasUrl] = useState(initial.hasUrl);
  const [hasToken, setHasToken] = useState(initial.hasToken);
  const [knownUrl, setKnownUrl] = useState(initial.baseUrl || '');

  useEffect(() => {
    // Kill the session token and drop to re-auth — reached from a server-driven
    // 401 and from a user-initiated logout (same operation, one definition).
    // Flip REMEMBER off so the next boot wipes the token UNCONDITIONALLY even if
    // the Keystore delete here silently failed (the adapter swallows errors) —
    // otherwise a failed delete + remember==='true' would silently re-auth.
    const clearSession = async () => {
      await secureStore.removeItem(TOKEN_KEY);
      await setPref(REMEMBER_KEY, 'false');
      setAuthToken('');
      setHasToken(false);
    };

    setAuthExpiredHandler(clearSession);
    setAuthHandlers({
      logout: clearSession,
      forgetDevice: async () => {
        await clearSession();
        await secureStore.removeItem(BASE_URL_KEY);
        await setPref(URL_PRESENT_KEY, 'false');
        setHasUrl(false);
      },
    });

    return () => setAuthExpiredHandler(null);
  }, []);

  const onConnected = async () => {
    const b = await secureStore.getItem(BASE_URL_KEY);
    if (b) setKnownUrl(b);
    setHasUrl(true);
    setHasToken(true);
  };

  if (!hasUrl) return <Login askUrl onConnected={onConnected} />;
  if (!hasToken) return <Login askUrl={false} knownUrl={knownUrl} onConnected={onConnected} />;
  return <MobileApp />;
}
