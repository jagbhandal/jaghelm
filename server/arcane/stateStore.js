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
 * Persisted shape: { envs: { [name]: { known, agent, activities } }, release: { notified } }.
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

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function setOwn(obj, key, value) {
  Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
}

function sanitizeAgent(a) {
  if (!a || typeof a !== 'object') return null;
  const n = Number(a.downPolls);
  return {
    downPolls: Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0,
    alerted: a.alerted === true,
  };
}

function sanitizeEnv(e) {
  const rec = { known: false, agent: null, activities: [] };
  if (!e || typeof e !== 'object') return rec;
  rec.known = e.known === true;
  rec.agent = sanitizeAgent(e.agent);
  if (Array.isArray(e.activities)) {
    rec.activities = e.activities
      .filter((x) => typeof x === 'string')
      .map((x) => x.slice(0, MAX_FIELD))
      .slice(-MAX_ACTIVITIES);
  }
  return rec;
}

export function createArcaneStateStore({ path = DEFAULT_PATH } = {}) {
  function load() {
    const envs = Object.create(null);
    let notified = null;
    try {
      if (existsSync(path)) {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          if (parsed.envs && typeof parsed.envs === 'object' && !Array.isArray(parsed.envs)) {
            for (const k of Object.keys(parsed.envs).slice(-MAX_ENVS)) {
              setOwn(envs, k, sanitizeEnv(parsed.envs[k]));
            }
          }
          const n = parsed.release && parsed.release.notified;
          if (typeof n === 'string') notified = n.slice(0, MAX_FIELD);
        }
      }
    } catch {
      return { envs: Object.create(null), notified: null };
    }
    return { envs, notified };
  }

  const state = load();

  function save() {
    try {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      atomicWriteFileSync(
        path,
        JSON.stringify({ envs: state.envs, release: { notified: state.notified } }, null, 2),
      );
    } catch (err) {
      log.error({ err }, 'Failed to save Arcane state');
    }
  }

  /** Get-or-create an env record, evicting oldest-inserted past the bound. */
  function ensureEnv(name) {
    if (has(state.envs, name)) return state.envs[name];
    const rec = { known: false, agent: null, activities: [] };
    setOwn(state.envs, name, rec);
    let keys = Object.keys(state.envs);
    while (keys.length > MAX_ENVS && keys[0] !== name) {
      delete state.envs[keys[0]];
      keys = Object.keys(state.envs);
    }
    return rec;
  }

  function isKnownEnv(name) {
    return has(state.envs, name) && state.envs[name].known === true;
  }

  function markKnownEnv(name) {
    if (isKnownEnv(name)) return;
    ensureEnv(name).known = true;
    save();
  }

  function getAgent(name) {
    if (!has(state.envs, name) || !state.envs[name].agent) return null;
    return { ...state.envs[name].agent };
  }

  function setAgent(name, rec) {
    const next = sanitizeAgent(rec);
    if (!next) return;
    const prev = has(state.envs, name) ? state.envs[name].agent : null;
    if (prev && prev.downPolls === next.downPolls && prev.alerted === next.alerted) return;
    ensureEnv(name).agent = next;
    save();
  }

  function hasActivity(name, id) {
    return has(state.envs, name) && state.envs[name].activities.includes(String(id));
  }

  function addActivity(name, id) {
    const sid = String(id).slice(0, MAX_FIELD);
    if (hasActivity(name, sid)) return;
    const env = ensureEnv(name);
    env.activities.push(sid);
    if (env.activities.length > MAX_ACTIVITIES) {
      env.activities.splice(0, env.activities.length - MAX_ACTIVITIES);
    }
    save();
  }

  function getReleaseNotified() {
    return state.notified;
  }

  function setReleaseNotified(version) {
    const v = String(version).slice(0, MAX_FIELD);
    if (state.notified === v) return;
    state.notified = v;
    save();
  }

  return {
    isKnownEnv, markKnownEnv, getAgent, setAgent,
    hasActivity, addActivity, getReleaseNotified, setReleaseNotified,
  };
}
