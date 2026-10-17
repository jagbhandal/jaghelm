/**
 * Persisted Arcane poller state.
 *
 * Remembers across JagHelm restarts which environments have had their silent
 * baseline, each agent's down-poll counter and alerted flag, the last
 * activity ids seen per environment, and the last Arcane release notified.
 * Without it a restart would re-announce standing state as new.
 *
 * Mirrors heldBackStore's idiom: null-prototype maps (environment names are
 * untrusted), a tolerant load() that never throws, and atomicWriteFileSync
 * only when something actually changed.
 * Persisted shape: { envs: { [name]: { known, agent, activities } }, release: { notified },
 * order: string[] }. `order` is true insertion order, since JSON object key order
 * puts integer-like names first; files without it load fine.
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
const MAX_FIELD = 256;

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

function sanitizeEnv(e) {
  const rec = { known: false, agent: null, activities: [] };
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
  return rec;
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
          envs: Object.fromEntries(envs),
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
    rec = { known: false, agent: null, activities: [] };
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
    hasActivity, addActivity, getReleaseNotified, setReleaseNotified,
  };
}
