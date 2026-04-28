/**
 * Build outbound auth headers for a request based on the integration's auth type.
 *
 * Handles: basic, bearer, header, query (no-op — handled at URL build time),
 * session (no-op — handled by lib/session.js), none.
 *
 * Also merges in any preset-defined extraHeaders.
 */
export function buildAuthHeaders(config) {
  const headers = {};

  // Add any extra headers from preset
  if (config.extraHeaders) {
    Object.assign(headers, config.extraHeaders);
  }

  switch (config.auth) {
    case 'basic': {
      const u = config._username || '';
      const p = config._password || '';
      if (u || p) {
        headers['Authorization'] = 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
      }
      break;
    }
    case 'bearer': {
      const token = config._token || '';
      if (token) headers['Authorization'] = `Bearer ${token}`;
      break;
    }
    case 'header': {
      const headerName = config.authHeader || 'X-API-Key';
      const prefix = config.authPrefix || '';
      const token = config._token || '';
      if (token) headers[headerName] = prefix + token;
      break;
    }
    case 'query':
      // Query param auth is handled in URL construction, not headers
      break;
    case 'session':
      // Session auth requires a login step — handled in fetchWithSession()
      break;
    case 'none':
    default:
      break;
  }

  return headers;
}
