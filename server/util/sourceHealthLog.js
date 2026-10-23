/**
 * Logs a data source failing and recovering, once per failure state (#232,
 * #605): a warning on the first cycle it fails, with the error's raw detail
 * (`error`) and the words a client is told (`words`, failureWords.js), another
 * on a cycle it fails for another reason (its words change: refused, then
 * timing out), and an info line on the first cycle it answers again. The
 * cycles in between log at debug only, so a raw error that varies every cycle
 * (a port) is not a new state. Prometheus (the services refresh) and Kuma
 * (fetchMonitors) each keep one.
 *
 * @param {string} source  the source's name, logged as `source`
 * @param {object} logger  the caller's module logger
 */
export function createSourceHealthLog(source, logger) {
  let failingSince = null; // ms epoch of the first failed cycle; null while ok
  let failingWords = null; // what the failure is told as, while failing
  return function report({ ok, error, words = null }, now = Date.now()) {
    if (!ok) {
      const said = words ? { words } : {};
      if (failingSince === null) {
        failingSince = now;
        failingWords = words;
        logger.warn({ source, error, ...said }, 'data source failed; push alerts keep its last known state until it recovers');
      } else if (words !== failingWords) {
        failingWords = words;
        logger.warn({ source, error, ...said }, 'data source failing for another reason');
      } else {
        logger.debug({ source, error }, 'data source still failing');
      }
    } else if (failingSince !== null) {
      logger.info({ source, downSec: Math.round((now - failingSince) / 1000) }, 'data source recovered');
      failingSince = null;
      failingWords = null;
    }
  };
}
