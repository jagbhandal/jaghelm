/**
 * Embed check for app tabs (#269).
 *
 *   GET /api/embed-check/:tabId?origin=<the page's origin>[&fresh=1]
 *     → { url, verdict: 'blocked', header }   the app's headers refuse framing
 *     → { url, verdict: 'allowed' }           they let the page show it
 *     → { url, verdict: 'unknown', reason }   the server couldn't read them
 *     404 when the saved config has no app tab with that id; 400 on a bad origin.
 *
 * `url` is the saved URL that was checked, so the page can tell an answer for a
 * URL it has since edited (and not yet saved) from one for the URL it shows.
 * `header` is the one header line that blocks, clipped, never the whole CSP.
 * Behind the session like every other data route; what is fetched, and how, is
 * in server/embedCheck.js.
 */
import { Router } from 'express';

import { apiError } from '../errors.js';
import { createEmbedChecker, frameVerdict } from '../embedCheck.js';
import { readDisplayConfig } from '../refresh.js';
import { asyncHandler } from '../util/asyncHandler.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('embed-check');

/**
 * The page's origin, as the client sent it, or null unless it is exactly an
 * http(s) origin. It is only compared with the app's headers, never fetched.
 * @param {unknown} value
 */
function pageOrigin(value) {
  if (typeof value !== 'string' || value.length > 200) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin === value ? value : null;
  } catch {
    return null;
  }
}

export function createEmbedCheckRoutes(
  checker = createEmbedChecker({ readTabs: () => readDisplayConfig()?.tabs })
) {
  const router = Router();

  router.get(
    '/:tabId',
    asyncHandler(async (req, res) => {
      const origin = pageOrigin(req.query.origin);
      if (!origin) return apiError(res, 400, 'origin must be the page origin, such as https://jaghelm.example');
      const out = await checker.check(req.params.tabId, { fresh: req.query.fresh === '1' });
      if (!out) return apiError(res, 404, 'No saved app tab has that id');
      res.set('Cache-Control', 'no-store');
      if (!out.result.ok) {
        log.debug({ tab: req.params.tabId, reason: out.result.reason }, "Embed check couldn't read the app's headers");
        return res.json({ url: out.url, verdict: 'unknown', reason: out.result.reason });
      }
      res.json({ url: out.url, ...frameVerdict(out.result, origin) });
    })
  );

  return router;
}
