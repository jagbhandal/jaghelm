/**
 * Capacitor Preferences wrapper for NON-secret UI state only (theme, last tab,
 * backend-URL-presence breadcrumb). Scheme-independent native storage, never
 * WebView localStorage. NEVER store secrets here — secrets go to keystoreAdapter.
 */
import { Preferences } from '@capacitor/preferences';

export async function getPref(k) {
  const { value } = await Preferences.get({ key: k });
  return value ?? null;
}

export async function setPref(k, v) {
  await Preferences.set({ key: k, value: String(v) });
}
