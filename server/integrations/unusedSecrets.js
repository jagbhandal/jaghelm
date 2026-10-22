/**
 * The integration secrets services.yaml no longer uses (#415, #502).
 *
 * An integration's secrets are the `integration_*` names JagHelm writes for
 * it (keyedSecretName). One is in use while an entry's key makes it that
 * entry's keyed secret (`integration_<key>_url|username|password|token`, which
 * a preset resolves ahead of the entry's own reference, lib/config.js), or a
 * `$secret:` reference anywhere in the config names it. A reference is read
 * as generously as extract.js reads one (any case, spaces around it), so a
 * name that might be used is kept. Every other name in the store is the
 * user's own (PUT /api/secrets) and is never dropped here.
 *
 * services.yaml is the record: a save stores the secrets it needs before it
 * writes the file and puts the store back if the write fails, and a delete
 * or a rename drops what it frees after the file is written
 * (routes/integrations.js). A new integration clears what an older delete
 * left under its key. A crash between the two writes can only leave secrets
 * nothing uses; the check at boot counts those and deletes none, since a hand
 * edit (an entry commented out, a typo, a rename) makes a secret look unused
 * that is still wanted.
 */

import { CONFIG_ABSENT, readConfig } from '../config.js';
import { deleteSecrets, listSecretKeys } from '../secrets.js';
import { createLogger } from '../util/logger.js';
import { KEYED_SECRET_FIELDS, keyedSecretName } from './lib/config.js';

const log = createLogger('secrets');

const PREFIX = 'integration_';
const SECRET_REF = /^\s*\$secret:\s*(\S+)\s*$/i;

/** Every name a `$secret:` reference in `value`, at any depth, names. */
export function referencedNames(value, into = new Set()) {
  if (typeof value === 'string') {
    const ref = SECRET_REF.exec(value);
    if (ref) into.add(ref[1]);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) referencedNames(v, into);
  }
  return into;
}

/** The secret names `config` uses: its references, and each entry's keyed names. */
function usedNames(config) {
  const used = referencedNames(config, new Set());
  const integrations = config?.integrations;
  if (integrations && typeof integrations === 'object') {
    for (const key of Object.keys(integrations)) {
      for (const field of KEYED_SECRET_FIELDS) used.add(keyedSecretName(key, field));
    }
  }
  return used;
}

/**
 * The integration secrets among `names` that `config` doesn't use, in their
 * order. With `key`, only those named `integration_<key>_*`: what a delete of
 * that entry frees (another entry's keyed name that starts the same way, such
 * as `integration_npm_two_password` for `npm`, is in use while it exists).
 * @param {any} config
 * @param {string[]} names
 * @param {string} [key]
 */
export function unusedIntegrationSecrets(config, names, key) {
  const prefix = key === undefined ? PREFIX : `${PREFIX}${key}_`;
  const used = usedNames(config);
  return names.filter((name) => name.startsWith(prefix) && !used.has(name));
}

/**
 * Once `config` is written: drop the integration secrets among `names` it
 * doesn't use (with `key`, only that key's). Never throws: when secrets.json
 * can't be written they stay stored, and that is logged (how many, never
 * which). Returns how many were dropped.
 * @param {any} config
 * @param {string[]} names
 * @param {string} [key]
 */
export function dropUnusedIntegrationSecrets(config, names, key) {
  const unused = unusedIntegrationSecrets(config, names, key);
  try {
    return deleteSecrets(unused);
  } catch (err) {
    log.warn({ err, kept: unused.length }, 'Could not delete integration secrets no entry uses; kept');
    return 0;
  }
}

/**
 * At boot: say how many integration secrets services.yaml doesn't use, in
 * one line, never which, and delete none: they may still be wanted after a
 * hand edit (an entry commented out, a typo, a rename). Nothing is counted
 * while there is no services.yaml, or it can't be read or doesn't parse.
 * Never throws. Returns how many, or null when it didn't look.
 * @returns {number | null}
 */
export function reportUnusedIntegrationSecrets() {
  let read;
  try {
    read = readConfig();
  } catch (err) {
    log.warn({ err }, 'Could not read services.yaml to count unused integration secrets');
    return null;
  }
  const { config, version, unusable } = read;
  if (unusable || version === CONFIG_ABSENT || !config) return null;
  const unused = unusedIntegrationSecrets(config, listSecretKeys()).length;
  if (unused) {
    log.info({ unused }, 'Integration secrets no entry in services.yaml uses (kept)');
  }
  return unused;
}
