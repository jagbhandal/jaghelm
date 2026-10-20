/**
 * Icon-related routes.
 *
 *   GET /api/icons          → search the icon index (auth required; called
 *                             from the Settings UI). The first search with no
 *                             index waits while it is fetched (server/icons.js).
 *   GET /api/icons/cached   → public cache of icon-repository icons (Dashboard
 *                             Icons, selfh.st on jsDelivr/raw.githubusercontent),
 *                             served from local disk after first fetch. No auth —
 *                             <img> tags can't set headers; the allowlist
 *                             (icon-sources.js) and the size caps in
 *                             icon-cache.js bound what it fetches and keeps.
 */

import { Router } from 'express';

import { authMiddleware } from '../auth/middleware.js';
import { asyncHandler } from '../util/asyncHandler.js';
import { ensureIconIndex, searchIcons, getIconCount } from '../icons.js';
import { handleCachedIcon } from '../icon-cache.js';

const router = Router();

router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  await ensureIconIndex();
  const q = (req.query.q || '').trim();
  const limit = Math.min(parseInt(req.query.limit) || 60, 200);
  const results = searchIcons(q, limit);
  res.json({ count: getIconCount(), results });
}));

router.get('/cached', asyncHandler(handleCachedIcon));

export { router as iconRoutes };
