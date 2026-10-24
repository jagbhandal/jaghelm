/**
 * /api/events for the web's tests (#314): the demo's
 * own history (server/demoEvents.js), paged and filtered by the live store
 * and the live route's query reader (server/demo.js demoResponse), so a test
 * reads what a server would send for its query. `now` fixes the clock.
 */
import { demoResponse } from '../../server/demo.js';

/** A fetch Response-like of `body` with `status`. */
export function respondJson(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

/** The query of `url` as Express reads it: a repeated key is a list. */
function queryOf(url) {
  const query = {};
  for (const [key, value] of new URL(String(url), 'http://jaghelm').searchParams) {
    query[key] = Object.hasOwn(query, key) ? [].concat(query[key], value) : value;
  }
  return query;
}

/** The demo's answer to a GET of `url` (…/api/events?…) in `scenario` at `now`. */
export function eventsAnswer(url, { scenario = 'incident', now } = {}) {
  const out = demoResponse({ path: '/api/events', query: queryOf(url), scenario, now });
  return respondJson(out.body, out.status);
}

/** Whether `url` is a request for /api/events. */
export const isEvents = (url) =>
  new URL(String(url), 'http://jaghelm').pathname.endsWith('/api/events');

/** The query `url` asked /api/events, as an object of strings. */
export const eventsQueryOf = (url) =>
  Object.fromEntries(new URL(String(url), 'http://jaghelm').searchParams);
