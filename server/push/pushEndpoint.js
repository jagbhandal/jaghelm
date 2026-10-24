// @ts-check
/**
 * Which URLs a Web Push subscription may name (#653). The endpoint is the
 * address the server POSTs every alert to, and a logged-in user supplies it:
 * left unchecked it would be a server-side request forgery primitive (the
 * server posting to 192.168.x.x, a metadata address or any host the poster
 * likes, with a signed VAPID header). So the endpoint must be one of the
 * browsers' own push services, by host.
 *
 * The decision (docs/ARCHITECTURE.md, Web Push): an allowlist of the known push
 * services, by host suffix, rather than the private-network blocklist
 * (util/ssrf.js) that guards integrations. A blocklist leaves every public host
 * open to a hostile endpoint, one that logs the VAPID token or answers slowly,
 * and says nothing about DNS names that resolve inward; the real push services
 * are a short, stable list. A browser on a service not listed is refused with
 * a message that says so, and the list is one line to extend.
 *
 * Also required: https, no credentials, the default port, no fragment, at most
 * MAX_ENDPOINT_LENGTH characters, a path (a bare host is no subscription).
 * Never throws; the reasons name no part of the URL.
 */

/** Longest endpoint kept; real ones run 150 to 500 characters. */
export const MAX_ENDPOINT_LENGTH = 1024;

/**
 * The push services' hosts: the name itself, or any subdomain of a suffix.
 *  - fcm.googleapis.com: Chrome, Edge and Samsung Internet on Android and desktop
 *  - updates.push.services.mozilla.com: Firefox (and its regional hosts below)
 *  - *.push.apple.com: Safari and installed web apps on iOS and macOS (web.push.apple.com)
 *  - *.notify.windows.com: Edge on Windows (WNS)
 */
export const PUSH_SERVICE_SUFFIXES = Object.freeze([
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
]);

/** Whether `host` is one of PUSH_SERVICE_SUFFIXES or a subdomain of one. @param {string} host */
export function isPushServiceHost(host) {
  return PUSH_SERVICE_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/**
 * The endpoint as a URL object, or why it is refused.
 * @param {unknown} endpoint
 * @returns {{ ok: true, url: URL } | { ok: false, reason: string }}
 */
export function checkEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint === '') {
    return { ok: false, reason: 'The subscription has no endpoint' };
  }
  if (endpoint.length > MAX_ENDPOINT_LENGTH) {
    return { ok: false, reason: 'The subscription endpoint is too long' };
  }
  // Control characters, whitespace and backslashes: parsers disagree about them.
  if ([...endpoint].some((c) => c <= ' ' || c === '\u007f' || c === '\\')) {
    return { ok: false, reason: 'The subscription endpoint is not a valid URL' };
  }
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, reason: 'The subscription endpoint is not a valid URL' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'The subscription endpoint must be https' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'The subscription endpoint must not carry a user name or password' };
  }
  if (url.port !== '') {
    return { ok: false, reason: 'The subscription endpoint must use the default https port' };
  }
  if (url.hash !== '') {
    return { ok: false, reason: 'The subscription endpoint must not have a fragment' };
  }
  if (url.pathname === '/' && url.search === '') {
    return { ok: false, reason: 'The subscription endpoint has no path' };
  }
  if (!isPushServiceHost(url.hostname)) {
    return {
      ok: false,
      reason:
        "This browser's push service is not one JagHelm sends to (Chrome, Edge, Firefox and Safari are)",
    };
  }
  return { ok: true, url };
}
