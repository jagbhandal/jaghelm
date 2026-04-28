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

  // For custom integrations (no preset), yamlConfig IS the full config
  const config = preset ? { ...preset, ...yamlConfig } : yamlConfig;
  if (!config) return null;

  // Use storage key for secret resolution (e.g. adguard_secondary instead of adguard)
  const secretKey = yamlConfig?._storageKey || type;

  // Resolve credentials
  const resolved = { ...config };

  if (preset?.envKeys) {
    // URL: .env > yaml > null
    if (preset.envKeys.url) {
      resolved.url = resolveCredential(preset.envKeys.url, `integration_${secretKey}_url`) || config.url;
    }
    // Username: .env > yaml > null
    if (preset.envKeys.username) {
      resolved._username = resolveCredential(preset.envKeys.username, `integration_${secretKey}_username`) || config.username;
    }
    // Password: .env > yaml ($secret:ref) > null
    if (preset.envKeys.password) {
      resolved._password = resolveCredential(preset.envKeys.password, `integration_${secretKey}_password`) || resolveSecretRef(config.password);
    }
    // Token: .env > yaml ($secret:ref) > null
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
