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
 * read would put one now; it can't move a credential to another place, and
 * nothing here ever answers with a stored value.
 *
 * A credential, at any depth of the config:
 *   - the value of a `password` or `token` key (an integration's credential,
 *     plaintext or a `$secret:` reference, which the resolver reads from
 *     these two keys only);
 *   - each value of an `extraHeaders` map (sent with every request, such as
 *     an Authorization header written by hand);
 *   - a `session`'s `loginBody` (a login body written by hand can hold the
 *     credentials themselves, not the {username} and {password} placeholders).
 * A credential that is not set (null or '') is left as it is, so the marker
 * always means a value is stored. `authHeader` names a header and is no
 * credential: its value is the `token`. Pure (no I/O, no logging), so the
 * web client's tests use it too.
 */

/** The marker for a stored credential. */
export const STORED_MARKER = Object.freeze({ $stored: true });

const MARKER_KEY = '$stored';
const CREDENTIAL_KEYS = new Set(['password', 'token']);
const MAX_PATH_CHARS = 200;

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
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

/**
 * Whether the value under `key`, in an object that is itself under
 * `parentKey`, is a credential.
 * @param {string|number|null} parentKey
 * @param {string|number} key
 */
function isCredentialPlace(parentKey, key) {
  return (
    (typeof key === 'string' && CREDENTIAL_KEYS.has(key)) ||
    parentKey === 'extraHeaders' ||
    (parentKey === 'session' && key === 'loginBody')
  );
}

/** @param {unknown} v */
const isSet = (v) => v !== undefined && v !== null && v !== '';

/**
 * @typedef {{ key: string|number, up: Place|null }} Place
 * A value's place: its key, and the place of the object or array holding it.
 */

/** @param {Place} place @returns {Array<string|number>} the keys from the root */
function pathOf(place) {
  const path = [];
  for (let p = /** @type {Place|null} */ (place); p; p = p.up) path.unshift(p.key);
  return path;
}

/**
 * Call `visit(container, key, parentKey, place)` for every value under
 * `root` (own keys, arrays included). `visit` returns true to skip what is
 * inside that value. Iterative, so a deeply nested config can't overflow the
 * stack.
 * @param {unknown} root
 * @param {(container: any, key: string|number, parentKey: string|number|null, place: Place) => boolean} visit
 */
function walk(root, visit) {
  /** @type {Array<{ node: unknown, place: Place|null }>} */
  const todo = [{ node: root, place: null }];
  while (todo.length > 0) {
    const { node, place } = /** @type {{ node: any, place: Place|null }} */ (todo.pop());
    const keys = Array.isArray(node) ? [...node.keys()] : isPlainObject(node) ? Object.keys(node) : [];
    for (const key of keys) {
      const at = { key, up: place };
      if (!visit(node, key, place ? place.key : null, at)) todo.push({ node: node[key], place: at });
    }
  }
}

/**
 * The config with each credential that is set replaced by the marker. A copy:
 * `config` is not changed.
 * @template T
 * @param {T} config
 * @returns {T}
 */
export function maskCredentials(config) {
  const out = structuredClone(config);
  walk(out, (container, key, parentKey) => {
    if (!isCredentialPlace(parentKey, key) || !isSet(container[key])) return false;
    container[key] = { ...STORED_MARKER };
    return true;
  });
  return out;
}

/**
 * The value at `path` in `root`, through own keys only; undefined when there
 * is none.
 * @param {unknown} root
 * @param {Array<string|number>} path
 */
function valueAt(root, path) {
  let v = root;
  for (const k of path) {
    if (Array.isArray(v) ? typeof k === 'number' && k < v.length : isPlainObject(v)) {
      if (!Object.hasOwn(/** @type {object} */ (v), k)) return undefined;
      v = /** @type {any} */ (v)[k];
    } else {
      return undefined;
    }
  }
  return v;
}

/** @param {Array<string|number>} path */
function pathText(path) {
  const text = path.join('.');
  return text.length > MAX_PATH_CHARS ? `${text.slice(0, MAX_PATH_CHARS)}…` : text;
}

/**
 * `posted` (a config as the read answered it, maybe edited) with each marker
 * replaced by a copy of the value `stored` has in the same place. A marker is
 * accepted only where reading `stored` now would put one. Anywhere else it is
 * refused: 409 where a credential goes but none is stored (it was removed
 * since the config was read), 400 for any other place, and 400 for an object
 * with `$stored` that is not exactly the marker. The error names the place,
 * never a value. `posted` is not changed.
 * @param {unknown} posted
 * @param {unknown} stored
 * @returns {{ ok: true, config: any } | { ok: false, status: 400|409, error: string }}
 */
export function restoreCredentials(posted, stored) {
  let out;
  try {
    out = structuredClone(posted);
  } catch {
    // Nested deeper than a copy can go (thousands of levels): no config is.
    return { ok: false, status: 400, error: 'Config is nested too deeply' };
  }
  /** @type {unknown} */
  let masked;
  /** @type {Array<{ status: 400|409, error: string }>} */
  const refused = [];
  walk(out, (container, key, parentKey, place) => {
    if (refused.length > 0) return true;
    const value = container[key];
    if (!isPlainObject(value) || !Object.hasOwn(value, MARKER_KEY)) return false;
    if (masked === undefined) masked = maskCredentials(stored);
    const path = pathOf(place);
    if (!isStoredMarker(value)) {
      refused.push({ status: 400, error: `Invalid stored-value marker at ${pathText(path)}` });
    } else if (isStoredMarker(valueAt(masked, path))) {
      container[key] = structuredClone(valueAt(stored, path));
    } else if (isCredentialPlace(parentKey, key)) {
      refused.push({
        status: 409,
        error: `No credential is stored at ${pathText(path)}; reload Settings and try again`,
      });
    } else {
      refused.push({
        status: 400,
        error: `A stored-value marker can stand only for a credential, not ${pathText(path)}`,
      });
    }
    return true;
  });
  return refused.length > 0 ? { ok: false, ...refused[0] } : { ok: true, config: out };
}
