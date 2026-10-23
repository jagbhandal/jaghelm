/**
 * JSON value extraction + URL templating helpers, and the rule every request
 * builder reads a credential by (credentialToSend).
 *
 * Pure functions, no I/O, no module state.
 */

// The credentials resolveIntegrationConfig resolves (into _username, _password
// and _token). A placeholder naming one, with or without the underscore, puts
// that credential in the URL.
const CREDENTIAL_PARAMS = new Set(['username', 'password', 'token']);

// A value that is, or looks like, a `$secret:` reference: a name in the secrets
// store, not the credential itself.
const SECRET_REF = /^\s*\$secret:/i;

/** True for a value that is, or looks like, a `$secret:` reference. */
export function looksLikeSecretRef(value) {
  return typeof value === 'string' && SECRET_REF.test(value);
}

/**
 * A request needs a stored credential that couldn't be read: a `$secret:`
 * reference whose secret is missing or won't decrypt, or a reference where a
 * credential is never resolved. The request is not built and nothing is sent,
 * from a URL (#425) or an auth header or a session login (#428). Not a refused
 * login: the refresh loop backs off as from any failed fetch, and the
 * integration's config fingerprint changes once the secret reads again.
 * The message names where the credential goes (`{token} in the endpoint`,
 * `the password in the login`), never the reference, and says where to fix
 * it: in Settings when its form has the field, else in services.yaml.
 */
export class UnresolvedSecretError extends Error {
  /**
   * @param {string} where
   * @param {{ field?: string, settings?: boolean }} [opts] field: the
   *   credential (token, password, username); settings: Settings has a field
   *   for it, so the fix is to enter it there again
   */
  constructor(where, { field = 'credential', settings = false } = {}) {
    const fix = settings
      ? `enter the ${field} again in Settings and save`
      : "check this integration's entry in services.yaml";
    super(`Couldn't read the stored credential for ${where}; ${fix}`);
    this.name = 'UnresolvedSecretError';
  }
}

/**
 * Whether the credential `name` (username, password or token) of a resolved
 * config is a stored one that couldn't be read: what resolveIntegrationConfig
 * resolved into `_<name>` is, or looks like, a `$secret:` reference, or it is
 * empty while the entry's own value is one.
 */
function unreadableCredential(config, name) {
  const resolved = config[`_${name}`];
  return looksLikeSecretRef(resolved) || (!resolved && looksLikeSecretRef(config[name]));
}

/**
 * The refusal for the credential `name` of `config`, which goes to `where`.
 * Settings has a field for the token of every integration (a custom
 * integration's form shows only that one), and for the username and
 * password of a preset that takes them (its envKeys, which follow its auth
 * mode as the form's fields do).
 */
function unreadableError(config, name, where) {
  return new UnresolvedSecretError(where, {
    field: name,
    settings: name === 'token' || !!config.envKeys?.[name],
  });
}

/**
 * The credential `name` (username, password or token) of a resolved config,
 * as a request sends it: its resolved `_<name>`, or '' when there is none.
 * The one rule for every auth mode (#428): a stored credential that couldn't
 * be read throws UnresolvedSecretError, so the request that would carry it
 * is never built. `where` is where it goes, for the error.
 * @param {Record<string, any>} config
 * @param {'username' | 'password' | 'token'} name
 * @param {string} where
 * @returns {string}
 */
export function credentialToSend(config, name, where) {
  if (unreadableCredential(config, name)) throw unreadableError(config, name, where);
  return config[`_${name}`] || '';
}

/**
 * The value a `{key}` placeholder takes. A credential with a resolved `_` twin
 * (which resolveIntegrationConfig sets) always takes the twin: the raw value
 * beside it is what the twin was resolved from, often a `$secret:` reference,
 * and for a preset the `.env` value wins over it. Anything else is looked up
 * by its name, then with the underscore.
 */
function placeholderValue(config, key) {
  const name = key.replace(/^_/, '');
  if (CREDENTIAL_PARAMS.has(name) && Object.hasOwn(config, `_${name}`)) return config[`_${name}`];
  return config[key] || config[`_${key}`];
}

/**
 * Replace {placeholder} tokens in endpoint URLs with config values.
 * Used by presets that require dynamic URL segments (e.g. Cloudflare account_id)
 * and by custom integrations that put a credential in the URL (`?key={token}`).
 * A credential placeholder takes the resolved credential (see placeholderValue),
 * URL-encoded (#429), so a `&`, `#`, `/`, `?`, space or `@` in it can't cut
 * the credential short or move it into another part of the URL; a credential
 * is written unencoded in services.yaml. Any other placeholder (a preset's
 * account id) goes in as written. A placeholder with no value is left as
 * written.
 *
 * A `$secret:` reference is never put into a URL. A credential placeholder
 * whose stored credential couldn't be read (credentialToSend's rule), or any
 * placeholder whose value looks like a reference (in a field that is never
 * resolved), throws UnresolvedSecretError, so the request is not sent and
 * the integration's error says why (#425).
 *
 * Also reports whether a credential was filled in (a custom integration's
 * `/api?key={token}`), which the caller passes to safeFetch as credentialInUrl so
 * the request refuses a redirect to another origin, and `shownPath`: the path
 * with every credential placeholder left as written (`/api?key={token}`), for
 * safeFetch's shownUrl, so an error that quotes the URL never quotes the
 * credential.
 *
 * @returns {{ path: string, credentialInUrl: boolean, shownPath: string }}
 */
export function resolveEndpoint(endpoint, config) {
  let credentialInUrl = false;
  let shownPath = '';
  let shownTo = 0;
  const path = endpoint.replace(/\{(\w+)\}/g, (match, key, offset) => {
    const name = key.replace(/^_/, '');
    const isCredential = CREDENTIAL_PARAMS.has(name);
    const where = `{${key}} in the endpoint`;
    if (isCredential && unreadableCredential(config, name)) throw unreadableError(config, name, where);
    const value = placeholderValue(config, key);
    if (looksLikeSecretRef(value)) throw new UnresolvedSecretError(where);
    const credential = !!value && isCredential;
    if (credential) credentialInUrl = true;
    const filled = !value ? match : credential ? encodeURIComponent(String(value)) : String(value);
    shownPath += endpoint.slice(shownTo, offset) + (credential ? match : filled);
    shownTo = offset + match.length;
    return filled;
  });
  shownPath += endpoint.slice(shownTo);
  return { path, credentialInUrl, shownPath };
}

/**
 * Deep value extraction from JSON using dot-notation path.
 *
 * Supports:
 *   - 'foo.bar.baz'              — nested object access
 *   - 'foo.0.bar'                — array index access
 *   - '_length'                  — array length (whole path) OR a trailing
 *                                  '.foo._length' segment (count of keys/items
 *                                  on the resolved parent — handles object maps)
 *   - '_filter:field=value'      — count items matching a predicate
 *                                  (also: >, <, >=, <= — numeric-only ordering)
 */
export function extractValue(data, path) {
  if (!path || !data) return undefined;

  // Special: array length
  if (path === '_length') {
    return Array.isArray(data) ? data.length : 0;
  }

  // Special: array filter — '_filter:field=value' or '_filter:field>value'
  if (path.startsWith('_filter:')) {
    const filterExpr = path.slice(8);
    if (!Array.isArray(data)) return 0;

    // Parse operator: =, >, <, >=, <=
    let field, op, value;
    for (const operator of ['>=', '<=', '>', '<', '=']) {
      const idx = filterExpr.indexOf(operator);
      if (idx > 0) {
        field = filterExpr.slice(0, idx);
        op = operator;
        value = filterExpr.slice(idx + operator.length);
        break;
      }
    }
    if (!field) return 0;

    const numVal = Number(value);
    // Number('') is 0 and Number('  ') is 0, so guard empty/whitespace too —
    // an empty filter value is never a meaningful numeric comparison target.
    const isNumeric = value.trim() !== '' && !isNaN(numVal);
    // Ordering operators (>, <, >=, <=) are NUMERIC-ONLY. A non-numeric filter
    // value would make numVal NaN, and every NaN comparison is false, so the
    // filter would silently count 0 with no diagnostic. Guard up front and
    // return a clean 0 for that misconfiguration rather than a false match.
    if ((op === '>' || op === '<' || op === '>=' || op === '<=') && !isNumeric) {
      return 0;
    }
    return data.filter(item => {
      const itemVal = item[field];
      if (itemVal == null) return false;
      switch (op) {
        // Numeric equality uses strict === on the coerced number; string
        // equality compares the raw string forms. (No loose == coercion.)
        case '=': return isNumeric ? Number(itemVal) === numVal : String(itemVal) === value;
        case '>': return itemVal > numVal;
        case '<': return itemVal < numVal;
        case '>=': return itemVal >= numVal;
        case '<=': return itemVal <= numVal;
        default: return false;
      }
    }).length;
  }

  // Standard dot-notation traversal.
  const parts = path.split('.');

  // A trailing '._length' segment counts the entries on the resolved parent.
  // caddy/frigate-style payloads key their collections as OBJECTS (e.g.
  // { apps: { http: {...}, tls: {...} } }), so 'apps._length' must resolve to
  // Object.keys(parent).length — not undefined (which renders as '—').
  // Arrays still report .length; the whole-path '_length' case above is
  // unaffected (it never reaches here).
  if (parts.length > 1 && parts[parts.length - 1] === '_length') {
    const parent = traverse(data, parts.slice(0, -1));
    if (parent == null) return undefined;
    if (Array.isArray(parent)) return parent.length;
    if (typeof parent === 'object') return Object.keys(parent).length;
    return undefined;
  }

  return traverse(data, parts);
}

/**
 * Walk an array of dot-notation segments, short-circuiting to undefined the
 * moment the chain hits null/undefined.
 */
function traverse(data, parts) {
  let current = data;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}
