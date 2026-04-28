/**
 * Icon-related routes.
 *
 *   GET /api/icons          → search the bundled icon index
 *                             (auth required; called from the Settings UI)
 *   GET /api/icons/cached   → public proxy for jsdelivr/raw.githubusercontent
 *                             icon URLs, served from local disk after first
 *                             fetch. No auth — <img> tags can't set headers,
 *                             and the SSRF allowlist limits what can be fetched.
 */

import { Router } from 'express';

import { authMiddleware } from '../auth/middleware.js';
import { searchIcons, getIconCount } from '../icons.js';
import { handleCachedIcon } from '../icon-cache.js';

const router = Router();

router.get('/', authMiddleware, (req, res) => {
  const q = (req.query.q || '').trim();
  const limit = Math.min(parseInt(req.query.limit) || 60, 200);
  const results = searchIcons(q, limit);
  res.json({ count: getIconCount(), results });
});

router.get('/cached', handleCachedIcon);

export { router as iconRoutes };
