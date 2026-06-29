// server/routes/watchtower.js
import { Router } from 'express';
import { parseWatchtowerReport } from '../watchtower/parse.js';
import { buildPushEvent, buildDiscordContent, buildHeldBackPushEvent, buildClearedPushEvent } from '../watchtower/format.js';
import { secretOk } from '../util/secretAuth.js';
import { apiError } from '../errors.js';

export function createWatchtowerRoutes({ store, fcm, dispatch, postDiscord, dedup, heldBackStore, getEnv = () => process.env, logger = console }) {
  const router = Router();

  router.post('/event', async (req, res) => {
    try {
      const env = getEnv();
      if (!secretOk(env.JAGHELM_WATCHTOWER_SECRET || '', req.body?.secret)) {
        return apiError(res, 401, 'Unauthorized');
      }
      const rawNode = typeof req.body?.node === 'string' && req.body.node ? req.body.node : 'unknown';
      const node = rawNode.slice(0, 256); // bound the one free-form field (matches cron.js discipline)
      const { updated, failed, stale } = parseWatchtowerReport(req.body?.message);

      // State leg — held-back is a STANDING STATE, not an event. Diff the stale
      // set against persisted per-node state FIRST so the store always advances,
      // even on a run we ultimately skip. newlyHeldBack/cleared are transitions;
      // `current` is the full standing set (the Discord digest surface).
      const { newlyHeldBack, cleared, current } = heldBackStore.diffAndSet(node, stale);

      // Event leg — updated/failed ARE events; the time-window dedup absorbs
      // shoutrrr retries. dedup is only consulted (and recorded) when there's an
      // event to dedup, so a stale-only run never pollutes the event window.
      const hasEvent = updated.length > 0 || failed.length > 0;
      const eventIsNew = hasEvent && !dedup.isDuplicate({ node, updated, failed }, Date.now());

      // Skip rule — say nothing when there's no new event AND no held-back
      // transition. This is what stops a monitor-only backlog from re-pinging
      // every poll cycle (containrrr/watchtower#1962).
      if (!eventIsNew && newlyHeldBack.length === 0 && cleared.length === 0) {
        if (updated.length === 0 && failed.length === 0 && stale.length === 0) {
          return res.json({ ok: true, skipped: 'empty' });
        }
        return res.json({ ok: true, skipped: hasEvent ? 'deduped' : 'no-change', ...(hasEvent ? { deduped: true } : {}) });
      }

      const pushEvents = [];
      if (eventIsNew) pushEvents.push(buildPushEvent({ node, updated, failed }));
      if (newlyHeldBack.length) pushEvents.push(buildHeldBackPushEvent({ node, heldBack: newlyHeldBack }));
      if (cleared.length) pushEvents.push(buildClearedPushEvent({ node, cleared }));

      const discordContent = buildDiscordContent({
        node,
        updated: eventIsNew ? updated : [],
        failed: eventIsNew ? failed : [],
        heldBack: current, // full standing set, not just the newly-held-back
        cleared,
      });

      // Independent fan-out — run concurrently; each leg is isolated so one
      // failing (sync throw or async rejection) never blocks the other.
      await Promise.allSettled([
        Promise.resolve()
          .then(() => dispatch(pushEvents, { store, fcm, logger }))
          .catch((err) => logger.warn({ err }, 'watchtower push dispatch failed')),
        Promise.resolve()
          .then(() => postDiscord(env.JAGHELM_WATCHTOWER_DISCORD_WEBHOOK || '', discordContent))
          .catch((err) => logger.warn({ err }, 'watchtower discord post failed')),
      ]);
      return res.json({
        ok: true,
        updated: eventIsNew ? updated.length : 0,
        failed: eventIsNew ? failed.length : 0,
        heldBack: newlyHeldBack.length,
        cleared: cleared.length,
      });
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
