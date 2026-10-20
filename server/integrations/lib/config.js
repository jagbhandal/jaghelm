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

// The keys a save in Settings writes (routes/integrations.js POST /save),
// besides the preset's own urlParams.
const SETTINGS_KEYS = new Set(['url', 'enabled', 'preset', 'instance', 'target', 'username', 'password', 'token']);

/**
 * Whether services.yaml holds `entry` under `key` exactly as a save in Settings
 * writes it, so that saving it again from Settings keeps it: a preset, stored
 * under the key Settings derives from its preset and instance, with its
 * password and token (if any) under the secret names Settings gives them, and
 * nothing the form does not send. A custom integration, or an entry written or
 * extended by hand, is not: the save rebuilds the entry from the form and drops
 * the rest (#402). The refresh loop uses it to say how to retry an integration
 * whose login was refused (#239).
 */
export function savedFromSettings(key, entry) {
  if (!entry || typeof entry !== 'object') return false;
  const preset = typeof entry.preset === 'string' ? getPresetFull(entry.preset) : null;
  if (!preset) return false;
  const { instance } = entry;
  // Settings lowercases an instance name and keeps only a-z, 0-9 and "-".
  if (instance !== undefined && !(typeof instance === 'string' && /^[a-z0-9-]+$/.test(instance))) {
    return false;
  }
  if (key !== (instance ? `${entry.preset}_${instance}` : entry.preset)) return false;
  const params = new Set((preset.urlParams || []).map((p) => p.key));
  for (const [k, v] of Object.entries(entry)) {
    if (k === 'password' || k === 'token') {
      if (v !== `$secret:integration_${key}_${k}`) return false;
    } else if (!SETTINGS_KEYS.has(k) && !params.has(k)) {
      return false;
    }
  }
  return true;
}
