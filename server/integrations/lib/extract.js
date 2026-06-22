/**
 * JSON value extraction + URL templating helpers.
 *
 * Pure functions, no I/O, no module state.
 */

/**
 * Replace {placeholder} tokens in endpoint URLs with config values.
 * Used by presets that require dynamic URL segments (e.g. Cloudflare account_id).
 * Looks up the key in config directly, then falls back to _prefixed version.
 */
export function resolveEndpointParams(endpoint, config) {
  return endpoint.replace(/\{(\w+)\}/g, (match, key) => {
    return config[key] || config[`_${key}`] || match;
  });
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
