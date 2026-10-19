/**
 * Logs a data source failing and recovering, once each (#232): a warning on the
 * first cycle it fails, with the error, and an info line on the first cycle it
 * answers again. The cycles in between log at debug only. Prometheus (the
 * services refresh) and Kuma (fetchMonitors) each keep one.
 *
 * @param {string} source  the source's name, logged as `source`
 * @param {object} logger  the caller's module logger
 */
export function createSourceHealthLog(source, logger) {
  let failingSince = null; // ms epoch of the first failed cycle; null while ok
  return function report({ ok, error }, now = Date.now()) {
    if (!ok) {
      if (failingSince === null) {
        failingSince = now;
        logger.warn({ source, error }, 'data source failed; push alerts keep its last known state until it recovers');
      } else {
        logger.debug({ source, error }, 'data source still failing');
      }
    } else if (failingSince !== null) {
      logger.info({ source, downSec: Math.round((now - failingSince) / 1000) }, 'data source recovered');
      failingSince = null;
    }
  };
}
