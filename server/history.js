/**
 * JagHelm metric history — a tiny in-memory ring buffer per metric series.
 *
 * The refresh loop already fetches every node's CPU/RAM/disk usage every cycle
 * and then throws the samples away. This keeps the last MAX_SAMPLES of each
 * series (≈1h at a 30s refresh) so the UI can draw a glance-context sparkline
 * behind a number ("94% — and climbing"). It is NOT a time-series database:
 * it's a fixed-size window, persisted best-effort so it survives a redeploy.
 */

import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { atomicWriteFileSync } from './util/atomicWrite.js';
import { DATA_DIR } from './util/dataDir.js';
import { createLogger } from './util/logger.js';

const log = createLogger('history');

const STORE_PATH = join(DATA_DIR, 'history.json');
const MAX_SAMPLES = 120; // ~1h at a 30s refresh
const MAX_SERIES = 500; // bound distinct keys so a churn of node ids can't grow unbounded
const SAVE_DEBOUNCE_MS = 60_000;

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

function load() {
  try {
    if (!existsSync(STORE_PATH)) return new Map();
    const obj = JSON.parse(readFileSync(STORE_PATH, 'utf8'));
    const m = new Map();
    for (const [k, v] of Object.entries(obj || {})) {
      if (Array.isArray(v)) {
        const nums = v.filter((n) => Number.isFinite(n)).slice(-MAX_SAMPLES);
        if (nums.length) m.set(k, nums);
      }
    }
    return m;
  } catch {
    return new Map();
  }
}

/** @type {Map<string, number[]>} */
let series = load();
let saveTimer = null;

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      atomicWriteFileSync(STORE_PATH, JSON.stringify(Object.fromEntries(series)));
    } catch (err) {
      log.error({ err }, 'Failed to save history');
    }
  }, SAVE_DEBOUNCE_MS);
  if (saveTimer.unref) saveTimer.unref(); // never hold the process open for a flush
}

/**
 * Append one sample to a series, capped to the last MAX_SAMPLES. Non-finite
 * values are skipped — a gap is more honest than a fake 0 on the sparkline.
 */
export function recordSample(key, value) {
  // Guard null/''/undefined BEFORE Number(): Number(null)===0 and Number('')===0
  // would record a fake 0% for a missing metric instead of leaving a gap.
  if (value == null || value === '') return;
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  let arr = series.get(key);
  if (!arr) {
    if (series.size >= MAX_SERIES) return;
    arr = [];
    series.set(key, arr);
  }
  arr.push(Math.round(n * 10) / 10);
  if (arr.length > MAX_SAMPLES) arr.splice(0, arr.length - MAX_SAMPLES);
  scheduleSave();
}

/** Record a whole cycle's worth of `{ key: value }` samples. */
export function recordSamples(map) {
  for (const [k, v] of Object.entries(map || {})) recordSample(k, v);
}

/**
 * Snapshot of every series as a plain object of COPIED arrays, so a caller can't
 * mutate the live ring buffers. Cheap (≤ MAX_SERIES × MAX_SAMPLES numbers).
 */
export function getHistory() {
  const out = {};
  for (const [k, v] of series) out[k] = v.slice();
  return out;
}

/** Test seam: clear in-memory state. */
export function _reset() {
  series = new Map();
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}
