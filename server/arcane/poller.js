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
 *   - Containers are read unfiltered. One whose update check errored or never ran
 *     keeps its held-back entry and pending latest (nextUpdateState); only "up to
 *     date" or "no longer listed" clears it, so a registry error is never "caught up".
 *   - Agent connectivity comes from the environment list's health alone, from
 *     first sight, independent of the baseline and of the per-environment reads.
 *   - Per environment, every data fetch happens before any data state is
 *     touched. A fetch error (network, non-2xx, malformed body) leaves that
 *     environment's held-back set, seen activities and baseline exactly as they
 *     were for this poll: no "caught up" storm.
 *   - Only terminal activities with a parseable startedAt are processed; any
 *     other is skipped without being marked seen, so it is retried next poll.
 *   - A finished run pushes its outcome and is marked seen on the poll that first
 *     sees it. Only a run Arcane's scheduler started records a cron run (runOrigin,
 *     judged from the environment's job_run rows). While its job run is unfinished,
 *     only that cron decision waits: the run is kept in arcane-state.json
 *     ("awaiting") and resolved on later polls, for at most AWAIT_MAX_MS.
 *   - State advances before dispatch, and a dispatch failure is swallowed, so
 *     a push outage (or push turned off) never re-announces a backlog later.
 * The only clock is the injected `now`, read to age awaiting runs; otherwise the same
 * inputs and persisted state give the same outputs.
 * The API key stays inside the client; nothing here can log it.
 */
import {
  envKey,
  envHealth,
  nextUpdateState,
  heldBackTransitions,
  isTerminal,
  runOrigin,
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
import { MAX_TIMER_MS } from './config.js';
import { MAX_AWAITING } from './stateStore.js';

const OFFLINE_AFTER_POLLS = 2;
// auto_update before system_prune: the order activities are processed in.
const ACTIVITY_JOBS = [
  { type: 'auto_update', job: 'arcane-update' },
  { type: 'system_prune', job: 'arcane-prune' },
];
// job_run rows are read page by page back to the oldest unseen run, at most this far.
const JOB_RUN_PAGE = 50;
const JOB_RUN_PAGES = 4;
// How long a finished run's cron decision may wait for its job run to finish. Arcane can
// keep a job run queued or retrying indefinitely; after this the run is judged manual.
export const AWAIT_MAX_MS = 30 * 60_000;
// With push configured, the first poll and release check wait this long at most for it.
const PUSH_WAIT_MS = 30_000;
const PUSH_WAIT_STEP_MS = 500;
const DEFAULT_POLL_MS = 300_000;
const DEFAULT_RELEASE_MS = 21_600_000;
const ONCE_MAX = 1000; // bound on the log-once memory
const VERSION_MAX = 64;

const str = (v) => (typeof v === 'string' ? v : '');
const short = (v) => String(v ?? '').slice(0, 100);
const errText = (err) => short(err?.message || err || 'error');
const parseMs = (v) => (typeof v === 'string' ? Date.parse(v) : NaN);
const positive = (v, dflt) => (Number.isFinite(v) && v > 0 ? Math.min(v, MAX_TIMER_MS) : dflt);
const defaultSleep = (ms) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });

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
  sleep = defaultSleep,
  now = Date.now,
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

  // Read failures log once per error signature and once on recovery, not every poll
  // (a missing grant or a TLS problem would otherwise warn ~290 times a day).
  const failing = new Map(); // scope ('environments' or env name) -> error signature
  function readFailed(scope, err, fields, msg) {
    const sig = `${err?.status ?? ''}:${errText(err)}`;
    if (failing.get(scope) === sig) return;
    if (!failing.has(scope) && failing.size >= ONCE_MAX) failing.clear();
    failing.set(scope, sig);
    log.warn({ ...fields, status: err?.status ?? null, err }, msg);
  }
  function readOk(scope, fields, msg) {
    if (!failing.delete(scope)) return;
    log.info(fields, msg);
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

  /**
   * id -> startedAt (ms) of the next activity of the same type, over every listed
   * activity with an id and a parseable startedAt, seen and running ones included.
   * Caps each run's history window (summarizeUpdateRun `until`).
   */
  function nextStarts(list) {
    const byId = new Map();
    for (const a of Array.isArray(list) ? list : []) {
      const id = activityId(a);
      const startedMs = parseMs(a?.startedAt);
      if (id && Number.isFinite(startedMs) && !byId.has(id)) byId.set(id, startedMs);
    }
    const order = [...byId].sort(
      ([ia, ma], [ib, mb]) => ma - mb || (ia < ib ? -1 : ia > ib ? 1 : 0)
    );
    const next = new Map();
    for (let i = 0; i + 1 < order.length; i++) next.set(order[i][0], order[i + 1][1]);
    return next;
  }

  /**
   * The environment's job_run rows, newest first, paged back until a page ends before
   * `oldestMs` (the oldest unseen run being judged) or the page cap is reached. A run
   * whose job_run lies beyond the cap is judged manual.
   */
  async function listJobRuns(envId, oldestMs) {
    const rows = [];
    for (let page = 0; page < JOB_RUN_PAGES; page++) {
      const got = await client.listActivities(envId, 'job_run', JOB_RUN_PAGE, page * JOB_RUN_PAGE);
      rows.push(...got);
      if (got.length < JOB_RUN_PAGE) break;
      const last = got[got.length - 1];
      const lastMs = parseMs(last?.endedAt);
      if (isTerminal(last) && Number.isFinite(lastMs) && lastMs < oldestMs) break;
    }
    return rows;
  }

  /** Push for one finished activity of a known environment; returns its run summary. */
  function processActivity(key, type, activity, history, events, until) {
    // An unparseable endedAt would make the history window NaN; fall back to startedAt.
    const a = Number.isFinite(parseMs(activity.endedAt))
      ? activity
      : { ...activity, endedAt: null };
    let summary;
    if (type === 'auto_update') {
      summary = summarizeUpdateRun(a, history, { until });
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
    return summary;
  }

  /** One cron run into the store; a bad report or a store error never breaks the poll. */
  function recordCron(env, key, { job, cronStatus, error }) {
    const report = buildCronReport({ job, env, cronStatus, error });
    if (!report) return;
    try {
      recordRun(report);
    } catch (err) {
      log.warn({ err, env: key, job }, 'Failed to record Arcane run');
    }
  }

  function judgedManual(key, rec, why) {
    const mins = AWAIT_MAX_MS / 60_000;
    const reasons = {
      manual: 'Arcane run not started by the scheduler; no cron run recorded',
      timeout: `Arcane run's job unfinished after ${mins} min; no cron run recorded`,
      evicted: 'Too many Arcane runs waiting on their job run; oldest gets no cron run',
    };
    logOnce(
      `${why}:${key}:${short(rec.id)}`,
      'info',
      { env: key, job: rec.job, id: short(rec.id) },
      reasons[why]
    );
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
    let jobRuns = [];
    const pending = {};
    const next = {};
    const awaiting = known ? stateStore.getAwaiting(key) : [];
    try {
      containers = await client.listContainers(env.id);
      for (const { type } of ACTIVITY_JOBS) {
        const list = await client.listActivities(env.id, type);
        pending[type] = unseenTerminal(key, type, list);
        next[type] = nextStarts(list);
      }
      const unseen = ACTIVITY_JOBS.flatMap(({ type }) => pending[type]);
      if (known && pending.auto_update.length > 0) history = await client.updaterHistory(env.id);
      if (known && unseen.length + awaiting.length > 0) {
        const oldest = Math.min(
          ...unseen.map((p) => p.startedMs),
          ...awaiting.map((r) => r.startedMs)
        );
        jobRuns = await listJobRuns(env.id, oldest);
      }
    } catch (err) {
      errors.push(`${key}: ${errText(err)}`);
      readFailed(
        key,
        err,
        { env: key },
        'Arcane fetch failed; environment data unchanged until reads succeed'
      );
      return;
    }
    readOk(key, { env: key }, 'Arcane reads for environment recovered');

    // Commit phase (data only).
    const prevPending = stateStore.getPending(key);
    const { held, pending: nextPending } = nextUpdateState({
      containers,
      checkOnly: checkOnly.has(key),
      prevHeld: heldBackStore.getNode(key),
      prevPending,
    });
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

    // Runs whose cron decision waited on their job run (earlier polls).
    const nowMs = now();
    const cron = []; // { job, cronStatus, error }, recorded once state is saved
    const keep = [];
    for (const rec of awaiting) {
      const origin = runOrigin({ id: rec.id, batchId: rec.batchId }, jobRuns);
      if (origin === 'scheduled') cron.push(rec);
      else if (origin === 'manual') judgedManual(key, rec, 'manual');
      else if (nowMs - rec.firstSeenMs >= AWAIT_MAX_MS) judgedManual(key, rec, 'timeout');
      else keep.push(rec);
    }

    for (const { type, job } of ACTIVITY_JOBS) {
      for (const { activity, id, startedMs } of pending[type]) {
        // Seen first: across a crash the push and the cron run are at most once.
        stateStore.addActivity(key, id);
        if (!known) continue;
        const until = next[type].get(id);
        const summary = processActivity(key, type, activity, history, events, until);
        const rec = {
          id,
          batchId: str(activity.batchId),
          job,
          cronStatus: summary.cronStatus,
          error: str(summary.error),
          startedMs,
          firstSeenMs: nowMs,
        };
        // A manual run is a real outcome, so it pushed above, but it must not start a
        // daily SLA. Only the cron decision waits for an unfinished job run.
        const origin = runOrigin(activity, jobRuns);
        if (origin === 'scheduled') cron.push(rec);
        else if (origin === 'manual') judgedManual(key, rec, 'manual');
        else {
          keep.push(rec);
          logOnce(
            `await:${key}:${short(id)}`,
            'debug',
            { env: key, type, id: short(id) },
            "Arcane run's job still finishing; cron decision waits"
          );
        }
      }
    }

    // Bounded by the store's own cap (MAX_AWAITING): the oldest beyond it get no cron run.
    for (const rec of keep.splice(0, Math.max(0, keep.length - MAX_AWAITING))) {
      judgedManual(key, rec, 'evicted');
    }
    stateStore.setAwaiting(key, keep);
    for (const rec of cron) recordCron(env, key, rec);

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
        readFailed(
          'environments',
          err,
          {},
          'Arcane environment list failed; state unchanged until it succeeds'
        );
        return { events, errors };
      }
      readOk('environments', {}, 'Arcane environment list recovered');

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
    log.debug({ events: events.length, errors: errors.length }, 'Arcane poll complete');
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

  let generation = 0; // bumped by stop(), so a first run still waiting for push is dropped

  /** Push creds are set up but firebase is not ready yet (the async boot race in fcm.js). */
  function pushStarting() {
    return (
      typeof fcm?.isPushConfigured === 'function' &&
      typeof fcm?.isPushEnabled === 'function' &&
      fcm.isPushConfigured() &&
      !fcm.isPushEnabled()
    );
  }

  /**
   * Wait (bounded) for push to come up. State advances before dispatch, so an event
   * found by a first poll that ran while push was still starting would be lost.
   */
  async function waitForPush() {
    for (let waited = 0; waited < PUSH_WAIT_MS && pushStarting(); waited += PUSH_WAIT_STEP_MS) {
      await sleep(PUSH_WAIT_STEP_MS);
    }
  }

  function stop() {
    generation += 1;
    if (pollTimer) clearInterval(pollTimer);
    if (releaseTimer) clearInterval(releaseTimer);
    pollTimer = null;
    releaseTimer = null;
  }

  function start({ pollMs, releaseMs } = {}) {
    stop();
    const mine = generation;
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
    const first = () => {
      if (mine !== generation) return;
      guardedPoll();
      guardedRelease();
    };
    if (!pushStarting()) {
      first();
      return;
    }
    log.info('Arcane poller waiting for push to be ready before its first poll');
    waitForPush().then(first, first);
  }

  return { pollOnce, checkRelease, start, stop };
}
