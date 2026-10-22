/**
 * A stored credential doesn't follow its entry to a new address (#556).
 *
 * One check for both writers that keep a stored credential without its being
 * sent again: the integration form (a blank password or token keeps it, and
 * whatever the form doesn't own stays as it is) and the whole-config save (a
 * `{ "$stored": true }` marker, util/configMask.js). When an edit moves an
 * entry's URL to another origin (host, port or scheme, as a refresh resolves
 * it), a credential it keeps is refused, naming its place: it is entered
 * again for the new address. A credential is anything the config read masks
 * on the entry (a password or token, plaintext or `$secret:`, a header under
 * extraHeaders, a loginBody, an endpoint's key, a placeholder's value), the
 * keyed password or token a preset resolves ahead of the entry, or a
 * username that is a `$secret:` reference. It is kept when the edited entry
 * still holds the stored value. Every request stays on the URL's origin
 * (lib/origin.js), so only the URL can move one.
 */

import { isDeepStrictEqual } from 'node:util';

import { hasSecret } from '../secrets.js';
import { isStoredMarker, maskCredentials } from '../util/configMask.js';
import { entryOrigin, keyedSecretName } from './lib/config.js';
import { looksLikeSecretRef } from './lib/extract.js';
import { getPresetFull, listPresets } from './registry.js';

/**
 * What the masking needs to know about the presets: each entry's preset (its
 * endpoints' placeholders are masked on the entry), as the refresh loop picks
 * it, and every URL parameter a preset's form shows and saves (never masked).
 */
export function configMaskOptions() {
  return {
    presetOf: (/** @type {string} */ key, /** @type {any} */ entry) =>
      getPresetFull(entry?.preset || key),
    urlParamKeys: listPresets().flatMap((p) => (p.urlParams || []).map((u) => u.key)),
  };
}

/** Each credential the config read masks on `entry`: its place and value. */
function credentialPlaces(key, entry) {
  const masked = maskCredentials({ integrations: { [key]: entry } }, configMaskOptions()).integrations[key];
  const places = [];
  const walk = (m, v, path) => {
    if (isStoredMarker(m) && !isStoredMarker(v)) {
      places.push({ path, value: v });
      return;
    }
    if (m && typeof m === 'object' && v && typeof v === 'object') {
      for (const k of Object.keys(m)) walk(m[k], v[k], [...path, Array.isArray(m) ? Number(k) : k]);
    }
  };
  walk(masked, entry, []);
  return places;
}

/**
 * The place of the first stored credential `after` keeps from `before` while
 * its URL moves to another origin: `{ path, field }`, the path from the entry
 * and the form field it is (password, token or username; null for one the
 * form has no field for). Null when the origin stays, or nothing is kept.
 *
 * @param {{
 *   beforeKey: string, before: any, afterKey: string, after: any,
 *   typed?: { password?: unknown, token?: unknown },
 *   secrets?: Map<string, any>,
 * }} edit `typed`: a password or token the form typed (it replaces, so it
 *   is not kept); `secrets`: the overlay the merged entry resolves with
 *   (resolveIntegrationConfig).
 * @returns {{ path: Array<string|number>, field: string | null } | null}
 */
export function movedCredential({ beforeKey, before, afterKey, after, typed = {}, secrets }) {
  if (entryOrigin(afterKey, after, { secrets }) === entryOrigin(beforeKey, before)) return null;

  const stored = credentialPlaces(beforeKey, before);
  const kept = credentialPlaces(afterKey, after).find(
    ({ path, value }) =>
      !(path.length === 1 && typed[/** @type {'password'|'token'} */ (path[0])]) &&
      stored.some((s) => isDeepStrictEqual(s.value, value))
  );
  if (kept) return { path: kept.path, field: formField(kept.path) };
  for (const field of /** @type {const} */ (['password', 'token'])) {
    if (!typed[field] && hasSecret(keyedSecretName(beforeKey, field))) return { path: [field], field };
  }
  if (looksLikeSecretRef(after?.username) && after.username === before?.username) {
    return { path: ['username'], field: 'username' };
  }
  return null;
}

/** The form field a credential's place is, or null. */
function formField(path) {
  return path.length === 1 && ['password', 'token', 'username'].includes(String(path[0]))
    ? String(path[0])
    : null;
}

/**
 * The refusal's message for `found` (movedCredential's answer), its place
 * prefixed with `at` (`integrations.<key>` for the whole-config save). It
 * names the place, never a value or an origin.
 * @param {{ path: Array<string|number>, field: string | null }} found
 * @param {string} [at]
 */
export function movedCredentialError(found, at = '') {
  const name = [...found.path].reverse().find((p) => typeof p === 'string') || 'credential';
  const where = [at, ...found.path].filter((p) => p !== '').join('.');
  const what = found.field && !at ? `stored ${name}` : `stored credential at ${where}`;
  return `The ${what} was entered for the old address; re-enter the ${name} for the new address`;
}
