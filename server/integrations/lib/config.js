import { createHash } from 'node:crypto';

import { getPresetFull } from '../registry.js';
import { credentialFromEnv, resolveCredential, getSecret, getSecretOrigins, hasSecret } from '../../secrets.js';
import { allowedOrigins, originOf } from './origin.js';
import { storedUrlCredentialError } from './urlCredential.js';
import { createLogger } from '../../util/logger.js';

const log = createLogger('integrations');

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
 *
 * A credential whose stored secret is there but won't decrypt, and that
 * nothing else filled in, is listed in `_unreadableCredentials` (#428), so
 * credentialToSend (extract.js) refuses to send it rather than send it empty.
 *
 * A credential read from the secrets store goes only to the origins it was
 * entered for (#556): the resolved config carries `_credentialOrigins`, the
 * origins every stored credential it resolved allows, which each request
 * checks its URL against (lib/origin.js). A credential from `.env`, or one
 * typed into services.yaml by hand, adds none: both are trusted as access to
 * the host and its files. The URL (`url`, or the keyed `url` secret) is the
 * address itself, not a credential.
 *
 * A resolved URL that carries a credential (urlCredential in util/redact.js:
 * `user:pass@`, one the parser reads as `host:port`, `?apikey=`), from the
 * entry, its `.env` variable or the keyed `url` secret, is refused here, the
 * one place every refresh, connection test and origin reads it (#422, #419):
 * `url` is null and `_urlProblem` says why, naming where it came from, never
 * the value. fetchIntegration then requests nothing and fails with it, and it
 * is warned once (warnUrlProblem).
 */

// The refused URL each integration was last warned for, by storage key: one
// warn line until the problem changes or the URL is fixed.
const warnedUrlProblems = new Map();

/**
 * Warn once that the integration stored under `key` has its URL refused, and
 * forget it once the URL is used again.
 * @param {string} key
 * @param {string | null} problem
 */
function warnUrlProblem(key, problem) {
  if (!problem) {
    warnedUrlProblems.delete(key);
    return;
  }
  if (warnedUrlProblems.get(key) === problem) return;
  warnedUrlProblems.set(key, problem);
  log.warn({ integration: key }, problem);
}

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

/**
 * What the refresh loop hands the handler for the entry stored under `key`:
 * the type it fetches as (the entry's preset, else the key: a custom
 * integration) and the entry with its storage key. The connection test hands
 * over a form merged into the entry the same way (#427), so the two build the
 * same request.
 * @param {string} key
 * @param {object} entry
 */
export function integrationInput(key, entry) {
  return { type: entry.preset || key, yamlConfig: { ...entry, _storageKey: key } };
}

/** Resolve $secret:key_name references to decrypted values. */
function resolveSecretRef(value, read) {
  if (!value || typeof value !== 'string') return value;
  if (value.startsWith('$secret:')) {
    return read(value.slice(8)) || null;
  }
  return value;
}

/**
 * Resolve integration config from services.yaml + secrets.
 * Merges: preset defaults < services.yaml config < .env overrides.
 *
 * For custom integrations (no preset), yamlConfig IS the full config.
 *
 * `secrets`, from the connection test (#427): a secret name it holds reads as
 * its value and origins there (null: none), in place of the store's, so a
 * password typed into the form resolves as it will once the save has stored
 * it, for the address it was typed for (#556).
 *
 * @param {string} type
 * @param {any} yamlConfig
 * @param {{ secrets?: Map<string, { value: string | null, origins: string[] } | null> }} [opts]
 */
export function resolveIntegrationConfig(type, yamlConfig, { secrets } = {}) {
  const overlay = (name) => (secrets && secrets.has(name) ? secrets.get(name) || { value: null, origins: [] } : null);
  const readValue = (name) => {
    const o = overlay(name);
    return o ? o.value : getSecret(name);
  };
  // The origins of each credential read from the store, for _credentialOrigins.
  const stored = [];
  // Whether the credential being resolved read a secret the store holds but
  // can't decrypt (credential, below).
  let undecryptable = false;
  const readCredential = (name) => {
    const value = readValue(name);
    if (value) {
      const o = overlay(name);
      stored.push(o ? o.origins || [] : getSecretOrigins(name) || []);
    } else if (!overlay(name) && hasSecret(name)) {
      undecryptable = true;
    }
    return value;
  };
  // The credentials left empty though a secret for them is stored, which won't
  // decrypt, for _unreadableCredentials (#428): a keyed secret is read by name
  // with no `$secret:` in the entry to tell it was meant to be there.
  const unreadable = [];
  const credential = (field, resolve) => {
    undecryptable = false;
    const value = resolve();
    if (!value && undecryptable) unreadable.push(field);
    return value;
  };
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
  // Where the URL came from, for its refusal: the .env variable (by the name
  // it is set under, its JAGHELM_ one or its old one, #249), the keyed url
  // secret, or (null) the entry.
  let urlFrom = null;

  if (preset?.envKeys) {
    if (preset.envKeys.url) {
      const secretName = keyedSecretName(secretKey, 'url');
      const fromEnv = credentialFromEnv(preset.envKeys.url);
      const fromSecret = fromEnv ? null : readValue(secretName);
      if (fromEnv) urlFrom = { env: fromEnv.from };
      else if (fromSecret) urlFrom = { secret: secretName };
      resolved.url = fromEnv?.value || fromSecret || config.url;
    }
    for (const field of ['username', 'password', 'token']) {
      if (!preset.envKeys[field]) continue;
      resolved[`_${field}`] = credential(field, () =>
        resolveCredential(preset.envKeys[field], keyedSecretName(secretKey, field), readCredential) ||
        resolveSecretRef(config[field], readCredential)
      );
    }
  } else {
    // Custom integration — resolve $secret: refs in credentials
    for (const field of ['username', 'password', 'token']) {
      resolved[`_${field}`] = credential(field, () => resolveSecretRef(config[field], readCredential));
    }
  }
  resolved._credentialOrigins = allowedOrigins(stored);
  resolved._unreadableCredentials = unreadable;

  const urlProblem = storedUrlCredentialError(resolved.url, preset, urlFrom);
  if (urlProblem) {
    resolved.url = null;
    resolved._urlProblem = urlProblem;
  }
  warnUrlProblem(secretKey, urlProblem);

  return resolved;
}

/**
 * The origin the integration stored under `key` sends its requests to: its
 * URL's, as resolved for a refresh (preset defaults, `.env`, the keyed `url`
 * secret), or null when it has none (lib/origin.js). `secrets` as for
 * resolveIntegrationConfig.
 * @param {string} key
 * @param {object} entry
 * @param {{ secrets?: Map<string, { value: string | null, origins: string[] } | null> }} [opts]
 */
export function entryOrigin(key, entry, opts) {
  const { type, yamlConfig } = integrationInput(key, entry);
  return originOf(resolveIntegrationConfig(type, yamlConfig, opts)?.url);
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
