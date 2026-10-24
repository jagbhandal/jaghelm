/**
 * POST /api/containers/forget (#688): Remove on a missing container's card.
 * A container Jag took away on purpose stays a "Missing" warning for
 * JAGHELM_PRESENCE_TTL_MS (24 h) and keeps the board degraded; this forgets it
 * from the container registry now.
 *
 *   body { node, container }   exactly these two strings, no other key
 *   200  { forgotten: { node, container }, refreshed }   a background cycle then
 *        ran (for at most 4 s), so the card and the status are rebuilt without it (`refreshed`
 *        false: one already running kept it from running in time, and the next
 *        cycle does it)
 *   400  a body that isn't exactly that; 413 over 1 KB; 415 not JSON
 *   404  the board has no missing container by that node and name
 *   409  the container is running (or its card is not a missing one's: a
 *        monitor's red card, say), or its node is not reporting (off, or its
 *        cAdvisor blind: every container it remembers reads Missing): it is
 *        not forgotten
 *   429  too many tries; 503  no board yet (a cold start): try again
 *
 * Judged by the server's own board (the cached /api/services payload), never
 * by what the browser says: the card must be a presence card (`source:
 * 'presence'`), no running container of that name on any node, and the record
 * must be one the registry reports as missing. It touches nothing else: not
 * Docker, Kuma, services.yaml or the push state. A missing warning is no push
 * (push reads Kuma monitors, nodes, jobs and sources, not containers), so
 * removing one sends no recovery. If the container runs again, discovery
 * records it as a new one.
 *
 * Gated like the secrets API: behind the session, and refused outright (403)
 * while no dashboard password is set, unless JAGHELM_ALLOW_OPEN_SECRETS=true
 * (auth/middleware.js requireAuthEnabled, in index.js). The session travels in
 * the x-auth-token header, which a cross-site page cannot set, and a body must
 * be JSON, which a cross-site form cannot send.
 */
import { Router } from 'express';

import { apiError } from '../errors.js';
import { asyncHandler } from '../util/asyncHandler.js';
import { createRateLimiter } from '../util/rateLimiter.js';

const MAX_BODY_BYTES = 1024;
const MAX_NAME = 200;
const KEYS = ['container', 'node'];

// A node key or a container name: printable, no control characters.
const valid = (v) =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= MAX_NAME &&
  [...v].every((ch) => ch.charCodeAt(0) > 0x1f && ch.charCodeAt(0) !== 0x7f);

/** The card for `uid` and every non-presence card named `container`, from the cached services payload. */
function look(services, node, container) {
  let presence = null;
  let running = false;
  for (const [nodeKey, n] of Object.entries(services?.nodes ?? {})) {
    for (const card of n?.services ?? []) {
      if (card?.container !== container) continue;
      if (card.source === 'presence') {
        if (nodeKey === node) presence = card;
      } else {
        running = true;
      }
    }
  }
  return { presence, running };
}

/**
 * Whether the board's node is really reporting: reachable, and with at least
 * one card for something observed (a running container, a monitor's card). A
 * node that is off, or whose cAdvisor is blind (`up` but no container series),
 * draws every container it remembers as a presence card, and "missing" there
 * says nothing about what runs.
 */
export function nodeReporting(n) {
  return n?.reachable === true && (n.services ?? []).some((c) => c?.source !== 'presence');
}

/** The longest the response waits for the cycle that rebuilds the board. */
export const REFRESH_WAIT_MS = 4000;

/**
 * @param {object} deps
 * @param {{ getMissing: () => { container: string }[], forget: (name: string) => boolean }} deps.registry
 * @param {() => any} deps.services  the cached /api/services payload, or null
 * @param {() => Promise<boolean>} [deps.refreshNow]  runs a background cycle now; false: could not in time
 * @param {number} [deps.waitMs]  the most the response waits for that cycle
 * @param {(key: string) => boolean} [deps.limiter]  20 tries a minute per address by default
 */
export function createContainersRoutes({
  registry,
  services,
  refreshNow = async () => false,
  waitMs = REFRESH_WAIT_MS,
  limiter = createRateLimiter({ max: 20, windowMs: 60_000 }),
}) {
  const router = Router();

  router.post(
    '/forget',
    asyncHandler(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (!limiter(req.ip || 'unknown')) return apiError(res, 429, 'Too many tries: wait a minute.');
      if (Number(req.headers['content-length'] || 0) > MAX_BODY_BYTES) {
        return apiError(res, 413, 'That request is too large');
      }
      if (!req.is('application/json')) return apiError(res, 415, 'Send JSON');
      const body = req.body;
      const plain = body !== null && typeof body === 'object' && !Array.isArray(body);
      if (
        !plain ||
        Object.keys(body).sort().join() !== KEYS.join() ||
        !valid(body.node) ||
        !valid(body.container)
      ) {
        return apiError(res, 400, 'Send exactly { node, container }, each a short name');
      }
      const { node, container } = body;

      const board = services();
      if (!board) return apiError(res, 503, 'The board is not built yet: try again in a moment');
      const { presence, running } = look(board, node, container);
      if (running) {
        return apiError(res, 409, `${container} is running, so it is not missing and stays`);
      }
      const recorded = registry.getMissing().some((m) => m.container === container);
      if (!presence || !recorded) {
        return apiError(res, 404, `The board has no missing container ${container} on ${node}`);
      }

      if (!nodeReporting(board.nodes?.[node])) {
        return apiError(
          res,
          409,
          `${node} is not reporting, so ${container} may still be running there: Remove is offered once it is`
        );
      }

      registry.forget(container);
      // The board and the status are rebuilt now, by a background cycle, so
      // the card and the degraded status go at once. The response waits for it
      // at most `waitMs`; `refreshed: false` says it did not finish (or could
      // not start) in that time, and the board follows on a later cycle.
      let timer;
      const refreshed = await Promise.race([
        Promise.resolve(refreshNow()).catch(() => false),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), waitMs);
        }),
      ]);
      clearTimeout(timer);
      return res.json({ forgotten: { node, container }, refreshed });
    })
  );

  return router;
}
