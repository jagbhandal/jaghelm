/**
 * System routes: health probe and proxied weather data.
 *
 *   GET /api/health   → public — returns version + uptime
 *   GET /api/weather  → auth   — proxies open-meteo with caching
 */

import { Router } from 'express';

import { authMiddleware } from '../auth/middleware.js';
import { getCached, setCache } from '../cache.js';
import { apiError } from '../errors.js';
import { safeFetch } from '../httpClient.js';
import { asyncHandler } from '../util/asyncHandler.js';
import { VERSION } from '../version.js';
import { getRefreshHealth } from '../refresh.js';

const router = Router();

router.get('/health', (req, res) => {
  // Reflect real liveness: the Docker HEALTHCHECK + deploy verify gate read this,
  // so a static 'ok' would let a wedged refresh loop (stale data) pass as healthy.
  // 'starting' (pre-first-cycle) still reports ok so a booting container isn't killed.
  const refresh = getRefreshHealth();
  const healthy = refresh.state !== 'stale';
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    refresh: refresh.state,
    refreshAgeMs: refresh.ageMs,
    uptime: process.uptime(),
    version: VERSION,
  });
});

router.get('/weather', authMiddleware, asyncHandler(async (req, res) => {
  // Validate to a real coordinate: keeps the (bounded) cache keyed to a finite
  // space and stops arbitrary strings flowing into the upstream request.
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (
    !Number.isFinite(lat) || !Number.isFinite(lon) ||
    lat < -90 || lat > 90 || lon < -180 || lon > 180
  ) {
    return apiError(res, 400, 'Invalid lat/lon');
  }

  const cacheKey = `weather-${lat}-${lon}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const r = await safeFetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m` +
        `&temperature_unit=fahrenheit&wind_speed_unit=mph`
    );
    const data = await r.json();
    setCache(cacheKey, data);
    res.json(data);
  } catch (err) {
    apiError(res, 502, 'Weather unreachable', err);
  }
}));

export { router as systemRoutes };
