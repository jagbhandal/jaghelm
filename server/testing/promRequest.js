/**
 * What a test's fake Prometheus reads a query from. Every Prometheus query is
 * a POST whose parameters are an application/x-www-form-urlencoded body, so
 * the URL stays short however long the selector (a proxy's request-line limit
 * answers 414). A fake that took the query from the URL would pass on a GET;
 * this throws on anything but that shape, so a regression to GET fails loudly.
 *
 * @param {string|URL} url
 * @param {{ method?: string, headers?: HeadersInit, body?: unknown }} [init]
 * @returns {URLSearchParams} the query, start, end and step the request carried
 */
export function promParams(url, init = {}) {
  const u = new URL(String(url));
  if (init.method !== 'POST') throw new Error(`Prometheus query sent as ${init.method || 'GET'}, not POST: ${url}`);
  if (u.search) throw new Error(`Prometheus query left parameters in the URL: ${url}`);
  const type = new Headers(init.headers || {}).get('content-type');
  if (type !== 'application/x-www-form-urlencoded') throw new Error(`Prometheus query content-type is ${type}`);
  if (typeof init.body !== 'string') throw new Error('Prometheus query body is not a string');
  return new URLSearchParams(init.body);
}

/**
 * The text a fake Prometheus matches on: the query of a query or query_range
 * request, read from its POST body by promParams (so a GET fails), and the
 * decoded URL for any other endpoint.
 *
 * @param {string|URL} url
 * @param {{ method?: string, headers?: HeadersInit, body?: unknown }} [init]
 * @returns {string}
 */
export function queryText(url, init) {
  const { pathname } = new URL(String(url));
  if (pathname === '/api/v1/query' || pathname === '/api/v1/query_range') return promParams(url, init).get('query');
  return decodeURIComponent(String(url));
}
