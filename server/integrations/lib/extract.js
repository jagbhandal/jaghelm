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
 *   - '_length'                  — array length
 *   - '_filter:field=value'      — count items matching a predicate (also: >, <, >=, <=)
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
    const isNumeric = !isNaN(numVal);
    return data.filter(item => {
      const itemVal = item[field];
      if (itemVal == null) return false;
      switch (op) {
        case '=': return isNumeric ? itemVal == numVal : String(itemVal) === value;
        case '>': return itemVal > numVal;
        case '<': return itemVal < numVal;
        case '>=': return itemVal >= numVal;
        case '<=': return itemVal <= numVal;
        default: return false;
      }
    }).length;
  }

  // Standard dot-notation traversal
  const parts = path.split('.');
  let current = data;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}
