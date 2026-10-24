/**
 * Where the disk forecast turns amber and red (#670): days left, whole days,
 * `crit` under `warn`. Kept apart from configSchema.js (which needs zod) so
 * the web can read it too. The forecast itself is the server's
 * (diskForecast.js); these lines are only how it is drawn.
 */
export const DISK_FORECAST_DEFAULT = Object.freeze({ warn: 14, crit: 3 });
export const DISK_FORECAST_LIMITS = Object.freeze({ min: 1, max: 365 });

const whole = (v) =>
  Number.isInteger(v) && v >= DISK_FORECAST_LIMITS.min && v <= DISK_FORECAST_LIMITS.max;

/** Whether `v` is a saved pair that can be used: whole days, 1 to 365, `crit` under `warn`. */
export const isForecastLines = (v) =>
  v !== null && typeof v === 'object' && whole(v.warn) && whole(v.crit) && v.crit < v.warn;

/** The lines to draw by: the saved pair, or the defaults when none is saved or it is no pair. */
export const forecastLines = (saved) =>
  isForecastLines(saved) ? { warn: saved.warn, crit: saved.crit } : { ...DISK_FORECAST_DEFAULT };
