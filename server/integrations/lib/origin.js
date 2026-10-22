// @ts-check
/**
 * Where an integration's requests may go (#556). Two walls, both checked by
 * assertRequestOrigin before every request an integration makes: the data
 * read, each extra endpoint, each session login and the read after it, a
 * cached session token's read (handler.js, session.js).
 *
 * 1. Every request stays on the origin of the integration's own URL (as
 *    resolved: the preset's default, `.env`, the keyed `url` secret), with or
 *    without a credential on it. The request URL is the URL with the
 *    endpoint appended, so an endpoint (or a name an upstream answer fills
 *    in, Proxmox's node) can't lead onto another host: `.collector.example`
 *    appended to `http://npm.lan` is `http://npm.lan.collector.example`. One
 *    that leads elsewhere is not requested. No preset needs a second origin.
 * 2. A stored credential goes only to the origins it was entered for. Each
 *    secret in the store carries them (secrets.js); resolveIntegrationConfig
 *    (config.js) puts the origins every stored credential it resolved allows
 *    on the config, as `_credentialOrigins`; a credential from `.env` or
 *    typed into services.yaml by hand adds none.
 *
 * A redirect off the request's origin carries no credential
 * (util/safeFetchCore.js), so a hop never takes one where this didn't look.
 * Both run at the request, not at the forms, so they hold whatever put the
 * URL, the endpoint or the reference there: the integration form, the
 * whole-config save, a hand edit, or a `$secret:` naming another entry's
 * secret.
 */

/**
 * The origin of `url` as the store keeps it: `scheme://host:port`, with the
 * host as the URL parser normalises it (lowercase, punycode, IPv4 forms) and
 * the default port written out, so `http://Host` and `http://host:80/` are
 * one. Null for anything that is not an http(s) URL.
 * @param {unknown} url
 * @returns {string | null}
 */
export function originOf(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  return `${u.protocol}//${u.hostname}:${port}`;
}

/** What an integration whose stored credential isn't for its address says. */
export const CREDENTIAL_ORIGIN_ERROR =
  'Its stored credential was entered for another address, so it is not sent to this one; ' +
  're-enter the credential for this address in Settings';

/**
 * A request that would carry a stored credential to an origin it was not
 * entered for. Its message names neither the secret nor any origin. Not a
 * refused login: the refresh loop backs off as from any failed fetch.
 */
export class CredentialOriginError extends Error {
  constructor() {
    super(CREDENTIAL_ORIGIN_ERROR);
    this.name = 'CredentialOriginError';
  }
}

/**
 * The origins every stored credential among `stored` allows (each one's
 * origins, intersected), or null when there is none, so nothing restricts
 * the requests. `stored` holds one origin list per credential read from the
 * store.
 * @param {string[][]} stored
 * @returns {string[] | null}
 */
export function allowedOrigins(stored) {
  if (stored.length === 0) return null;
  return stored.reduce((acc, origins) => acc.filter((o) => origins.includes(o)));
}

/** What an integration whose request would leave its URL's origin says. */
export const OFF_ORIGIN_ERROR =
  "Its endpoint leads away from its URL, onto another host or port, so it is not requested; " +
  "check the endpoint in its entry in services.yaml";

/** A request whose URL is not on the origin of the integration's own URL. */
export class OffOriginError extends Error {
  constructor() {
    super(OFF_ORIGIN_ERROR);
    this.name = 'OffOriginError';
  }
}

/**
 * Throw unless `url`, about to be requested for the integration `config`, is
 * on the origin of `config.url` (OffOriginError) and, when the config
 * carries a stored credential, on an origin it was entered for
 * (CredentialOriginError). A URL that doesn't parse is never requested: the
 * fetch refuses it, and its error says why.
 * @param {{ url?: string, _credentialOrigins?: string[] | null }} config
 * @param {string} url
 */
export function assertRequestOrigin(config, url) {
  if (!URL.canParse(String(url))) return;
  const origin = originOf(url);
  if (origin === null || origin !== originOf(config?.url)) throw new OffOriginError();
  assertCredentialOrigin(config, url);
}

/**
 * Throw CredentialOriginError when `config` carries a stored credential
 * (`_credentialOrigins`, from resolveIntegrationConfig) and `url`, the URL
 * about to be requested, is not on an origin it allows.
 * @param {{ _credentialOrigins?: string[] | null }} config
 * @param {string} url
 */
export function assertCredentialOrigin(config, url) {
  const allowed = config?._credentialOrigins;
  if (!Array.isArray(allowed)) return;
  // A URL that doesn't parse is never requested: the fetch refuses it, and
  // its error says why.
  if (!URL.canParse(String(url))) return;
  const origin = originOf(url);
  if (origin === null || !allowed.includes(origin)) throw new CredentialOriginError();
}
