// @ts-check
/**
 * Credentials in services.yaml never reach the browser (#413).
 *
 * GET /api/services/config answers with the config through maskCredentials:
 * each credential that is set comes back as the marker { "$stored": true },
 * never its value or its `$secret:` reference. Settings' Nodes and Services
 * tabs post the whole config back with the markers in it, so
 * POST /api/services/config runs restoreCredentials first: each marker is
 * replaced by the value stored in the same place, so a marker is never
 * written and a credential is never lost. A marker is accepted only where the
 * read would put one now, so it can't move a credential to another key; in
 * an array it goes back to the element with the same name, id or key, never
 * the one at the same position. Nothing here ever answers with a stored value.
 *
 * A credential, at any depth of the config:
 *   - the value of a key with a credential's name, in any case: `password`
 *     and `token` (the resolver reads `$secret:` references from these two
 *     only), and `apikey`, `api_key`, `secret`, `cookie` and the rest of
 *     CREDENTIAL_NAMES;
 *   - each value of an `extraHeaders` map (sent with every request, such as
 *     an Authorization header written by hand);
 *   - a `loginBody` (a session's, or a fallback session's: one written by hand
 *     can hold the credentials themselves, not the {username} and {password}
 *     placeholders);
 *   - an endpoint (a key ending in `endpoint`: endpoint, testEndpoint,
 *     extraEndpoints[].endpoint, a session's loginEndpoint) whose query carries
 *     a key (SECRET_PARAMS, from util/redact.js) or which carries a password
 *     (`//user:pass@`), as a whole value. A placeholder such as `{token}` is no
 *     credential in the endpoint itself.
 * And directly on an integration entry (a value of `integrations` or the
 * legacy `custom_integrations` map):
 *   - `key` (elsewhere it names a field or an extra endpoint);
 *   - every key the entry's endpoints, or its preset's, fill in through a
 *     `{name}` placeholder (lib/extract.js resolveEndpoint), whatever its name.
 * Never masked: the key of a map (an integration's, node's, service's or
 * monitor_per_node's own name), and what the integration form shows and saves
 * back on an entry (url, username, target, instance, enabled, preset and every
 * preset's URL parameters), unless it is a password or token: a marker in one
 * of those would be posted back through the form and written. `authHeader`
 * names a header and is no credential: its value is the `token`.
 *
 * A credential that is not set (null or '') is left as it is, so the marker
 * always means a value is stored. Pure (no I/O, no logging), so the web
 * client's tests use it too.
 */

import { SECRET_PARAMS } from './redact.js';

/** The marker for a stored credential. */
export const STORED_MARKER = Object.freeze({ $stored: true });

const MARKER_KEY = '$stored';
const MAX_PATH_CHARS = 200;

/** Credential names, compared lowercased. */
const CREDENTIAL_NAMES = new Set([
  'password',
  'token',
  'apikey',
  'api_key',
  'api-key',
  'secret',
  'client_secret',
  'pass',
  'passwd',
  'passphrase',
  'access_token',
  'auth_token',
  'bearer',
  'cookie',
]);
/** The two the integration form handles as credentials (blank keeps the stored one). */
const FORM_CREDENTIALS = new Set(['password', 'token']);
/** What the integration form shows and saves back on an entry. */
const FORM_OWNED = ['url', 'username', 'target', 'instance', 'enabled', 'preset'];

/** Maps keyed by a name the user chose, at the top of the config. */
const NAME_MAPS = new Set(['nodes', 'services']);
const ENTRY_MAPS = new Set(['integrations', 'custom_integrations']);

const ENDPOINT_KEY = /endpoint$/i;
const SECRET_PARAM = new RegExp(SECRET_PARAMS.source, 'i');
const USERINFO_PASSWORD = /\/\/[^/@\s]*:[^/@\s]*@/;
const PLACEHOLDER = /\{(\w+)\}/g;
const IDENTITY_KEYS = ['name', 'id', 'key'];

/**
 * @typedef {object} MaskOptions
 * @property {(entryKey: string, entry: any) => any} [presetOf] the preset an
 *   integration entry runs on (for its endpoint placeholders), or null
 * @property {Iterable<string>} [urlParamKeys] the URL parameters any preset's
 *   form shows and saves
 */

/**
 * @typedef {{ formOwned: Set<string>, placeholders: Set<string> }} EntryRules
 * @typedef {{ kind: 'object'|'names'|'entries'|'entry'|'headers'|'array', root?: boolean, entriesKey?: string, rules?: EntryRules }} Frame
 *   What holds a value: an object or array (the root is one), a map keyed by
 *   names, the map of integration entries, one integration entry, or an
 *   extraHeaders map.
 * @typedef {{ key: string|number, container: any, up: Place|null }} Place
 *   A value's place: its key, what holds it, and that holder's place.
 */

/**
 * @param {unknown} v
 * @returns {v is Record<string, any>}
 */
function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * True for exactly the marker: an object whose one key is `$stored`, true.
 * @param {unknown} v
 */
export function isStoredMarker(v) {
  if (!isPlainObject(v)) return false;
  const keys = Object.keys(v);
  return keys.length === 1 && keys[0] === MARKER_KEY && v[MARKER_KEY] === true;
}

/** @param {unknown} v */
const isSet = (v) => v !== undefined && v !== null && v !== '';

/** @param {unknown} v an endpoint value */
function endpointCarriesCredential(v) {
  if (typeof v !== 'string') return false;
  // A placeholder is filled in from the entry (and masked there), not here.
  return SECRET_PARAM.test(v.replace(PLACEHOLDER, '')) || USERINFO_PASSWORD.test(v);
}

/**
 * The `{name}` placeholders of an entry's (or a preset's) endpoints.
 * @param {any} source
 * @param {Set<string>} into
 */
function addPlaceholders(source, into) {
  if (!isPlainObject(source)) return;
  const endpoints = [source.endpoint, source.testEndpoint];
  if (Array.isArray(source.extraEndpoints)) {
    for (const ep of source.extraEndpoints) endpoints.push(isPlainObject(ep) ? ep.endpoint : null);
  }
  for (const e of endpoints) {
    if (typeof e === 'string') for (const m of e.matchAll(PLACEHOLDER)) into.add(m[1]);
  }
}

/**
 * The rules for one integration entry, from the entry as stored.
 * @param {string} entryKey
 * @param {unknown} entry
 * @param {MaskOptions} opts
 * @returns {EntryRules}
 */
function entryRules(entryKey, entry, opts) {
  const formOwned = new Set([...FORM_OWNED, ...(opts.urlParamKeys || [])]);
  const placeholders = new Set();
  addPlaceholders(entry, placeholders);
  if (opts.presetOf && isPlainObject(entry))
    addPlaceholders(opts.presetOf(entryKey, entry), placeholders);
  return { formOwned, placeholders };
}

/**
 * Whether a credential can be under `key` in what `frame` describes:
 * 'always' when one is whatever its value, 'endpoint' when one is only if the
 * value carries a credential, false when none is.
 * @param {Frame} frame
 * @param {string|number} key
 * @returns {'always'|'endpoint'|false}
 */
function credentialPlace(frame, key) {
  if (frame.kind === 'headers') return 'always';
  if (frame.kind !== 'object' && frame.kind !== 'entry') return false;
  if (typeof key !== 'string') return false;
  const name = key.toLowerCase();
  if (FORM_CREDENTIALS.has(name)) return 'always';
  if (frame.kind === 'entry' && frame.rules?.formOwned.has(key)) return false;
  if (CREDENTIAL_NAMES.has(name) || key === 'loginBody') return 'always';
  if (frame.kind === 'entry' && (key === 'key' || frame.rules?.placeholders.has(key))) {
    return 'always';
  }
  if (ENDPOINT_KEY.test(key)) return 'endpoint';
  return false;
}

/**
 * @param {Frame} frame
 * @param {string|number} key
 * @param {unknown} value
 */
function isMasked(frame, key, value) {
  const place = credentialPlace(frame, key);
  if (!place || !isSet(value)) return false;
  return place === 'always' || endpointCarriesCredential(value);
}

/**
 * What holds the values inside `value`, which is under `key` in `frame`.
 * @param {Frame|null} frame null for the root
 * @param {string|number} key
 * @param {unknown} value
 * @param {(entriesKey: string, entryKey: string) => EntryRules} rulesFor
 * @returns {Frame|null} null for a value with nothing inside
 */
function childFrame(frame, key, value, rulesFor) {
  if (Array.isArray(value)) return { kind: 'array' };
  if (!isPlainObject(value)) return null;
  if (frame === null) return { kind: 'object', root: true };
  if (frame.kind === 'entries') {
    return {
      kind: 'entry',
      rules: rulesFor(/** @type {string} */ (frame.entriesKey), String(key)),
    };
  }
  if (frame.kind === 'names' || frame.kind === 'array') return { kind: 'object' };
  if (frame.root && typeof key === 'string') {
    if (NAME_MAPS.has(key)) return { kind: 'names' };
    if (ENTRY_MAPS.has(key)) return { kind: 'entries', entriesKey: key };
  }
  if (key === 'extraHeaders') return { kind: 'headers' };
  if (key === 'monitor_per_node') return { kind: 'names' };
  return { kind: 'object' };
}

/**
 * Call `visit(container, key, frame, place)` for every value under `root`
 * (own keys, arrays included). `visit` returns true to skip what is inside
 * that value. Iterative, so a deeply nested config can't overflow the stack.
 * @param {unknown} root
 * @param {(entriesKey: string, entryKey: string) => EntryRules} rulesFor
 * @param {(container: any, key: string|number, frame: Frame, place: Place) => boolean} visit
 */
function walk(root, rulesFor, visit) {
  const rootFrame = childFrame(null, '', root, rulesFor);
  if (!rootFrame) return;
  /** @type {Array<{ node: any, frame: Frame, place: Place|null }>} */
  const todo = [{ node: root, frame: rootFrame, place: null }];
  while (todo.length > 0) {
    const { node, frame, place } = /** @type {{ node: any, frame: Frame, place: Place|null }} */ (
      todo.pop()
    );
    const keys = Array.isArray(node) ? [...node.keys()] : Object.keys(node);
    for (const key of keys) {
      const at = { key, container: node, up: place };
      if (visit(node, key, frame, at)) continue;
      const inner = childFrame(frame, key, node[key], rulesFor);
      if (inner) todo.push({ node: node[key], frame: inner, place: at });
    }
  }
}

/**
 * The config with each credential that is set replaced by the marker. A copy:
 * `config` is not changed.
 * @template T
 * @param {T} config
 * @param {MaskOptions} [opts]
 * @returns {T}
 */
export function maskCredentials(config, opts = {}) {
  const out = structuredClone(config);
  // From the entry as it is, not the copy being masked.
  const rulesFor = (/** @type {string} */ entriesKey, /** @type {string} */ entryKey) =>
    entryRules(entryKey, /** @type {any} */ (config)?.[entriesKey]?.[entryKey], opts);
  walk(out, rulesFor, (container, key, frame) => {
    if (!isMasked(frame, key, container[key])) return false;
    container[key] = { ...STORED_MARKER };
    return true;
  });
  return out;
}

/** @param {Array<string|number>} path */
function pathText(path) {
  const text = path.join('.');
  return text.length > MAX_PATH_CHARS ? `${text.slice(0, MAX_PATH_CHARS)}…` : text;
}

/** @param {Place} place @returns {Place[]} from the root down */
function placesOf(place) {
  const places = [];
  for (let p = /** @type {Place|null} */ (place); p; p = p.up) places.unshift(p);
  return places;
}

/**
 * An array element's identity: its name, id or key (the first it has, as text
 * or a number), or undefined when it has none.
 * @param {unknown} el
 */
function identityOf(el) {
  if (!isPlainObject(el)) return undefined;
  for (const k of IDENTITY_KEYS) {
    const v = el[k];
    if (Object.hasOwn(el, k) && (typeof v === 'string' || typeof v === 'number')) {
      return `${k}:${typeof v}:${v}`;
    }
  }
  return undefined;
}

/**
 * Where `place` (in the posted config) is in `stored`: the same keys, with
 * each array element found by its identity, never its position.
 * @param {Place} place
 * @param {unknown} stored
 * @param {string} path the place as text, for an error
 * @returns {{ found: Array<string|number> } | { missing: true } | { error: string }}
 */
function locate(place, stored, path) {
  const places = placesOf(place);
  /** @type {Array<string|number>} */
  const found = [];
  /** @type {any} */
  let cur = stored;
  for (const p of places) {
    if (Array.isArray(p.container)) {
      const id = identityOf(p.container[/** @type {number} */ (p.key)]);
      if (id === undefined) {
        return {
          error: `A stored-value marker is in an array element with no name, id or key (${path})`,
        };
      }
      if (p.container.filter((el) => identityOf(el) === id).length > 1) {
        return {
          error: `A stored-value marker is in an array element whose name, id or key another shares (${path})`,
        };
      }
      if (!Array.isArray(cur)) return { missing: true };
      const matches = cur.flatMap((el, i) => (identityOf(el) === id ? [i] : []));
      if (matches.length > 1) {
        return { error: `A stored-value marker matches two stored array elements (${path})` };
      }
      if (matches.length === 0) return { missing: true };
      found.push(matches[0]);
      cur = cur[matches[0]];
    } else {
      if (!isPlainObject(cur) || !Object.hasOwn(cur, p.key)) return { missing: true };
      found.push(p.key);
      cur = cur[p.key];
    }
  }
  return { found };
}

/**
 * The value at `path` in `root`, through own keys and array indexes.
 * @param {unknown} root
 * @param {Array<string|number>} path
 */
function valueAt(root, path) {
  /** @type {any} */
  let v = root;
  for (const k of path) v = v?.[k];
  return v;
}

/**
 * `posted` (a config as the read answered it, maybe edited) with each marker
 * replaced by a copy of the value `stored` has in the same place; in an
 * array, the same place is the element with the same name, id or key. A
 * marker is accepted only where reading `stored` now would put one. Anywhere
 * else it is refused: 409 where a credential goes but none is stored (it was
 * removed or renamed since the config was read), and 400 for any other place,
 * an array element with no name, id or key (or one two elements share), or an
 * object with `$stored` that is not exactly the marker. The error names the
 * place, never a value. `posted` is not changed.
 * @param {unknown} posted
 * @param {unknown} stored
 * @param {MaskOptions} [opts]
 * @returns {{ ok: true, config: any } | { ok: false, status: 400|409, error: string }}
 */
export function restoreCredentials(posted, stored, opts = {}) {
  let out;
  try {
    out = structuredClone(posted);
  } catch {
    // Nested deeper than a copy can go (thousands of levels): no config is.
    return { ok: false, status: 400, error: 'Config is nested too deeply' };
  }
  // The rules for an entry come from the entry as stored, as the read's did.
  const rulesFor = (/** @type {string} */ entriesKey, /** @type {string} */ entryKey) =>
    entryRules(entryKey, /** @type {any} */ (stored)?.[entriesKey]?.[entryKey], opts);
  /** @type {unknown} */
  let masked;
  /** @type {Array<{ status: 400|409, error: string }>} */
  const refused = [];
  walk(out, rulesFor, (container, key, frame, place) => {
    if (refused.length > 0) return true;
    const value = container[key];
    if (!isPlainObject(value) || !Object.hasOwn(value, MARKER_KEY)) return false;
    if (masked === undefined) masked = maskCredentials(stored, opts);
    const path = pathText(placesOf(place).map((p) => p.key));
    if (!isStoredMarker(value)) {
      refused.push({ status: 400, error: `Invalid stored-value marker at ${path}` });
      return true;
    }
    const where = locate(place, stored, path);
    if ('error' in where) {
      refused.push({ status: 400, error: where.error });
    } else if ('found' in where && isStoredMarker(valueAt(masked, where.found))) {
      container[key] = structuredClone(valueAt(stored, where.found));
    } else if (credentialPlace(frame, key)) {
      refused.push({
        status: 409,
        error: `No credential is stored at ${path}; services.yaml changed since it was read, so read it again and retry`,
      });
    } else {
      refused.push({
        status: 400,
        error: `A stored-value marker can stand only for a credential, not ${path}`,
      });
    }
    return true;
  });
  return refused.length > 0 ? { ok: false, ...refused[0] } : { ok: true, config: out };
}
