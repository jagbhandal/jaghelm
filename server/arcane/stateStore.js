/**
 * Persisted Arcane poller state.
 *
 * Remembers across JagHelm restarts which environments have had their silent
 * baseline, each agent's down-poll counter and alerted flag, the last
 * activity ids seen per environment, each environment's pending map (every
 * container with an update, any tier, name -> latest), the finished runs whose
 * cron decision waits on their job run ("awaiting"), and the last Arcane release
 * notified. Without it a restart would re-announce standing state as new.
 *
 * Mirrors heldBackStore's idiom: null-prototype maps (environment names are
 * untrusted), a tolerant load() that never throws, and atomicWriteFileSync
 * only when something actually changed.
 * Persisted shape: { envs: { [name]: { known, agent, activities, pending?, awaiting? } },
 * release: { notified }, order: string[] }. `order` is true insertion order, since JSON
 * object key order puts integer-like names first; files without it load fine. `pending`
 * ({ [container]: latest }) is absent until first recorded; a file without it loads as
 * "no pending map" for that environment. `awaiting` (a list of
 * { id, batchId, job, cronStatus, error, startedMs, firstSeenMs }) is left out when
 * empty; a file without it has none.
 */
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { atomicWriteFileSync } from '../util/atomicWrite.js';
import { DATA_DIR } from '../util/dataDir.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('arcane-state');

const DEFAULT_PATH = join(DATA_DIR, 'arcane-state.json');

const MAX_ENVS = 50;
const MAX_ACTIVITIES = 200;
const MAX_PENDING = 500; // containers per environment
const MAX_AWAITING = 50; // runs per environment waiting on their job run
const MAX_ERROR = 2048;
const MAX_FIELD = 256;
const AWAIT_JOBS = new Set(['arcane-update', 'arcane-prune']);
const AWAIT_STATUSES = new Set(['success', 'failure']);

const isStr = (v) => typeof v === 'string' && v.length > 0;
const norm = (v) => v.slice(0, MAX_FIELD);

function sanitizeAgent(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  const n = a.downPolls;
  return {
    downPolls: typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 0,
    alerted: a.alerted === true,
  };
}

/**
 * name -> latest pairs to a bounded Map (first MAX_PENDING by name), or null when
 * the input is not a pending map at all. Entries that are not two non-empty
 * strings are dropped; both sides are capped at MAX_FIELD.
 */
function sanitizePending(entries) {
  if (!entries) return null;
  const out = new Map();
  for (const [k, v] of entries) {
    if (isStr(k) && isStr(v)) out.set(norm(k), norm(v));
  }
  const keys = [...out.keys()].sort();
  return new Map(keys.slice(0, MAX_PENDING).map((k) => [k, out.get(k)]));
}

function pendingEntries(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  // Own keys only: a JSON "__proto__" key is an own property and stays a plain name.
  return Object.keys(p).map((k) => [k, p[k]]);
}

const isMs = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** One awaiting run, or null when it is not one. */
function sanitizeAwaitingRec(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  if (!isStr(r.id) || !AWAIT_JOBS.has(r.job) || !AWAIT_STATUSES.has(r.cronStatus)) return null;
  if (!isMs(r.startedMs) || !isMs(r.firstSeenMs)) return null;
  return {
    id: norm(r.id),
    batchId: typeof r.batchId === 'string' ? norm(r.batchId) : '',
    job: r.job,
    cronStatus: r.cronStatus,
    error: typeof r.error === 'string' ? r.error.slice(0, MAX_ERROR) : '',
    startedMs: r.startedMs,
    firstSeenMs: r.firstSeenMs,
  };
}

/** A list of awaiting runs: invalid entries and repeated ids dropped, newest MAX kept. */
function sanitizeAwaiting(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const ids = new Set();
  for (const r of list) {
    const rec = sanitizeAwaitingRec(r);
    if (!rec || ids.has(rec.id)) continue;
    ids.add(rec.id);
    out.push(rec);
  }
  return out.slice(-MAX_AWAITING);
}

const sameAwaiting = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function sanitizeEnv(e) {
  const rec = { known: false, agent: null, activities: [], pending: null, awaiting: [] };
  if (!e || typeof e !== 'object' || Array.isArray(e)) return rec;
  rec.known = e.known === true;
  rec.agent = sanitizeAgent(e.agent);
  if (Array.isArray(e.activities)) {
    const seen = new Set();
    for (const x of e.activities) {
      if (!isStr(x)) continue;
      const id = norm(x);
      if (!seen.has(id)) { seen.add(id); rec.activities.push(id); }
    }
    rec.activities = rec.activities.slice(-MAX_ACTIVITIES);
  }
  rec.pending = sanitizePending(pendingEntries(e.pending));
  rec.awaiting = sanitizeAwaiting(e.awaiting);
  return rec;
}

/** A record as written to disk: a pending map becomes an own-keyed object, or is left out. */
function serializeEnv(rec) {
  const out = { known: rec.known, agent: rec.agent, activities: rec.activities };
  // fromEntries defines own properties, so a '__proto__' container stays a plain key.
  if (rec.pending) out.pending = Object.fromEntries(rec.pending);
  if (rec.awaiting.length > 0) out.awaiting = rec.awaiting;
  return out;
}

function samePending(a, b) {
  if (!a || !b || a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

export function createArcaneStateStore({ path = DEFAULT_PATH } = {}) {
  // Map keeps true insertion order and has no prototype-key hazards.
  const envs = new Map();
  let notified = null;

  function load() {
    try {
      if (!existsSync(path)) return;
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      const raw = parsed.envs && typeof parsed.envs === 'object' && !Array.isArray(parsed.envs)
        ? parsed.envs : {};
      const rawKeys = Object.keys(raw);
      const present = new Set(rawKeys);
      const order = [];
      const used = new Set();
      if (Array.isArray(parsed.order)) {
        for (const k of parsed.order) {
          if (typeof k === 'string' && present.has(k) && !used.has(k)) { used.add(k); order.push(k); }
        }
      }
      for (const k of rawKeys) if (!used.has(k)) order.push(k);
      for (const k of order.slice(-MAX_ENVS)) envs.set(k, sanitizeEnv(raw[k]));
      if (isStr(parsed.release && parsed.release.notified)) notified = norm(parsed.release.notified);
    } catch {
      envs.clear();
      notified = null;
    }
  }
  load();

  function save() {
    try {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      // fromEntries defines own properties, so a '__proto__' name stays a plain key.
      atomicWriteFileSync(
        path,
        JSON.stringify({
          envs: Object.fromEntries([...envs].map(([k, rec]) => [k, serializeEnv(rec)])),
          release: { notified },
          order: [...envs.keys()],
        }, null, 2),
      );
    } catch (err) {
      log.error({ err }, 'Failed to save Arcane state');
    }
  }

  /** Get-or-create an env record; evicts oldest-inserted, never the one being written. */
  function ensureEnv(name) {
    let rec = envs.get(name);
    if (rec) return rec;
    rec = { known: false, agent: null, activities: [], pending: null, awaiting: [] };
    envs.set(name, rec);
    for (const k of envs.keys()) {
      if (envs.size <= MAX_ENVS) break;
      if (k !== name) envs.delete(k);
    }
    return rec;
  }

  function isKnownEnv(name) {
    return envs.get(name)?.known === true;
  }

  function markKnownEnv(name) {
    if (!isStr(name) || isKnownEnv(name)) return;
    ensureEnv(name).known = true;
    save();
  }

  function getAgent(name) {
    const a = envs.get(name)?.agent;
    return a ? { ...a } : null;
  }

  function setAgent(name, rec) {
    const next = sanitizeAgent(rec);
    if (!isStr(name) || !next) return;
    const prev = envs.get(name)?.agent;
    if (prev && prev.downPolls === next.downPolls && prev.alerted === next.alerted) return;
    ensureEnv(name).agent = next;
    save();
  }

  function hasActivity(name, id) {
    return isStr(id) && !!envs.get(name)?.activities.includes(norm(id));
  }

  function addActivity(name, id) {
    if (!isStr(name) || !isStr(id) || hasActivity(name, id)) return;
    const env = ensureEnv(name);
    env.activities.push(norm(id));
    if (env.activities.length > MAX_ACTIVITIES) {
      env.activities.splice(0, env.activities.length - MAX_ACTIVITIES);
    }
    save();
  }

  /** The environment's last recorded pending map (a copy), or null if none was ever recorded. */
  function getPending(name) {
    const p = envs.get(name)?.pending;
    return p ? new Map(p) : null;
  }

  /** Record the environment's pending map (Map or [name, latest] pairs); writes only on change. */
  function setPending(name, map) {
    if (!isStr(name)) return;
    const pairs = map instanceof Map ? map.entries() : Array.isArray(map) ? map : null;
    const next = sanitizePending(pairs);
    if (!next) return;
    if (samePending(envs.get(name)?.pending, next)) return;
    ensureEnv(name).pending = next;
    save();
  }

  /** The environment's runs waiting on their job run (copies), oldest first. */
  function getAwaiting(name) {
    return (envs.get(name)?.awaiting ?? []).map((r) => ({ ...r }));
  }

  /** Replace the environment's awaiting runs; sanitised and bounded; writes only on change. */
  function setAwaiting(name, list) {
    if (!isStr(name)) return;
    const next = sanitizeAwaiting(list);
    if (sameAwaiting(envs.get(name)?.awaiting ?? [], next)) return;
    ensureEnv(name).awaiting = next;
    save();
  }

  function getReleaseNotified() {
    return notified;
  }

  function setReleaseNotified(version) {
    if (!isStr(version)) return;
    const v = norm(version);
    if (notified === v) return;
    notified = v;
    save();
  }

  return {
    isKnownEnv, markKnownEnv, getAgent, setAgent,
    hasActivity, addActivity, getPending, setPending, getAwaiting, setAwaiting,
    getReleaseNotified, setReleaseNotified,
  };
}
