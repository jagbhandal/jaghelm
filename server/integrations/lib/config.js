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
 * available unmodified for callers that need them. Whatever sends a credential
 * reads the _ key: auth headers, query auth, and an endpoint's {token},
 * {password} or {username} (resolveEndpoint in extract.js, #425).
 */

/**
 * The secrets a preset's credentials resolve from by the integration's storage
 * key, ahead of the `$secret:` reference in its entry:
 * `integration_<key>_<field>`. A save in Settings stores a typed password or
 * token under these names, and moves them with an entry whose key changes
 * (routes/integrations.js), so a secret left under the new key can't stand in
 * for the entry's own.
 */
export const KEYED_SECRET_FIELDS = Object.freeze(['url', 'username', 'password', 'token']);

/** The name of an integration's keyed secret, such as integration_npm_password. */
export function keyedSecretName(key, field) {
  return `integration_${key}_${field}`;
}

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
      resolved.url = resolveCredential(preset.envKeys.url, keyedSecretName(secretKey, 'url')) || config.url;
    }
    if (preset.envKeys.username) {
      resolved._username = resolveCredential(preset.envKeys.username, keyedSecretName(secretKey, 'username')) || config.username;
    }
    if (preset.envKeys.password) {
      resolved._password = resolveCredential(preset.envKeys.password, keyedSecretName(secretKey, 'password')) || resolveSecretRef(config.password);
    }
    if (preset.envKeys.token) {
      resolved._token = resolveCredential(preset.envKeys.token, keyedSecretName(secretKey, 'token')) || resolveSecretRef(config.token);
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
 * (#239): a refused login is not sent again until this changes. It covers the
 * integration's entry in services.yaml (`yamlConfig`) and the URL and
 * credentials it resolves to (`resolved`, from resolveIntegrationConfig), so a
 * hand edit, a save in Settings, and a credential changed only in the secrets
 * store (the entry still names the same `$secret:`) each change it. A hash, so
 * the backoff state holds no credential.
 */
export function configFingerprint(yamlConfig, resolved) {
  const material = JSON.stringify([
    yamlConfig ?? null,
    resolved?.url ?? null,
    resolved?._username ?? null,
    resolved?._password ?? null,
    resolved?._token ?? null,
  ]);
  return createHash('sha256').update(material).digest('hex');
}
