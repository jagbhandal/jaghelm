/**
 * Mobile boot sequence (must run before any data hook fires):
 *   setStorageAdapter(keystoreAdapter)  → swap secrets to the Keystore
 *   installNativeHttp()                 → default transport (native HTTP)
 *   await initAuthToken()               → seed apiFetch's in-memory token
 *   read stored base from Keystore      → setApiBase() if configured
 * Returns { configured } so the shell can route to FirstRun on a cold start.
 */
import { setStorageAdapter, secureStore } from '@shared/storage/index.js';
import { initAuthToken } from '@shared/api/client.js';
import { setApiBase } from '@shared/api/baseUrl.js';
import { keystoreAdapter } from './storage/keystoreAdapter.js';
import { installNativeHttp } from './nativeHttp.js';
import { BASE_URL_KEY } from './runtimeConfig.js';

export async function bootMobile() {
  setStorageAdapter(keystoreAdapter);
  installNativeHttp();
  await initAuthToken();
  const base = await secureStore.getItem(BASE_URL_KEY);
  if (base) {
    setApiBase(base);
    return { configured: true };
  }
  return { configured: false };
}
