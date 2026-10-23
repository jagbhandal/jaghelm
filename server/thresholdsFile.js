/**
 * thresholds.json (#320): the threshold lines Settings → Notifications saved,
 * in JAGHELM_DATA_DIR beside display-config.json. PUT /api/thresholds
 * (routes/thresholds.js) writes it; the refresh loop reads it every cycle
 * through readSavedThresholds(), so the status model, and push with it, judge
 * by a save from the next cycle on.
 *
 * It holds the metrics set away from their defaults, each with its unit
 * (status/thresholdTable.js): `{ "disk": { "warn": 88, "crit": 94, "unit": "%" } }`.
 * Read like display-config.json (refresh.js readDisplayConfig): parsed again
 * only when its identity (mtime, size, inode) changes, so a hand edit counts
 * from the next cycle, and the route drops the cached copy after each save.
 *
 * A file that doesn't parse, or holds a line a save would refuse (the same
 * checks, readThresholdTable), is not used: the thresholds are then what
 * they would be with no file (display-config.json's `pushThresholds` over the
 * defaults), with one warning per version of the file, naming why but never
 * quoting it (#504). A file that can't be read is the same, warned once.
 */
import { readFileSync, statSync } from 'fs';
import { join } from 'path';

import { readThresholdTable } from './status/thresholdTable.js';
import { DATA_DIR } from './util/dataDir.js';
import { createLogger } from './util/logger.js';
import { describeParseError, jsonParseError } from './util/parseError.js';
import { readErrorWords } from './util/fileVersion.js';

const log = createLogger('thresholds');

export const THRESHOLDS_PATH = join(DATA_DIR, 'thresholds.json');

/**
 * The file's bytes as saved lines: `{ lines }`, or `{ unusable }`, why they
 * can't be used, in words that never quote the file.
 *
 * @param {Buffer | string} bytes
 * @returns {{ lines: import('./status/thresholdTable.js').SavedLines } | { unusable: string }}
 */
export function parseSavedThresholds(bytes) {
  let data;
  try {
    data = JSON.parse(bytes.toString());
  } catch (err) {
    const why = describeParseError(jsonParseError(err));
    return { unusable: `thresholds.json doesn't parse (${why}); the next save rewrites it` };
  }
  const read = readThresholdTable(data);
  if ('error' in read) {
    return {
      unusable: `thresholds.json holds a line JagHelm won't use (${read.error}); the next save rewrites it`,
    };
  }
  return { lines: read.lines };
}

let cached; // undefined: not read yet; null: no file, or none JagHelm can use
let cachedId = null; // the file identity `cached` was read from
let warnedId = null; // the identity last warned about

function fileId() {
  try {
    const st = statSync(THRESHOLDS_PATH);
    return `${st.mtimeMs}:${st.size}:${st.ino}`;
  } catch (err) {
    return err?.code === 'ENOENT' ? null : `error:${err?.code ?? 'unknown'}`;
  }
}

/** Forget the cached copy: the route calls it after a save. */
export function invalidateSavedThresholds() {
  cached = undefined;
}

/**
 * The saved lines (status/thresholds.js resolveThresholds' `saved`), or null:
 * no file, or one that can't be read or used (warned once per version).
 *
 * @returns {import('./status/thresholdTable.js').SavedLines | null}
 */
export function readSavedThresholds() {
  const id = fileId();
  if (cached !== undefined && id === cachedId) return cached;
  cachedId = id;
  cached = null;
  if (id === null) return null;
  const warnOnce = (msg, fields = {}) => {
    if (warnedId === id) return;
    warnedId = id;
    log.warn(fields, msg);
  };
  let bytes;
  try {
    bytes = readFileSync(THRESHOLDS_PATH);
  } catch (err) {
    warnOnce(
      `thresholds.json can't be read (${readErrorWords(err)}); judging by the thresholds as if it weren't there`
    );
    return null;
  }
  const parsed = parseSavedThresholds(bytes);
  if ('unusable' in parsed) {
    warnOnce(`${parsed.unusable}; until then the thresholds are as if it weren't there`);
    return null;
  }
  cached = parsed.lines;
  return cached;
}
