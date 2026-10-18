/**
 * The storage side of signing out and of forgetting the server, defined once so
 * the callers cannot drift: logout and the 401 self-heal (clearSessionToken),
 * Forget this device and the connection screen's Change server (forgetServer).
 * React state stays in the components; the dependencies default to the real
 * stores and are injectable for tests.
 *
 * Keep-signed-in goes to 'false' right after the token delete. The Keystore
 * adapter swallows a failed delete, so the token can survive it silently; with
 * keep-signed-in off, the next boot drops the token unconditionally instead of
 * resuming the session. A step that throws stops the sequence and rejects.
 */
import { secureStore } from '@shared/storage/index.js';
import { setAuthToken } from '@shared/api/client.js';
import { setPref } from '../storage/prefsAdapter.js';
import { TOKEN_KEY, BASE_URL_KEY, URL_PRESENT_KEY, REMEMBER_KEY } from '../runtimeConfig.js';

const realDeps = { secureStore, setPref, setAuthToken };

/** Delete the session token, switch keep-signed-in off, clear the in-memory token. */
export async function clearSessionToken({ deps = realDeps } = {}) {
  await deps.secureStore.removeItem(TOKEN_KEY);
  await deps.setPref(REMEMBER_KEY, 'false');
  deps.setAuthToken('');
}

/**
 * clearSessionToken, then delete the saved server address and its breadcrumb.
 * onTokenCleared runs between the two halves (App drops to re-auth there, so a
 * failure removing the address still leaves the UI signed out).
 */
export async function forgetServer({ deps = realDeps, onTokenCleared = () => {} } = {}) {
  await clearSessionToken({ deps });
  onTokenCleared();
  await deps.secureStore.removeItem(BASE_URL_KEY);
  await deps.setPref(URL_PRESENT_KEY, 'false');
}
