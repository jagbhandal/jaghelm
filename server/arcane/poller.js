/**
 * Arcane poller: turns Arcane state transitions into exactly-once phone pushes
 * and cron runs.
 *
 * Each poll reads every environment and compares it with the persisted state
 * (stateStore + heldBackStore). Only transitions push. The rules:
 *   - First sight of an environment is a silent baseline: its held-back set and
 *     pending map are stored and its finished activities are marked seen, with no
 *     pushes and no cron runs. An environment becomes known only after a pass where
 *     it was up and every fetch succeeded.
 *   - Held back / caught up are image news, not policy news: a container moving
 *     into or out of the held tier with the same latest image is silent
 *     (heldBackTransitions).
 *   - Agent connectivity comes from the environment list's health alone, from
 *     first sight, independent of the baseline and of the per-environment reads.
 *   - Per environment, every data fetch happens before any data state is
 *     touched. A fetch error (network, non-2xx, malformed body) leaves that
 *     environment's held-back set, seen activities and baseline exactly as they
 *     were for this poll: no "caught up" storm.
 *   - Only terminal activities with a parseable startedAt are processed; any
 *     other is skipped without being marked seen, so it is retried next poll.
 *   - State advances before dispatch, and a dispatch failure is swallowed, so
 *     a push outage (or push turned off) never re-announces a backlog later.
 * No clock lives here: same inputs + same persisted state -> same outputs.
 * The API key stays inside the client; nothing here can log it.
 */
import {
  envKey,
  envHealth,
  heldBackSet,
  pendingMap,
  heldBackTransitions,
  isTerminal,
  summarizeUpdateRun,
  summarizePruneRun,
} from './derive.js';
import { buildCronReport } from './cronBridge.js';
import {
  buildUpdatePush,
  buildHeldBackPush,
  buildClearedPush,
  buildAgentOfflinePush,
  buildAgentRecoveredPush,
  buildReleasePush,
} from './format.js';
import { createLogger } from '../util/logger.js';

const OFFLINE_AFTER_POLLS = 2;
// auto_update before system_prune: the order activities are processed in.
const ACTIVITY_JOBS = [
  { type: 'auto_update', job: 'arcane-update' },
  { type: 'system_prune', job: 'arcane-prune' },
];
const DEFAULT_POLL_MS = 300_000;
const DEFAULT_RELEASE_MS = 21_600_000;
const ONCE_MAX = 1000; // bound on the log-once memory
const VERSION_MAX = 64;

const str = (v) => (typeof v === 'string' ? v : '');
const short = (v) => String(v ?? '').slice(0, 100);
const errText = (err) => short(err?.message || err || 'error');
const parseMs = (v) => (typeof v === 'string' ? Date.parse(v) : NaN);
const positive = (v, dflt) => (Number.isFinite(v) && v > 0 ? v : dflt);

/** Activity id as a non-empty string, or null. */
function activityId(a) {
  const id = a?.id;
  if (typeof id === 'string' && id) return id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return null;
}

/** Pure agent step: the next {downPolls, alerted} and the push to send, if any. */
function stepAgent(prev, health, env) {
  if (health === 'down') {
    // Capped at the threshold: only "reached 2" matters, and a capped counter
    // means a long outage stops rewriting the state file every poll.
    const downPolls = Math.min(prev.downPolls + 1, OFFLINE_AFTER_POLLS);
    if (downPolls >= OFFLINE_AFTER_POLLS && !prev.alerted) {
      return { agent: { downPolls, alerted: true }, event: buildAgentOfflinePush({ env }) };
    }
    return { agent: { downPolls, alerted: prev.alerted }, event: null };
  }
  if (health === 'up') {
    const event = prev.alerted ? buildAgentRecoveredPush({ env }) : null;
    return { agent: { downPolls: 0, alerted: false }, event };
  }
  return { agent: prev, event: null }; // unknown health changes nothing
}

export function createArcanePoller({
  client,
  stateStore,
  heldBackStore,
  recordRun,
  dispatch,
  pushStore,
  fcm,
  checkOnlyEnvs,
  logger,
}) {
  const log = logger || createLogger('arcane');
  const checkOnly = new Set(checkOnlyEnvs || []);

  const said = new Set();
  function logOnce(key, level, fields, msg) {
    if (said.has(key)) return;
    if (said.size >= ONCE_MAX) said.clear();
    said.add(key);
    log[level](fields, msg);
  }

  async function send(events) {
    if (events.length === 0) return;
    try {
      await dispatch(events, { store: pushStore, fcm, logger: log });
    } catch (err) {
      log.warn(
        { err, events: events.length },
        'Arcane push dispatch failed; state already advanced'
      );
    }
  }

  /** Terminal, parseable, not yet seen activities of one type, oldest first. */
  function unseenTerminal(key, type, list) {
    const picked = new Set();
    const out = [];
    for (const a of list) {
      const id = activityId(a);
      const startedMs = parseMs(a?.startedAt);
      if (!id || a.type !== type || !isTerminal(a) || !Number.isFinite(startedMs)) {
        logOnce(
          `skip:${key}:${type}:${short(id)}:${short(a?.status)}`,
          'debug',
          { env: key, type, id: short(id), status: short(a?.status) },
          'Arcane activity not processable yet; retried next poll'
        );
        continue;
      }
      if (picked.has(id) || stateStore.hasActivity(key, id)) continue;
      picked.add(id);
      out.push({ activity: a, id, startedMs });
    }
    return out.sort(
      (x, y) => x.startedMs - y.startedMs || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)
    );
  }

  /** Push + cron run for one finished activity of a known environment. */
  function processActivity(env, key, type, job, activity, history, events) {
    // An unparseable endedAt would make the history window NaN; fall back to startedAt.
    const a = Number.isFinite(parseMs(activity.endedAt))
      ? activity
      : { ...activity, endedAt: null };
    let summary;
    if (type === 'auto_update') {
      summary = summarizeUpdateRun(a, history);
      if (summary.updated.length + summary.failed.length > 0) {
        events.push(
          buildUpdatePush({
            env: key,
            updated: summary.updated.map((u) => u.name),
            failed: summary.failed.map((f) => f.name),
          })
        );
      }
    } else {
      summary = summarizePruneRun(a);
    }
    const report = buildCronReport({
      job,
      env,
      cronStatus: summary.cronStatus,
      error: summary.error,
    });
    if (!report) return;
    try {
      recordRun(report);
    } catch (err) {
      log.warn({ err, env: key, job }, 'Failed to record Arcane run');
    }
  }

  async function pollEnv(env, key, events, errors) {
    const known = stateStore.isKnownEnv(key);
    const health = envHealth(env);

    // Agent: from list health alone, committed before (and regardless of) any fetch.
    // No record yet (first sight) starts from a clean {0, false}.
    const prevAgent = stateStore.getAgent(key) || { downPolls: 0, alerted: false };
    const { agent, event: agentEvent } = stepAgent(prevAgent, health, key);
    stateStore.setAgent(key, agent);
    if (agentEvent) events.push(agentEvent);

    // Nothing else is fetched, so the environment does not become known.
    if (health !== 'up') return;

    // Fetch phase. No data state is written until every fetch for this environment succeeded.
    let containers;
    let history = null;
    const pending = {};
    try {
      containers = await client.listPendingUpdates(env.id);
      for (const { type } of ACTIVITY_JOBS) {
        pending[type] = unseenTerminal(key, type, await client.listActivities(env.id, type));
      }
      if (known && pending.auto_update.length > 0) history = await client.updaterHistory(env.id);
    } catch (err) {
      errors.push(`${key}: ${errText(err)}`);
      log.warn(
        { env: key, status: err?.status ?? null, err },
        'Arcane fetch failed; environment state unchanged this poll'
      );
      return;
    }

    // Commit phase (data only).
    const held = heldBackSet(containers, { checkOnly: checkOnly.has(key) });
    const nextPending = pendingMap(containers);
    const prevPending = stateStore.getPending(key);
    const { newlyHeldBack, cleared } = heldBackStore.diffAndSet(key, held);
    stateStore.setPending(key, nextPending);
    if (known) {
      const { heldBack, caughtUp } = heldBackTransitions({
        newlyHeldBack,
        cleared,
        prevPending,
        nextPending,
      });
      if (heldBack.length > 0) {
        events.push(buildHeldBackPush({ env: key, heldBack: heldBack.map((e) => e.name) }));
      }
      if (caughtUp.length > 0) {
        events.push(buildClearedPush({ env: key, cleared: caughtUp.map((e) => e.name) }));
      }
    }

    for (const { type, job } of ACTIVITY_JOBS) {
      for (const { activity, id } of pending[type]) {
        // Seen first: across a crash the cron run is at most once, like the push.
        stateStore.addActivity(key, id);
        if (known) processActivity(env, key, type, job, activity, history, events);
      }
    }

    stateStore.markKnownEnv(key);
  }

  async function pollOnce() {
    const events = [];
    const errors = [];
    try {
      let envs;
      try {
        envs = await client.listEnvironments();
      } catch (err) {
        errors.push(`environments: ${errText(err)}`);
        log.warn(
          { status: err?.status ?? null, err },
          'Arcane environment list failed; state unchanged'
        );
        return { events, errors };
      }

      const byKey = new Map();
      const shared = new Set();
      for (const env of Array.isArray(envs) ? envs : []) {
        const key = envKey(env);
        if (!key) {
          const name = short(env?.name);
          logOnce(
            `unsafe:${name}`,
            'warn',
            { name },
            'Skipping Arcane environment with an unsafe name'
          );
          continue;
        }
        if (env.enabled === false) continue;
        if (byKey.has(key)) shared.add(key);
        else byKey.set(key, env);
      }
      // A name two environments share has no single owner for its state: skip
      // every one of them, whatever order the API lists them in.
      for (const key of shared) {
        byKey.delete(key);
        logOnce(
          `dup:${key}`,
          'warn',
          { env: key },
          'Skipping Arcane environments that share a name'
        );
      }

      // Sorted by name so the event order does not depend on the API's list order.
      for (const key of [...byKey.keys()].sort()) {
        try {
          await pollEnv(byKey.get(key), key, events, errors);
        } catch (err) {
          errors.push(`${key}: ${errText(err)}`);
          log.error({ env: key, err }, 'Arcane poll of environment failed');
        }
      }
    } catch (err) {
      errors.push(`poll: ${errText(err)}`);
      log.error({ err }, 'Arcane poll failed');
    }

    await send(events);
    const level = events.length || errors.length ? 'info' : 'debug';
    log[level]({ events: events.length, errors: errors.length }, 'Arcane poll complete');
    return { events, errors };
  }

  async function checkRelease() {
    try {
      const info = await client.appVersion();
      const newest = str(info?.newestVersion).slice(0, VERSION_MAX);
      const current = str(info?.currentVersion).slice(0, VERSION_MAX);
      if (info?.updateAvailable !== true || !newest || newest === current) return [];
      if (stateStore.getReleaseNotified() === newest) return [];
      stateStore.setReleaseNotified(newest); // advance before dispatch
      const events = [buildReleasePush({ current: current || 'unknown', newest })];
      await send(events);
      log.info({ current, newest }, 'Arcane release available');
      return events;
    } catch (err) {
      log.warn({ status: err?.status ?? null, err }, 'Arcane release check failed');
      return [];
    }
  }

  let pollTimer = null;
  let releaseTimer = null;
  let polling = false;
  let checking = false;

  async function guardedPoll() {
    if (polling) return;
    polling = true;
    try {
      await pollOnce();
    } finally {
      polling = false;
    }
  }

  async function guardedRelease() {
    if (checking) return;
    checking = true;
    try {
      await checkRelease();
    } finally {
      checking = false;
    }
  }

  function stop() {
    if (pollTimer) clearInterval(pollTimer);
    if (releaseTimer) clearInterval(releaseTimer);
    pollTimer = null;
    releaseTimer = null;
  }

  function start({ pollMs, releaseMs } = {}) {
    stop();
    const pollEvery = positive(pollMs, DEFAULT_POLL_MS);
    const releaseEvery = positive(releaseMs, DEFAULT_RELEASE_MS);
    pollTimer = setInterval(guardedPoll, pollEvery);
    releaseTimer = setInterval(guardedRelease, releaseEvery);
    // The HTTP server keeps the process alive; these timers never should.
    pollTimer.unref?.();
    releaseTimer.unref?.();
    log.info(
      { pollSec: pollEvery / 1000, releaseSec: releaseEvery / 1000 },
      'Arcane poller started'
    );
    guardedPoll();
    guardedRelease();
  }

  return { pollOnce, checkRelease, start, stop };
}
