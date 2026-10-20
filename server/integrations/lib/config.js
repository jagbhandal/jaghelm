import { createHash } from 'node:crypto';

import { getPresetFull } from '../registry.js';
import { resolveCredential, getSecret } from '../../secrets.js';

/**
 * Credential resolution and config merging for integrations.
 *
 * resolveIntegrationConfig merges three sources, in this precedence:
 *   .env vars  >  services.yaml config  >  preset defaults
 *
 * Resolved credentials are placed under _-prefixed keys (_username, _password,
 * _token) so the original yaml fields ($secret:refs, plain values) remain
 * available unmodified for callers that need them.
 */

/** Resolve $secret:key_name references to decrypted values. */
function resolveSecretRef(value) {
  if (!value || typeof value !== 'string') return value;
  if (value.startsWith('$secret:')) {
    return getSecret(value.slice(8)) || null;
  }
  return value;
}

/**
 * Resolve integration config from services.yaml + secrets.
 * Merges: preset defaults < services.yaml config < .env overrides.
 *
 * For custom integrations (no preset), yamlConfig IS the full config.
 */
export function resolveIntegrationConfig(type, yamlConfig) {
  const preset = getPresetFull(type);

  // A preset flagged `unsupported` must never be fetched or polled, even if a
  // config for it was saved directly or imported before the flag existed. The
  // gallery hides it, but the refresh loop resolves through here, so block at
  // this chokepoint — fetchIntegration treats null as "don't fetch".
  if (preset?.unsupported) return null;

  // For custom integrations (no preset), yamlConfig IS the full config
  const config = preset ? { ...preset, ...yamlConfig } : yamlConfig;
  if (!config) return null;

  // Use storage key for secret resolution (e.g. adguard_secondary instead of adguard)
  const secretKey = yamlConfig?._storageKey || type;

  // Resolve credentials
  const resolved = { ...config };

  if (preset?.envKeys) {
    if (preset.envKeys.url) {
      resolved.url = resolveCredential(preset.envKeys.url, `integration_${secretKey}_url`) || config.url;
    }
    if (preset.envKeys.username) {
      resolved._username = resolveCredential(preset.envKeys.username, `integration_${secretKey}_username`) || config.username;
    }
    if (preset.envKeys.password) {
      resolved._password = resolveCredential(preset.envKeys.password, `integration_${secretKey}_password`) || resolveSecretRef(config.password);
    }
    if (preset.envKeys.token) {
      resolved._token = resolveCredential(preset.envKeys.token, `integration_${secretKey}_token`) || resolveSecretRef(config.token);
    }
  } else {
    // Custom integration — resolve $secret: refs in credentials
    resolved._username = config.username;
    resolved._password = resolveSecretRef(config.password);
    resolved._token = resolveSecretRef(config.token);
  }

  return resolved;
}

/**
 * A fingerprint of an integration's config, for the refresh loop's backoff
 * (#239): a rejected login is not sent again until this changes. It covers the
 * integration's entry in services.yaml and the URL and credentials it resolves
 * to, so a hand edit, a save in Settings, and a credential changed only in the
 * secrets store (the entry still names the same `$secret:`) each change it. A
 * hash, so the backoff state holds no credential.
 */
export function configFingerprint(type, yamlConfig) {
  const resolved = resolveIntegrationConfig(type, yamlConfig);
  const material = JSON.stringify([
    yamlConfig ?? null,
    resolved?.url ?? null,
    resolved?._username ?? null,
    resolved?._password ?? null,
    resolved?._token ?? null,
  ]);
  return createHash('sha256').update(material).digest('hex');
}
