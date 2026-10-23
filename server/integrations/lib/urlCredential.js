// @ts-check
/**
 * An integration's URL never carries a credential (#422, #419).
 *
 * A user name or password before the host (`https://user:pass@host`, or one
 * the parser reads as `host:port`, urlCredential in util/redact.js) or a
 * secret-looking query parameter (`?apikey=…`, SECRET_PARAMS) never worked:
 * fetch refuses a URL with userinfo, and the endpoint is appended after the
 * URL, so a query in it never reaches the API as one. Such a URL is refused by
 * the Settings save and connection test (routes/integrations.js). One a
 * refresh resolves, from services.yaml, its `.env` variable or the keyed `url`
 * secret, is never requested: the resolve (lib/config.js) refuses it with an
 * error naming where it came from and where the credential goes. The config
 * read masks it (util/configMask.js).
 *
 * Each message names the integration form's field for the credential (the
 * labels ConfigView.jsx shows for the preset's auth mode), never the value.
 */

import { urlCredential } from '../../util/redact.js';

/**
 * Where the form takes a credential, by auth mode (none: no field).
 * @type {Record<string, string>}
 */
const FIELDS = {
  basic: 'put the user name and password in the Username and Password fields',
  session: 'put the user name and password in the Username and Password fields',
  oauth2: 'put them in the Client ID and Client Secret fields',
  bearer: 'put the token in the API Token field',
  header: 'put the key in the API Key field',
  query: 'put the key in the API Key field',
};

/**
 * What to do with the credential, for `preset` (null for a custom
 * integration, whose form has only the API Token field).
 * @param {{ name?: string, auth?: string } | null | undefined} preset
 */
function whereItGoes(preset) {
  if (!preset) {
    return "put the token in the API Token field, or the credential in the integration's entry in services.yaml";
  }
  return FIELDS[preset.auth || ''] || `leave it out: ${preset.name || 'this integration'} needs none`;
}

/**
 * What a URL carries, in words, from urlCredential: "a user name or password",
 * or "a credential in its query (apikey=)". Never the value.
 * @param {{ userinfo: true } | { param: string }} found
 */
export function whatItCarries(found) {
  return 'param' in found
    ? `a credential in its query (${found.param}=)`
    : 'a user name or password';
}

/**
 * Why `url` can't be saved or tested, or null when it carries no credential.
 * @param {unknown} url
 * @param {{ name?: string, auth?: string } | null | undefined} preset
 */
export function formUrlCredentialError(url, preset) {
  const found = urlCredential(url);
  if (!found) return null;
  return `The URL can't carry ${whatItCarries(found)}. Remove it, and ${whereItGoes(preset)}.`;
}

/**
 * Where a credential goes for an integration whose URL is set in `.env`: the
 * preset's own variables for it, else the form's fields.
 * @param {{ name?: string, auth?: string, envKeys?: Record<string, string> } | null | undefined} preset
 */
function whereItGoesInEnv(preset) {
  const vars = ['username', 'password', 'token'].map((f) => preset?.envKeys?.[f]).filter(Boolean);
  return vars.length ? `put the credential in ${vars.join(' and ')}` : whereItGoes(preset);
}

/**
 * The refresh error of an integration whose URL, as resolved, carries a
 * credential, or null when it carries none. `from` is where the URL came
 * from: `{ env }`, the `.env` variable's name; `{ secret }`, the keyed `url`
 * secret's name; or null, the entry in services.yaml. Names the place, never
 * the value.
 * @param {unknown} url
 * @param {{ name?: string, auth?: string, envKeys?: Record<string, string> } | null | undefined} preset
 * @param {{ env: string } | { secret: string } | null} [from]
 */
export function storedUrlCredentialError(url, preset, from = null) {
  const found = urlCredential(url);
  if (!found) return null;
  const what = whatItCarries(found);
  if (from && 'env' in from) {
    return `${from.env} carries ${what}, so it is not requested. Set it without it, and ${whereItGoesInEnv(preset)}.`;
  }
  if (from && 'secret' in from) {
    return (
      `The stored url (secret ${from.secret}) carries ${what}, so it is not requested. ` +
      `Store it without it, and ${whereItGoes(preset)}.`
    );
  }
  return (
    `Its URL carries ${what}, so it is not requested. ` +
    `Edit it in Settings, enter the URL without it, and ${whereItGoes(preset)}.`
  );
}
