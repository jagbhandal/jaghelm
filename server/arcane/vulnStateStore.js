/**
 * Persisted state of the weekly vulnerability digest (arcane-vuln-state.json).
 *
 * Per environment: the critical/high finding keys seen at the last digest, the KEV
 * count then, and when it ran. Plus the time of the last digest run, so a restart can
 * tell whether it missed a weekly slot. A separate file from arcane-state.json, so the
 * poller's frequent small writes never rewrite the (larger) key sets.
 *
 * Same idiom as stateStore: a Map (environment names are untrusted), a tolerant load()
 * that never throws, bounded contents, and atomicWriteFileSync only when something
 * actually changed. Persisted shape:
 *   { lastRunMs, envs: { [name]: { kev, atMs, keys: [[repo, id, pkg, sev], ...] } }, order }
 * `keys` is sorted; sev is 'C' or 'H'. `order` is true insertion order (JSON object key
 * order puts integer-like names first).
 */
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { atomicWriteFileSync } from '../util/atomicWrite.js';
import { DATA_DIR } from '../util/dataDir.js';
import { createLogger } from '../util/logger.js';
import { findingKey } from './vulnDerive.js';

const log = createLogger('arcane-vuln-state');

const DEFAULT_PATH = join(DATA_DIR, 'arcane-vuln-state.json');

const MAX_ENVS = 50;
// Critical/high keys per environment. The digest refuses to read more findings than this
// (vulnDigest MAX_FINDINGS), so a full set always fits.
export const MAX_KEYS = 20000;
const MAX_FIELD = 256;
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

/** Entries to a sorted, bounded key Map; a repeated key keeps the worse severity. */
function sanitizeKeys(list) {
  const out = new Map();
  for (const x of list) {
    const e = sanitizeEntry(x);
    if (!e) continue;
    const key = findingKey(e.repo, e.id, e.pkg);
    const prev = out.get(key);
    if (!prev || (prev.sev === 'H' && e.sev === 'C')) out.set(key, e);
  }
  return new Map([...out].sort(([a], [b]) => cmpStr(a, b)).slice(0, MAX_KEYS));
}

function sanitizeEnv(raw) {
  const r = isObj(raw) ? raw : {};
  return {
    kev: isMs(r.kev) ? r.kev : null,
    atMs: isMs(r.atMs) ? r.atMs : null,
    keys: sanitizeKeys(Array.isArray(r.keys) ? r.keys : []),
  };
}

function sameEnv(a, b) {
  if (!a || a.kev !== b.kev || a.atMs !== b.atMs || a.keys.size !== b.keys.size) return false;
  for (const [k, e] of a.keys) if (b.keys.get(k)?.sev !== e.sev) return false;
  return true;
}

const copyEnv = (rec) => ({
  kev: rec.kev,
  atMs: rec.atMs,
  keys: new Map([...rec.keys].map(([k, e]) => [k, { ...e }])),
});

export function createVulnStateStore({ path = DEFAULT_PATH } = {}) {
  const envs = new Map();
  let lastRunMs = null;

  function load() {
    try {
      if (!existsSync(path)) return;
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
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
  load();

  function save() {
    try {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const out = [...envs].map(([name, rec]) => [
        name,
        {
          kev: rec.kev,
          atMs: rec.atMs,
          keys: [...rec.keys.values()].map((e) => [e.repo, e.id, e.pkg, e.sev]),
        },
      ]);
      // fromEntries defines own properties, so a '__proto__' name stays a plain key.
      // Compact: thousands of keys would be a line each when indented.
      atomicWriteFileSync(
        path,
        JSON.stringify({ lastRunMs, envs: Object.fromEntries(out), order: [...envs.keys()] })
      );
    } catch (err) {
      log.error({ err }, 'Failed to save Arcane vulnerability digest state');
    }
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

  /** The environment's last digest ({ keys: Map, kev, atMs }, a copy), or null. */
  function getEnv(name) {
    const rec = envs.get(name);
    return rec ? copyEnv(rec) : null;
  }

  /**
   * Record a digest (or the baseline): keys (a Map of key -> { repo, id, pkg, sev }, or
   * a list of entries), the KEV count (null when unknown) and the time. Evicts the
   * oldest-inserted environment beyond MAX_ENVS, never the one being written.
   */
  function setEnv(name, rec) {
    if (!isStr(name) || !isObj(rec)) return;
    const list =
      rec.keys instanceof Map ? rec.keys.values() : Array.isArray(rec.keys) ? rec.keys : [];
    const next = {
      kev: isMs(rec.kev) ? rec.kev : null,
      atMs: isMs(rec.atMs) ? rec.atMs : null,
      keys: sanitizeKeys(list),
    };
    if (sameEnv(envs.get(name), next)) return;
    envs.set(name, next);
    for (const k of envs.keys()) {
      if (envs.size <= MAX_ENVS) break;
      if (k !== name) envs.delete(k);
    }
    save();
  }

  function getLastRun() {
    return lastRunMs;
  }

  function setLastRun(ms) {
    if (!isMs(ms) || ms === lastRunMs) return;
    lastRunMs = ms;
    save();
  }

  return { isKnown, knownCount, knownNames, getEnv, setEnv, getLastRun, setLastRun };
}
