import React, { useState, useEffect } from 'react';
import MobileApp from './MobileApp.jsx';
import Login from './Login.jsx';
import { secureStore } from '@shared/storage/index.js';
import { setAuthExpiredHandler } from '@shared/api/client.js';
import { setAuthHandlers } from './auth/authState.js';
import { clearSessionToken, forgetServer } from './auth/forgetServer.js';
import { BASE_URL_KEY } from './runtimeConfig.js';

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
    // The storage steps and their order live in auth/forgetServer.js, shared
    // with the connection screen's Change server.
    const clearSession = async () => {
      await clearSessionToken();
      setHasToken(false);
    };

    setAuthExpiredHandler(clearSession);
    setAuthHandlers({
      logout: clearSession,
      forgetDevice: async () => {
        await forgetServer({ onTokenCleared: () => setHasToken(false) });
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
