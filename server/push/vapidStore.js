/**
 * JagHelm's own VAPID key pair for Web Push (#698): made on the first boot
 * that finds VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY both unset, kept in
 * DATA_DIR/vapid-keys.json (mode 0600) and read back on every later boot, so a
 * container user needs no extra tooling. Env values always win: this is only
 * asked when neither is set (channels.js initWebPush).
 *
 *   - Made once. The file is written to a temp sibling and hard-linked into
 *     place (createExclusiveFileSync), so two boots racing end up with one
 *     pair: the loser reads the winner's.
 *   - Never replaced silently. Every browser's subscription is bound to the
 *     public key, so a new pair turns them all "needs turning on again". A file
 *     that can't be read, or isn't a matching pair, is therefore an error with a
 *     message naming the file, and Web Push stays off, UNLESS no browser is
 *     subscribed: then nothing is orphaned and a new pair is made (and logged).
 *   - The private key appears in the file and in memory (as a key object, in
 *     webPush.js) only: never in a log line, error, status or response. Errors
 *     name the file and a code, never its content.
 */
import { readFileSync, unlinkSync } from 'fs';
import { join } from 'path';

import { createExclusiveFileSync } from '../util/atomicWrite.js';
import { DATA_DIR } from '../util/dataDir.js';
import { generateVapidKeys } from './webPushCrypto.js';
import { readVapid, DEFAULT_VAPID_SUBJECT } from './webPush.js';

export const VAPID_KEY_FILE = join(DATA_DIR, 'vapid-keys.json');

/**
 * @typedef {{ ok: true, publicKey: string, privateKey: string, created: boolean, replaced?: boolean }
 *   | { ok: false, detail: string }} VapidKeysResult
 */

/** The pair on disk: `null` for no file, `{ bad: detail }` for a file that is no good. */
function readStored(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    return { bad: `can't read ${path} (${err.code}), the Web Push key pair`, unreadable: true };
  }
  try {
    const parsed = JSON.parse(text);
    const publicKey = typeof parsed?.publicKey === 'string' ? parsed.publicKey : '';
    const privateKey = typeof parsed?.privateKey === 'string' ? parsed.privateKey : '';
    const fits = readVapid({
      VAPID_PUBLIC_KEY: publicKey,
      VAPID_PRIVATE_KEY: privateKey,
      VAPID_SUBJECT: DEFAULT_VAPID_SUBJECT,
    });
    if (fits.enabled) return { publicKey, privateKey };
  } catch {
    // Not JSON: the same answer as a pair that does not fit.
  }
  return { bad: `${path} is not a valid Web Push key pair` };
}

/**
 * The stored pair, made first if there is none. Never throws; never puts a key
 * in `detail`.
 * @param {object} [opts]
 * @param {string} [opts.path]
 * @param {() => number} [opts.subscriptionCount]  browsers that would be orphaned by a new pair
 * @param {{ info: Function, warn: Function }} [opts.logger]
 * @returns {VapidKeysResult}
 */
export function loadOrCreateVapidKeys({ path = VAPID_KEY_FILE, subscriptionCount = () => 0, logger } = {}) {
  try {
    let stored = readStored(path);
    let replaced = false;
    if (stored && 'bad' in stored) {
      const count = stored.unreadable ? Infinity : subscriptionCount();
      if (count !== 0) {
        const orphans = Number.isFinite(count) ? `${count} browser${count === 1 ? ' is' : 's are'} subscribed with it and would need alerts turned on again. ` : '';
        return {
          ok: false,
          detail:
            `${stored.bad}. JagHelm will not make a new pair over it: ${orphans}` +
            `Restore the file from a backup, or remove it to let JagHelm make a new pair`,
        };
      }
      // Nothing subscribed: nothing to orphan.
      unlinkSync(path);
      stored = null;
      replaced = true;
    }
    if (stored) return { ok: true, ...stored, created: false };

    const made = generateVapidKeys();
    const body = Buffer.from(`${JSON.stringify({ publicKey: made.publicKey, privateKey: made.privateKey }, null, 2)}\n`);
    const won = createExclusiveFileSync(path, body, { mode: 0o600 });
    // Ours, or the pair another boot linked in first.
    const now = readStored(path);
    if (!now || 'bad' in now) return { ok: false, detail: `${path} could not be read back after it was made` };
    if (won) {
      logger?.info(
        replaced
          ? 'web push: the key pair file was unusable and no browser was subscribed: made a new one (vapid-keys.json)'
          : 'web push: made a new VAPID key pair (vapid-keys.json)'
      );
    }
    return { ok: true, ...now, created: won, ...(replaced ? { replaced } : {}) };
  } catch (err) {
    return { ok: false, detail: `can't keep the Web Push key pair in ${path} (${err?.code ?? 'error'}): is the data directory writable?` };
  }
}
