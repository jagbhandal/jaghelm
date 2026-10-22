import React, { useState, useEffect } from 'react';
import MobileApp from './MobileApp.jsx';
import Login from './Login.jsx';
import { secureStore } from '@shared/storage/index.js';
import { getAuthToken, revokeSession, setAuthExpiredHandler } from '@shared/api/client.js';
import { getApiBase } from '@shared/api/baseUrl.js';
import { setAuthHandlers } from './auth/authState.js';
import { clearSessionToken, forgetServer } from './auth/forgetServer.js';
import { rememberCleanup } from './auth/pendingCleanup.js';
import { cachedPushToken, unregisterPush } from './push/registerPush.js';
import { BASE_URL_KEY } from './runtimeConfig.js';

/**
 * Auth-aware shell with three states driven by { hasUrl, hasToken } from boot:
 *   no URL              → first-run Login (URL + credentials)
 *   URL but no token    → re-auth Login (credentials only, reuses the URL)
 *   URL + token         → the app
 * Registers the 401 self-heal hook (token expired/revoked → drop to re-auth) and
 * the user-initiated session controls (logout / forget-device) the settings
 * screen calls. Both of those end the session, so they unregister push (#531)
 * and ask the server to revoke the session (#507) first; the self-heal does
 * neither, as its session is already dead. Only a session token is ever
 * cleared/persisted — never a password.
 */
export default function App({ initial }) {
  const [hasUrl, setHasUrl] = useState(initial.hasUrl);
  const [hasToken, setHasToken] = useState(initial.hasToken);
  const [knownUrl, setKnownUrl] = useState(initial.baseUrl || '');

  useEffect(() => {
    // Kill the session token and drop to re-auth — reached from a server-driven
    // 401 and from a user-initiated logout, right after its revoke request.
    // The storage steps and their order live in auth/forgetServer.js, shared
    // with the connection screen's Change server.
    const clearSession = async () => {
      await clearSessionToken();
      setHasToken(false);
    };

    setAuthExpiredHandler(clearSession);
    // Push is unregistered first (#531): DELETE /push/register needs the live
    // session, so it goes out before the revoke. The server then revokes the
    // session, so a copy of the token stops working too (#507). Both requests
    // go out at once with the token apiFetch holds; the phone then forgets the
    // token without waiting for either answer, so closing the app while the
    // server is slow can't leave it in the Keystore (neither call rejects, and
    // each gives up after 5 s). Only the cached push token is read first, from
    // the phone's own storage. What doesn't finish (offline, a hang) is kept
    // with the session it ended and retried later, to that server only (#539).
    const signOut = async (clearLocally) => {
      const serverUrl = getApiBase();
      const sessionToken = getAuthToken();
      const pushToken = await cachedPushToken();
      const push = unregisterPush(pushToken);
      const revoked = revokeSession();
      const remembered = rememberCleanup({ serverUrl, sessionToken, pushToken, push, revoked });
      await clearLocally();
      await remembered;
    };
    setAuthHandlers({
      logout: () => signOut(clearSession),
      forgetDevice: () =>
        signOut(async () => {
          await forgetServer({ onTokenCleared: () => setHasToken(false) });
          setHasUrl(false);
        }),
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
