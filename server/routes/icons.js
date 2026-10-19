/**
 * Icon-related routes.
 *
 *   GET /api/icons          → search the icon index (auth required; called
 *                             from the Settings UI). The first search with no
 *                             index waits while it is fetched (server/icons.js).
 *   GET /api/icons/cached   → public proxy for jsdelivr/raw.githubusercontent
 *                             icon URLs, served from local disk after first
 *                             fetch. No auth — <img> tags can't set headers,
 *                             and the SSRF allowlist limits what can be fetched.
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

router.get('/cached', handleCachedIcon);

export { router as iconRoutes };
