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

const router = Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), version: '8.0.0-alpha.1' });
});

router.get('/weather', authMiddleware, asyncHandler(async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return apiError(res, 400, 'Missing lat/lon');

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
