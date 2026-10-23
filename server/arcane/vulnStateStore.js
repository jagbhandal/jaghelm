/**
 * The weekly vulnerability digest's state.
 *
 * Per environment: the critical/high finding keys seen at the last digest, the KEV
 * count then, the images then stale or failed (so only a newly stale or failed one
 * pushes), and when it ran. Plus the time of the last digest run, so a restart can
 * tell whether it missed a weekly slot.
 *
 * Held in memory. Since #581 the digest's notices persist it (arcane/notices.js):
 * `toFile()` goes into push-snapshot.json in the same write that queues the run's
 * pushes, and `initial` is what that file holds (or, once, the arcane-vuln-state.json
 * of a JagHelm before #581). The file is rewritten with every push and history
 * change, so the key sets ride along (a few hundred KB for a few thousand findings);
 * the digest itself changes them weekly.
 *
 * Same idiom as stateStore: a Map (environment names are untrusted), a tolerant load
 * that never throws, bounded contents, and a `revision()` that moves only when
 * something actually changed. Shape:
 *   { lastRunMs, order,
 *     envs: { [name]: { kev, atMs, stale, failed, keys: [[repo, id, pkg, sev], ...] } } }
 * `keys` is sorted; sev is 'C' or 'H'. `stale` and `failed` are sorted image names. `order` is true insertion order (JSON object key
 * order puts integer-like names first).
 */
import { createLogger } from '../util/logger.js';
import { findingKey } from './vulnDerive.js';

const log = createLogger('arcane-vuln-state');

const MAX_ENVS = 50;
// Critical/high keys per environment. A larger set is refused, never truncated (a cut key
// would read as new the week after); the digest fails that environment instead.
export const MAX_KEYS = 20000;
const MAX_FIELD = 256;
const MAX_NAMES = 200; // stale or failed image names per environment
const SEVERITIES = new Set(['C', 'H']);

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isMs = (v) => Number.isInteger(v) && v >= 0;
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** One key entry from [repo, id, pkg, sev] or { repo, id, pkg, sev }, or null. */
function sanitizeEntry(x) {
  const [repo, id, pkg, sev] = Array.isArray(x) ? x : isObj(x) ? [x.repo, x.id, x.pkg, x.sev] : [];
  if (!isStr(repo) || !isStr(id) || !isStr(pkg) || !SEVERITIES.has(sev)) return null;
  return {
    repo: repo.slice(0, MAX_FIELD),
    id: id.slice(0, MAX_FIELD),
    pkg: pkg.slice(0, MAX_FIELD),
    sev,
  };
}

/** Entries to a sorted key Map; a repeated key keeps the worse severity. Not bounded. */
function sanitizeKeys(list) {
  const out = new Map();
  for (const x of list) {
    const e = sanitizeEntry(x);
    if (!e) continue;
    const key = findingKey(e.repo, e.id, e.pkg);
    const prev = out.get(key);
    if (!prev || (prev.sev === 'H' && e.sev === 'C')) out.set(key, e);
  }
  return new Map([...out].sort(([a], [b]) => cmpStr(a, b)));
}

/** Image names: unique non-empty strings, capped in length, sorted, at most MAX_NAMES. */
function sanitizeNames(list) {
  const names = new Set();
  for (const n of Array.isArray(list) ? list : []) if (isStr(n)) names.add(n.slice(0, MAX_FIELD));
  return [...names].sort(cmpStr).slice(0, MAX_NAMES);
}

function sanitizeEnv(raw) {
  const r = isObj(raw) ? raw : {};
  let keys = sanitizeKeys(Array.isArray(r.keys) ? r.keys : []);
  if (keys.size > MAX_KEYS) {
    // Only a hand-edited file gets here: setEnv refuses a larger set.
    log.warn(
      { keys: keys.size, max: MAX_KEYS },
      'Arcane vulnerability digest state is over the key cap; truncated on load'
    );
    keys = new Map([...keys].slice(0, MAX_KEYS));
  }
  return {
    kev: isMs(r.kev) ? r.kev : null,
    atMs: isMs(r.atMs) ? r.atMs : null,
    stale: sanitizeNames(r.stale),
    failed: sanitizeNames(r.failed),
    keys,
  };
}

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

function sameEnv(a, b) {
  if (!a || a.kev !== b.kev || a.atMs !== b.atMs || a.keys.size !== b.keys.size) return false;
  if (!sameList(a.stale, b.stale) || !sameList(a.failed, b.failed)) return false;
  for (const [k, e] of a.keys) if (b.keys.get(k)?.sev !== e.sev) return false;
  return true;
}

const copyEnv = (rec) => ({
  kev: rec.kev,
  atMs: rec.atMs,
  stale: [...rec.stale],
  failed: [...rec.failed],
  keys: new Map([...rec.keys].map(([k, e]) => [k, { ...e }])),
});

/**
 * @param {object} [opts]
 * @param {unknown} [opts.initial]  the state as toFile() gave it (anything else starts empty)
 */
export function createVulnStateStore({ initial } = {}) {
  const envs = new Map();
  let lastRunMs = null;
  let revision = 0;

  function load(parsed) {
    try {
      if (!isObj(parsed)) return;
      const raw = isObj(parsed.envs) ? parsed.envs : {};
      const rawKeys = Object.keys(raw);
      const present = new Set(rawKeys);
      const order = [];
      const used = new Set();
      for (const k of Array.isArray(parsed.order) ? parsed.order : []) {
        if (typeof k === 'string' && present.has(k) && !used.has(k)) {
          used.add(k);
          order.push(k);
        }
      }
      for (const k of rawKeys) if (!used.has(k)) order.push(k);
      for (const k of order.slice(-MAX_ENVS)) if (isStr(k)) envs.set(k, sanitizeEnv(raw[k]));
      if (isMs(parsed.lastRunMs)) lastRunMs = parsed.lastRunMs;
    } catch {
      envs.clear();
      lastRunMs = null;
    }
  }
  load(initial);

  /** A change to persist with the run's notices. */
  function changed() {
    revision += 1;
  }

  /** The state as the file holds it (the shape arcane-vuln-state.json had); copies. */
  function toFile() {
    const out = [...envs].map(([name, rec]) => [
      name,
      {
        kev: rec.kev,
        atMs: rec.atMs,
        stale: [...rec.stale],
        failed: [...rec.failed],
        keys: [...rec.keys.values()].map((e) => [e.repo, e.id, e.pkg, e.sev]),
      },
    ]);
    // fromEntries defines own properties, so a '__proto__' name stays a plain key.
    return { lastRunMs, envs: Object.fromEntries(out), order: [...envs.keys()] };
  }

  /** Whether the environment has had its silent baseline. */
  function isKnown(name) {
    return envs.has(name);
  }

  function knownCount() {
    return envs.size;
  }

  function knownNames() {
    return [...envs.keys()];
  }

  /** The environment's last digest ({ keys: Map, kev, atMs, stale, failed }, a copy), or null. */
  function getEnv(name) {
    const rec = envs.get(name);
    return rec ? copyEnv(rec) : null;
  }

  /**
   * Record a digest (or the baseline): keys (a Map of key -> { repo, id, pkg, sev }, or
   * a list of entries), the KEV count (null when unknown), the stale and failed image
   * names, and the time. Evicts the oldest-inserted environment beyond MAX_ENVS, never
   * the one being written. Returns false, writing nothing, for invalid input or more
   * than MAX_KEYS keys.
   */
  function setEnv(name, rec) {
    if (!isStr(name) || !isObj(rec)) return false;
    const list =
      rec.keys instanceof Map ? rec.keys.values() : Array.isArray(rec.keys) ? rec.keys : [];
    const keys = sanitizeKeys(list);
    if (keys.size > MAX_KEYS) {
      log.error(
        { env: name, keys: keys.size, max: MAX_KEYS },
        'Arcane vulnerability digest state over the key cap; not saved'
      );
      return false;
    }
    const next = {
      kev: isMs(rec.kev) ? rec.kev : null,
      atMs: isMs(rec.atMs) ? rec.atMs : null,
      stale: sanitizeNames(rec.stale),
      failed: sanitizeNames(rec.failed),
      keys,
    };
    if (sameEnv(envs.get(name), next)) return true;
    envs.set(name, next);
    for (const k of envs.keys()) {
      if (envs.size <= MAX_ENVS) break;
      if (k !== name) envs.delete(k);
    }
    changed();
    return true;
  }

  function getLastRun() {
    return lastRunMs;
  }

  function setLastRun(ms) {
    if (!isMs(ms) || ms === lastRunMs) return;
    lastRunMs = ms;
    changed();
  }

  return {
    isKnown,
    knownCount,
    knownNames,
    getEnv,
    setEnv,
    getLastRun,
    setLastRun,
    toFile,
    /** How many changes it has had: the same number, nothing to write. */
    revision: () => revision,
  };
}
