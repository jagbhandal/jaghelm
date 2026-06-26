/**
 * Android Keystore-backed secure storage (EncryptedSharedPreferences via
 * capacitor-secure-storage-plugin). Drop-in for setStorageAdapter() — same
 * async shape as the desktop webStorage default. SECRETS ONLY (token, backend
 * URL). getItem returns null on a missing key (the plugin rejects), never throws.
 */
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

export const keystoreAdapter = {
  async getItem(k) {
    try {
      const { value } = await SecureStoragePlugin.get({ key: k });
      return value ?? null;
    } catch {
      return null; // missing key → plugin rejects; treat as absent
    }
  },
  async setItem(k, v) {
    await SecureStoragePlugin.set({ key: k, value: String(v) });
  },
  async removeItem(k) {
    await SecureStoragePlugin.remove({ key: k });
  },
};
