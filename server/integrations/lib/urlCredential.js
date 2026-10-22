// @ts-check
/**
 * An integration's URL never carries a credential (#422).
 *
 * A user name or password before the host (`https://user:pass@host`) or a
 * secret-looking query parameter (`?apikey=…`, SECRET_PARAMS in
 * util/redact.js) never worked: fetch refuses a URL with userinfo, and the
 * endpoint is appended after the URL, so a query in it never reaches the API
 * as one. Such a URL is refused by the Settings save and connection test
 * (routes/integrations.js), and one already in services.yaml is never
 * requested: its refresh fails with an error saying where the credential goes
 * (handler.js). The config read masks it (util/configMask.js).
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

/** @param {{ userinfo: true } | { param: string }} found */
function whatItCarries(found) {
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
 * The refresh error of an integration whose stored URL carries a credential,
 * or null when it carries none.
 * @param {unknown} url
 * @param {{ name?: string, auth?: string } | null | undefined} preset
 */
export function storedUrlCredentialError(url, preset) {
  const found = urlCredential(url);
  if (!found) return null;
  return (
    `Its URL carries ${whatItCarries(found)}, so it is not requested. ` +
    `Edit it in Settings, enter the URL without it, and ${whereItGoes(preset)}.`
  );
}
