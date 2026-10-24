// @ts-check
/**
 * The Android app's device records, retired with the Firebase sender (#659).
 *
 * Before then a phone with the app registered an FCM token in
 * data/push-tokens.json (one record per token, no `endpoint`); a browser's
 * Web Push subscription is a record with an `endpoint`
 * (push/webPushStore.js). Nothing sends to an FCM token any more, so at boot
 * every record in that file that is not a Web Push subscription is dropped,
 * with one info line saying how many (never a token), and the file written
 * back atomically the way the Web Push store writes its own (0600). A web
 * record is written back as it was read.
 *
 * Nothing to do (and nothing logged) when the file is missing, is not JSON or
 * not an object, or holds no FCM record. Never throws: a file that cannot be
 * read or written is left as it is with one warn line, and push is unaffected.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWriteFileSync } from '../util/atomicWrite.js';
import { DATA_DIR } from '../util/dataDir.js';
import { createLogger } from '../util/logger.js';

const defaultLog = createLogger('push-retired');

export const RETIRED_TOKENS_FILE = 'push-tokens.json';

/**
 * @param {{ path?: string, logger?: { info: Function, warn: Function } }} [opts]
 * @returns {number} how many FCM records were dropped
 */
export function dropRetiredFcmRecords({ path = join(DATA_DIR, RETIRED_TOKENS_FILE), logger = defaultLog } = {}) {
  try {
    if (!existsSync(path)) return 0;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      // Not JSON: not ours to repair or to talk about (an unreadable file is the write's warning).
      if (err instanceof SyntaxError) return 0;
      throw err;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 0;
    /** @type {Record<string, unknown>} */
    const kept = {};
    let dropped = 0;
    for (const key of Object.keys(parsed)) {
      const rec = parsed[key];
      if (rec && typeof rec === 'object' && typeof rec.endpoint === 'string') {
        Object.defineProperty(kept, key, { value: rec, writable: true, enumerable: true, configurable: true });
      } else {
        dropped += 1;
      }
    }
    if (dropped === 0) return 0;
    atomicWriteFileSync(path, JSON.stringify(kept, null, 2), { mode: 0o600 });
    logger.info({ dropped }, 'dropped the retired Android app device records; Web Push is the only phone channel');
    return dropped;
  } catch (err) {
    // The error names the path, never a record.
    logger.warn({ code: /** @type {any} */ (err)?.code }, 'could not clear the retired Android app device records');
    return 0;
  }
}
