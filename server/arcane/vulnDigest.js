/**
 * Weekly Arcane vulnerability digest: one push per environment when something is new.
 *
 * It only reads Arcane's stored scan results (vulnerabilities:read) and never starts a
 * scan. Only the environments named in `envs` (ARCANE_VULN_DIGEST_ENVS) are read: Arcane
 * v2.16.1 stores API-key grants globally, so the grant alone cannot limit them. An empty
 * list turns the digest off. Per listed environment that is online and has scan results:
 *   - containers (image ids, references, creation times) and
 *     `POST …/images/vulnerabilities/summaries` for each image's latest scan: scan health
 *     and which repositories are uncertain;
 *   - `GET …/vulnerabilities/overview` for the KEV count;
 *   - `GET …/vulnerabilities/all`, critical and high with a fixed version, page by page,
 *     tried up to READ_ATTEMPTS times; only rows of images a container uses count;
 *   - the summaries again, so a scan that started meanwhile makes its repository uncertain.
 * The rules:
 *   - The first digest of an environment is a silent baseline (as the Arcane poller does).
 *   - A push only when something is new: new critical/high finding keys, more KEV
 *     entries than last time, or an image newly stale or failed (vulnDerive buildDigest).
 *     Fixed findings and scan problems already reported are listed in a push sent anyway,
 *     never a reason for one. The KEV count is never lowered while a repository is
 *     uncertain.
 *   - Each digest that read its results records a `success` run of the cron job
 *     `arcane-vuln-digest` (expected weekly), pushed or not. A read that fails records a
 *     `failure`, but only for an environment that has been digested before; a new one has
 *     no job yet. A refused read (401/403: no vulnerabilities:read, or the feature off)
 *     records nothing, as the poller records nothing on any read error, so an environment
 *     the key may not read never gets a job. Every read error is logged once per distinct
 *     error and once on recovery.
 *   - State advances before dispatch; a dispatch failure is swallowed.
 *   - Runs weekly at `day` `hour`:00 UTC, and once at start when a slot was missed (or
 *     nothing has been digested yet, so granting the permission and restarting takes
 *     the baseline at once).
 * The API key stays inside the client; nothing here can log it.
 */
import { envKey, envHealth } from './derive.js';
import {
  currentFindings,
  scanHealth,
  rescannedRepos,
  diffFindings,
  kevCount,
  nextKev,
  buildDigest,
} from './vulnDerive.js';
import { buildVulnDigestPush } from './format.js';
import { buildCronReport } from './cronBridge.js';
import { MAX_KEYS } from './vulnStateStore.js';
import { MAX_TIMER_MS } from './config.js';
import { createLogger } from '../util/logger.js';

export const DIGEST_JOB = 'arcane-vuln-digest';
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;
// Arcane caps a page of findings at 100 rows (pkg/pagination/reflect.go:52-56).
const PAGE = 100;
// Above this many critical/high findings the environment's digest fails rather than
// store a partial key set. Equal to the state store's key cap, so a full read always fits.
export const MAX_FINDINGS = MAX_KEYS;
const MAX_PAGES = Math.ceil(MAX_FINDINGS / PAGE) + 1;
// Image ids per summaries request. An image beyond it reads as never scanned (stale once
// its container is 9 days old, and uncertain); far above a homelab host's few dozen.
const MAX_IMAGE_IDS = 500;
// The findings read (every page, from the first) is tried this often, this far apart,
// before the week's digest of the environment fails.
const READ_ATTEMPTS = 3;
const RETRY_PAUSE_MS = 30_000;
const PUSH_WAIT_MS = 30_000;
const PUSH_WAIT_STEP_MS = 500;
const ONCE_MAX = 1000;
const OFFLINE_ERROR = 'Arcane agent not online; vulnerability results not read';

const isStr = (v) => typeof v === 'string' && v.length > 0;
const errText = (err) => String(err?.message || err || 'error').slice(0, 2048);
const isDenied = (err) => err?.status === 401 || err?.status === 403;

/** An error that a retry cannot fix (too many findings): the read is not repeated. */
class FindingsLimitError extends Error {}
const defaultSleep = (ms) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });

/** The first `day` (0 = Sunday) at `hour`:00 UTC strictly after nowMs. */
export function nextSlotMs(nowMs, day, hour) {
  const d = new Date(nowMs);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  let t = midnight + ((day - d.getUTCDay() + 7) % 7) * DAY_MS + hour * HOUR_MS;
  if (t <= nowMs) t += WEEK_MS;
  return t;
}

export function createVulnDigest({
  client,
  stateStore,
  recordRun,
  dispatch,
  pushStore,
  fcm,
  logger,
  envs,
  day = 0,
  hour = 14,
  now = Date.now,
  sleep = defaultSleep,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const log = logger || createLogger('arcane');
  const listed = new Set(envs || []);

  const said = new Set();
  function logOnce(key, level, fields, msg) {
    if (said.has(key)) return;
    if (said.size >= ONCE_MAX) said.clear();
    said.add(key);
    log[level](fields, msg);
  }

  // Read failures log once per error signature per scope and once on recovery.
  const failing = new Map();
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

  function recordCron(name, cronStatus, error) {
    const report = buildCronReport({ job: DIGEST_JOB, env: { name }, cronStatus, error });
    if (!report) return;
    try {
      recordRun(report);
    } catch (err) {
      log.warn({ err, env: name, job: DIGEST_JOB }, 'Failed to record Arcane run');
    }
  }

  async function send(events) {
    if (events.length === 0) return;
    try {
      await dispatch(events, { store: pushStore, fcm, logger: log });
    } catch (err) {
      log.warn(
        { err, events: events.length },
        'Arcane vulnerability digest dispatch failed; state already advanced'
      );
    }
  }

  /**
   * Every critical/high fixable finding, page by page. No sort: Arcane's row type has no
   * id, so it adds no tie-break (pkg/pagination/reflect.go:34-42), and a sort on a column
   * with ties could order the ties differently from one page to the next. Unsorted, each
   * page is the same query over the same rows. totalItems must not change between pages
   * and the rows read must add up to it, so a scan finishing mid-read is a read error.
   */
  async function readFindings(envId) {
    const rows = [];
    let total = null;
    for (let page = 0; total === null || rows.length < total; page++) {
      if (page >= MAX_PAGES) throw new Error('vulnerability list incomplete: too many pages');
      const { data, totalItems } = await client.listVulnerabilities(envId, {
        start: rows.length,
        limit: PAGE,
      });
      if (total === null) {
        if (totalItems > MAX_FINDINGS) {
          throw new FindingsLimitError(
            `more than ${MAX_FINDINGS} critical/high findings; digest not built`
          );
        }
        total = totalItems;
      } else if (totalItems !== total) {
        throw new Error('vulnerability list changed while being read; digest not built');
      }
      if (data.length === 0 && rows.length < total) {
        throw new Error('vulnerability list incomplete: fewer rows than its total');
      }
      rows.push(...data);
    }
    if (rows.length !== total) {
      throw new Error('vulnerability list incomplete: more rows than its total');
    }
    return rows;
  }

  /** readFindings, tried up to READ_ATTEMPTS times; a refused read or the cap is final. */
  async function readFindingsWithRetry(envId) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await readFindings(envId);
      } catch (err) {
        if (attempt >= READ_ATTEMPTS || isDenied(err) || err instanceof FindingsLimitError) {
          throw err;
        }
        await sleep(RETRY_PAUSE_MS);
      }
    }
  }

  async function digestEnv(env, key, nowMs, events) {
    const known = stateStore.isKnown(key);
    const scope = `env:${key}`;
    if (envHealth(env) !== 'up') {
      if (known) recordCron(key, 'failure', OFFLINE_ERROR);
      return { env: key, outcome: 'down' };
    }

    // Read phase: nothing is written until every read for the environment succeeded.
    let containers;
    let ids;
    let summaries;
    let summariesAfter;
    let overview;
    let rows;
    try {
      containers = await client.listContainers(env.id);
      ids = [...new Set(containers.map((c) => c?.imageId).filter(isStr))];
      summaries = await client.vulnSummaries(env.id, ids.slice(0, MAX_IMAGE_IDS));
      overview = await client.vulnOverview(env.id);
      const scanned = Object.keys(summaries).length > 0 || overview.drivers?.imagesScanned > 0;
      if (!known && !scanned) {
        readOk(scope, { env: key }, 'Arcane vulnerability reads recovered');
        return { env: key, outcome: 'no-results' };
      }
      rows = await readFindingsWithRetry(env.id);
      summariesAfter = await client.vulnSummaries(env.id, ids.slice(0, MAX_IMAGE_IDS));
    } catch (err) {
      const error = errText(err);
      if (isDenied(err)) {
        readFailed(
          scope,
          err,
          { env: key },
          'Arcane refused the vulnerability read (the key lacks vulnerabilities:read, or ' +
            'vulnerability management is off there); digest skipped'
        );
        return { env: key, outcome: 'no-permission', error };
      }
      readFailed(scope, err, { env: key }, 'Arcane vulnerability read failed; digest skipped');
      if (known) recordCron(key, 'failure', error);
      return { env: key, outcome: 'error', error };
    }
    readOk(scope, { env: key }, 'Arcane vulnerability reads recovered');

    const health = scanHealth({ containers, summaries, nowMs });
    const uncertain = new Set([
      ...health.uncertain,
      ...rescannedRepos({ containers, before: summaries, after: summariesAfter }),
    ]);
    // Only images a container uses (any state): the same images whose scans are tracked.
    const current = currentFindings(rows, { imageIds: new Set(ids) });
    const kev = kevCount(overview);
    const { stale, failed } = health;
    const report = {
      env: key,
      rows: rows.length,
      findings: current.size,
      kev,
      stale,
      failed,
      current,
    };

    if (!known) {
      stateStore.setEnv(key, { keys: current, kev, atMs: nowMs, stale, failed });
      recordCron(key, 'success');
      log.info(
        { env: key, findings: current.size, kev },
        'Arcane vulnerability digest baseline recorded (no push)'
      );
      return { ...report, outcome: 'baseline' };
    }

    const prev = stateStore.getEnv(key);
    const { added, fixed, next } = diffFindings({ prev: prev.keys, current, uncertain });
    if (next.size > MAX_KEYS) {
      // Never stored cut short: the keys cut off would read as new the week after.
      const error = `more than ${MAX_KEYS} critical/high findings to keep; digest not built`;
      logOnce(
        `cap:${key}`,
        'error',
        { env: key, keys: next.size, max: MAX_KEYS },
        'Arcane vulnerability digest over the key cap; environment not digested'
      );
      recordCron(key, 'failure', error);
      return { ...report, outcome: 'error', error };
    }
    const digest = buildDigest({ added, fixed, kev, prevKev: prev.kev, health, prevHealth: prev });
    const storedKev = nextKev({ kev, prevKev: prev.kev, uncertain: uncertain.size > 0 });
    stateStore.setEnv(key, { keys: next, kev: storedKev, atMs: nowMs, stale, failed });
    recordCron(key, 'success');
    if (digest.push) events.push(buildVulnDigestPush({ env: key, digest }));
    log.info(
      {
        env: key,
        newCritical: digest.newCritical,
        newHigh: digest.newHigh,
        fixed: digest.fixed,
        kev,
        kevNew: digest.kevNew,
        stale: digest.stale.length,
        failed: digest.failed.length,
        push: digest.push,
      },
      'Arcane vulnerability digest'
    );
    return { ...report, outcome: 'digest', digest };
  }

  /** One digest over every listed environment. Returns the events sent and a result per environment. */
  async function runOnce() {
    const events = [];
    const results = [];
    if (listed.size === 0) return { events, results };
    const nowMs = now();
    let envs;
    try {
      envs = await client.listEnvironments();
    } catch (err) {
      readFailed(
        'environments',
        err,
        {},
        'Arcane environment list failed; vulnerability digest skipped'
      );
      for (const name of stateStore.knownNames()) {
        if (listed.has(name)) recordCron(name, 'failure', errText(err));
      }
      results.push({ env: null, outcome: 'error', error: errText(err) });
      stateStore.setLastRun(nowMs);
      return { events, results };
    }
    readOk('environments', {}, 'Arcane environment list recovered');

    // Same selection as the poller (a safe, unique name, not disabled; the poller logs
    // the skipped ones), then only the listed names.
    const byKey = new Map();
    const shared = new Set();
    for (const env of Array.isArray(envs) ? envs : []) {
      const key = envKey(env);
      if (!key || env.enabled === false || !listed.has(key)) continue;
      if (byKey.has(key)) shared.add(key);
      else byKey.set(key, env);
    }
    for (const key of shared) byKey.delete(key);

    for (const name of [...listed].sort()) {
      if (byKey.has(name)) continue;
      logOnce(
        `missing:${name}`,
        'warn',
        { env: name },
        'Environment in ARCANE_VULN_DIGEST_ENVS not found in Arcane (or disabled or not unique); not digested'
      );
      results.push({ env: name, outcome: 'not-found' });
    }

    for (const key of [...byKey.keys()].sort()) {
      try {
        results.push(await digestEnv(byKey.get(key), key, nowMs, events));
      } catch (err) {
        log.error({ env: key, err }, 'Arcane vulnerability digest of environment failed');
        results.push({ env: key, outcome: 'error', error: errText(err) });
      }
    }
    stateStore.setLastRun(nowMs);
    await send(events);
    return { events, results };
  }

  let timer = null;
  let generation = 0; // bumped by stop(), so a run still waiting for push is dropped
  let running = false;
  let slotMs = null;

  async function guardedRun() {
    if (running) return;
    running = true;
    try {
      await runOnce();
    } catch (err) {
      log.error({ err }, 'Arcane vulnerability digest failed');
    } finally {
      running = false;
    }
  }

  /** Push creds are set up but firebase is not ready yet (the async boot race in fcm.js). */
  function pushStarting() {
    return (
      typeof fcm?.isPushConfigured === 'function' &&
      typeof fcm?.isPushEnabled === 'function' &&
      fcm.isPushConfigured() &&
      !fcm.isPushEnabled()
    );
  }

  async function waitForPush() {
    for (let waited = 0; waited < PUSH_WAIT_MS && pushStarting(); waited += PUSH_WAIT_STEP_MS) {
      await sleep(PUSH_WAIT_STEP_MS);
    }
  }

  /** Arm the timer for the first slot after max(now, fromMs). */
  function arm(mine, fromMs = 0) {
    const nowMs = now();
    slotMs = nextSlotMs(Math.max(nowMs, fromMs), day, hour);
    const fired = slotMs;
    timer = setTimer(
      () => {
        timer = null;
        if (mine !== generation) return;
        guardedRun().finally(() => {
          if (mine === generation) arm(mine, fired);
        });
      },
      Math.min(Math.max(slotMs - nowMs, 0), MAX_TIMER_MS)
    );
    timer?.unref?.();
  }

  function stop() {
    generation += 1;
    if (timer) clearTimer(timer);
    timer = null;
  }

  function start() {
    stop();
    if (listed.size === 0) {
      logOnce(
        'off',
        'info',
        {},
        'Arcane vulnerability digest off (ARCANE_VULN_DIGEST_ENVS is empty)'
      );
      return;
    }
    const mine = generation;
    arm(mine);
    const last = stateStore.getLastRun();
    const missed = last === null || last < slotMs - WEEK_MS || stateStore.knownCount() === 0;
    log.info(
      { day, hour, envs: [...listed], next: new Date(slotMs).toISOString(), runNow: missed },
      'Arcane vulnerability digest scheduled'
    );
    if (!missed) return;
    const go = () => {
      if (mine === generation) guardedRun();
    };
    if (!pushStarting()) {
      go();
      return;
    }
    waitForPush().then(go, go);
  }

  return { runOnce, start, stop, nextRunAt: () => slotMs };
}
