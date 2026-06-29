// server/routes/watchtower.js
import { Router } from 'express';
import { parseWatchtowerReport } from '../watchtower/parse.js';
import { buildPushEvent, buildDiscordContent } from '../watchtower/format.js';
import { secretOk } from '../util/secretAuth.js';
import { apiError } from '../errors.js';

export function createWatchtowerRoutes({ store, fcm, dispatch, postDiscord, dedup, getEnv = () => process.env, logger = console }) {
  const router = Router();

  router.post('/event', async (req, res) => {
    try {
      const env = getEnv();
      if (!secretOk(env.JAGHELM_WATCHTOWER_SECRET || '', req.body?.secret)) {
        return apiError(res, 401, 'Unauthorized');
      }
      const node = typeof req.body?.node === 'string' && req.body.node ? req.body.node : 'unknown';
      const { updated, failed } = parseWatchtowerReport(req.body?.message);
      if (updated.length === 0 && failed.length === 0) {
        return res.json({ ok: true, skipped: 'empty' });
      }
      const report = { node, updated, failed };
      if (dedup.isDuplicate(report, Date.now())) {
        return res.json({ ok: true, deduped: true });
      }
      // Independent fan-out: one leg failing must not block the other.
      try {
        await dispatch([buildPushEvent(report)], { store, fcm, logger });
      } catch (err) {
        logger.warn({ err }, 'watchtower push dispatch failed');
      }
      try {
        await postDiscord(env.JAGHELM_WATCHTOWER_DISCORD_WEBHOOK || '', buildDiscordContent(report));
      } catch (err) {
        logger.warn({ err }, 'watchtower discord post failed');
      }
      return res.json({ ok: true, updated: updated.length, failed: failed.length });
    } catch (err) {
      // Truly unexpected pre-fan-out throw (secretOk/parse/dedup) — return 500
      // instead of leaking to Node's unhandledRejection. Fan-out errors are
      // already swallowed-and-logged by the inner try/catch blocks above.
      logger.warn({ err }, 'watchtower event handler failed');
      return apiError(res, 500, 'Internal error');
    }
  });

  return router;
}
