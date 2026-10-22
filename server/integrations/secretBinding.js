/**
 * Binding the secrets stored before #556 to the addresses they are used at.
 *
 * Since #556 each stored secret carries the origins it may be sent to
 * (secrets.js), and one with none goes nowhere. A secret stored before has no
 * origins at all. The first time services.yaml can be used after the
 * upgrade, each such secret is bound to the origin of every integration
 * entry that uses it: its keyed name (`integration_<key>_<field>`), or a
 * `$secret:` reference anywhere in the entry, read as generously as
 * unusedSecrets.js reads one. An entry's origin is its URL's as a refresh
 * resolves it (lib/config.js entryOrigin); a disabled entry counts. A secret
 * no entry uses is bound to none, and is entered again in the integration's
 * form when it is wanted. One write of secrets.json, one info line with the
 * counts (never a name or an origin).
 *
 * Once only: a bound secret is never bound again, so a reference added later
 * (the whole-config save, a hand edit) can't take a secret to a new address
 * at the next restart. While services.yaml is missing at boot, or can't be
 * used, nothing is bound and the unbound secrets go nowhere: the first good
 * load of a file from disk binds them (the user's file put back or fixed;
 * not the default one the first boot writes, nor a save in Settings). A
 * whole-config save meanwhile could name a waiting secret on an entry of its
 * own, for the next boot to bind it there, so each one it names is bound to
 * nowhere before it is written (settleSecretsNamedBy).
 */

import { CONFIG_ABSENT, onConfigChange, readConfig } from '../config.js';
import { bindSecretOrigins, unboundSecretNames } from '../secrets.js';
import { createLogger } from '../util/logger.js';
import { KEYED_SECRET_FIELDS, entryOrigin, keyedSecretName } from './lib/config.js';
import { referencedNames } from './unusedSecrets.js';

const log = createLogger('secrets');

/** services.yaml as it is now, or null while it is missing or can't be used. */
function usableConfig() {
  const read = readConfig();
  return read.unusable || read.version === CONFIG_ABSENT ? null : read.config || {};
}

/** The secret names an integration entry uses: its keyed names and its references. */
function namesUsedBy(key, entry) {
  const names = referencedNames(entry);
  for (const field of KEYED_SECRET_FIELDS) names.add(keyedSecretName(key, field));
  return names;
}

/**
 * Bind every unbound secret to the origins of the entries in `config` that
 * use it (services.yaml as it is now when omitted). Returns how many were
 * bound: 0 when none was unbound, or services.yaml can't be used. Never
 * throws: a secrets.json that can't be written is logged and binds none.
 * @param {any} [config] services.yaml as parsed ({} when there is none)
 */
export function bindUnboundSecrets(config = usableConfig()) {
  if (!config) return 0;
  const unbound = new Set(unboundSecretNames());
  if (unbound.size === 0) return 0;

  /** @type {Record<string, string[]>} */
  const byName = Object.fromEntries([...unbound].map((name) => [name, []]));
  const integrations = config?.integrations;
  if (integrations && typeof integrations === 'object') {
    for (const [key, entry] of Object.entries(integrations)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const origin = entryOrigin(key, entry);
      if (!origin) continue;
      for (const name of namesUsedBy(key, entry)) {
        if (unbound.has(name) && !byName[name].includes(origin)) byName[name].push(origin);
      }
    }
  }

  try {
    const bound = bindSecretOrigins(byName);
    const unused = Object.values(byName).filter((o) => o.length === 0).length;
    log.info(
      { secrets: bound, unused },
      'Stored credentials bound to the addresses of the integrations that use them; one no integration uses goes nowhere until entered again'
    );
    return bound;
  } catch (err) {
    log.warn({ err }, 'Could not bind stored credentials to their addresses; they go nowhere until it works');
    return 0;
  }
}

/**
 * Before a whole-config save writes `config`: bind each unbound secret one of
 * its integration entries uses to nowhere, so a save made while the binding
 * waits can't have a later boot bind it to an address the save chose.
 * Throws when secrets.json can't be written, so the save is refused.
 * @param {any} config
 */
export function settleSecretsNamedBy(config) {
  const unbound = new Set(unboundSecretNames());
  if (unbound.size === 0) return 0;
  /** @type {Record<string, string[]>} */
  const byName = {};
  const integrations = config?.integrations;
  if (integrations && typeof integrations === 'object') {
    for (const [key, entry] of Object.entries(integrations)) {
      if (!entry || typeof entry !== 'object') continue;
      for (const name of namesUsedBy(key, entry)) if (unbound.has(name)) byName[name] = [];
    }
  }
  return Object.keys(byName).length ? bindSecretOrigins(byName) : 0;
}

/**
 * At boot, before the first boot's discovery writes a default services.yaml:
 * bind the unbound secrets now, when services.yaml is there and can be used,
 * and answer how many; else answer null and bind them on its first good load
 * from disk, through `onChange` (the config watcher's listeners). Once.
 * @param {{ onChange?: (fn: (config?: any) => void) => void }} [opts]
 * @returns {number | null}
 */
export function bindSecretsAtBoot({ onChange = onConfigChange } = {}) {
  const config = usableConfig();
  if (config) return bindUnboundSecrets(config);

  let done = false;
  onChange(() => {
    if (done) return;
    const now = usableConfig();
    if (!now) return;
    done = true;
    bindUnboundSecrets(now);
  });
  return null;
}
