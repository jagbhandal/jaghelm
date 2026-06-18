/**
 * Immutably set `value` at a dotted (or array) `path` in `obj`, returning a new
 * object. Only the nodes ALONG the path are cloned (structural sharing) — unlike
 * a full JSON deep-clone, untouched branches keep their reference identity, so
 * React.memo'd subtrees that didn't change won't see a new prop and re-render.
 *
 * Missing intermediate objects are created. Arrays are cloned as arrays so a
 * numeric key updates an element without turning the array into an object.
 *
 *   setIn(cfg, 'display.theme', 'dark')   // -> new cfg, cfg untouched
 *   setIn(cfg, 'tabs', nextTabsArray)     // replace a whole branch
 */
export function setIn(obj, path, value) {
  const keys = Array.isArray(path) ? path : String(path).split('.');
  if (keys.length === 0) return value;
  const [key, ...rest] = keys;
  const clone = Array.isArray(obj) ? obj.slice() : { ...(obj || {}) };
  clone[key] = rest.length === 0 ? value : setIn(clone[key], rest, value);
  return clone;
}
