/**
 * Background refresh loop and per-domain refresh functions.
 *
 * Refresh functions populate the in-memory cache used by the API routes. They
 * run on a configurable interval (default 30s) and are also called as cold-start
 * fallbacks by routes whose cache hasn't been populated yet.
 *
 * Loop control: startBackgroundRefresh() starts the interval (once at boot);
 * restartBackgroundRefresh() re-reads the interval from display-config and
 * restarts it (called after a settings save). Each tick also follows a hand
 * edit of the interval in the file.
 */

import { readFileSync, statSync } from 'fs';
import { join } from 'path';

import { configProblem, getConfig } from './config.js';
import { getNodesData, noPrometheus, promQuery, promQueryRange, promString, promUrlProblem } from './discovery.js';
import { CONTAINER_EVENTS_EVERY_MS, readRecentContainerEvents } from './containerEvents.js';
import { drivesCache, drivesEnabled } from './drives.js';
import { askAgain } from './firstBoot.js';
import { UP_MISSING } from './status/upMissing.js';
import {
  fetchMonitors,
  assignMonitors,
  checkMonitorMappings,
  checkMonitorNodes,
  checkMonitorNodeNames,
  isFreshMonitor,
  logUnmatchedContainers,
  mappingOf,
  monitorOverrideOf,
  overrideOf,
  selectUnclaimedMonitors,
} from './monitors.js';
import { candidatesOf, inferMonitorNode, nodeBySetting } from './monitorNode.js';
import { serviceRegistry } from './serviceRegistry.js';
import { containerRegistry } from './containerRegistry.js';
import { fetchIntegration } from './integrations/handler.js';
import { isRetiredEntry } from './integrations/registry.js';
import { createIntegrationBackoff } from './integrations/backoff.js';
import {
  configFingerprint,
  integrationInput,
  resolveIntegrationConfig,
} from './integrations/lib/config.js';
import { CACHE_TTL_MS, setCache } from './cache.js';
import { createBeatStore } from './kumaBeats.js';
import { dedupe } from './util/dedupe.js';
import { isJobContainer } from './util/helperContainers.js';
import { groupStacks, isWebMonitor } from './stacks.js';
import { DATA_DIR } from './util/dataDir.js';
import { envValue } from './env.js';
import { createLogger } from './util/logger.js';
import { jsonFileErrorFields } from './util/parseError.js';
import { createSourceHealthLog } from './util/sourceHealthLog.js';
import { failureDetail, failureSentence, readFailure } from './failureWords.js';
import { giteaConfigured, refreshGitea } from './gitea.js';
import { recordRefreshCycle } from './metrics.js';
import { createPushSnapshot, runPushCycle } from './push/dispatch.js';
import { createPushSender } from './push/outbox.js';
import { createAlertPolicy } from './push/alertPolicy.js';
import { createAlertState } from './push/alertState.js';
import { resolveAlerts } from './push/alertRules.js';
import { createTestPush } from './push/testPush.js';
import { cycleSnapshot, heldLevels, heldSinceOf, upgradeSnapshot } from './push/snapshot.js';
import { getPushChannels, getPushStore } from './push/store.js';
import { createStatusTracker, liveCaches, memoryFromLevels, readStatusInputs } from './status/index.js';
import { createBackupJobsReader } from './status/backupJobs.js';
import { resolveThresholds } from './status/thresholds.js';
import { readSavedThresholds } from './thresholdsFile.js';
import { getArcaneAgents } from './arcane/agents.js';

const log = createLogger('refresh');

// Same display-config.json the displayConfig route writes — honor JAGHELM_DATA_DIR.
const DISPLAY_CONFIG_PATH = join(DATA_DIR, 'display-config.json');
const DEFAULT_INTERVAL_MS = 30_000;
const MIN_INTERVAL_SECONDS = 10;

let bgRefreshTimer = null;
let bgRefreshIntervalMs = null; // the interval bgRefreshTimer runs at
let bgRefreshRunning = false;
let lastRefreshComplete = 0; // ms epoch of the last finished cycle (0 = never)
// What the clients' phase lock reads (#630, nextRefreshHintMs): when the
// loop's next cycle is due, when the running one began, how long the last
// took.
let nextCycleAt = 0;
let cycleStartedAt = 0;
let lastCycleMs = null; // null until a cycle has finished

/** Slack after a cycle's expected end before a client asks for what it built. */
export const REFRESH_SETTLE_MS = 250;
/** The shortest wait a hint names. */
export const REFRESH_HINT_MIN_MS = 1000;
/** A cycle's assumed length until one has finished (the cold first cycle after a boot). */
export const REFRESH_COLD_CYCLE_MS = 2000;

// The hint's clock is monotonic (performance.now), so a wall-clock step
// can't move it.
const mono = () => performance.now();

/**
 * Ms from `now` until the loop's cycle should have finished building the
 * status (#630): the cycle's start (the running one's, or the next due) plus
 * the last cycle's length (a default before any has finished) and a settle
 * margin, at least 1 s and at most 2 x the interval. Past that expected end
 * (a cycle running long, or a loop that has stopped cycling) the wait grows
 * with the overrun, twice it, up to the interval, so clients back off from a
 * slow or wedged loop instead of asking about it every second. Pure; all
 * times in one clock, ms.
 */
export function refreshHintMs({ now, intervalMs, nextAt, startedAt, lastMs, running }) {
  const readyAt = (running ? startedAt : nextAt) + (lastMs ?? REFRESH_COLD_CYCLE_MS) + REFRESH_SETTLE_MS;
  const ms = Math.round(readyAt - now);
  if (ms < 0) {
    return Math.round(Math.min(intervalMs, Math.max(REFRESH_HINT_MIN_MS, 2 * -ms)));
  }
  return Math.min(Math.max(ms, REFRESH_HINT_MIN_MS), 2 * intervalMs);
}

/**
 * The hint /api/status and /api/services send as X-Next-Refresh-Ms (#630): a
 * duration, never a clock time, so a client's clock can't skew it. Null with
 * no loop running (the answer then carries no header).
 */
export function nextRefreshHintMs(now = mono()) {
  if (!bgRefreshTimer || bgRefreshIntervalMs === null) return null;
  return refreshHintMs({
    now,
    intervalMs: bgRefreshIntervalMs,
    nextAt: nextCycleAt,
    startedAt: cycleStartedAt,
    lastMs: lastCycleMs,
    running: bgRefreshRunning,
  });
}

// ── Push pipeline wiring ─────────────────────────────────────────────────
// The prev cycle's snapshot is held in memory and persisted beside the other
// data/ stores when it changes, and on shutdown. Exported for that test. A
// file written before #292 holds readings: it is read as levels (upgrade).
// The same file holds the outbox (#579): the events a cycle queued for the
// sender, which sends them in order without the loop waiting on it; and the
// alert history (#267), every event diffed, push set up or not, which
// GET /api/events serves (index.js). The sender is exported for the tests
// that wait for its sends.
export const pushSnapshot = createPushSnapshot({
  path: join(DATA_DIR, 'push-snapshot.json'),
  // A page and its unsent recovery cancel out only when nothing is held back on purpose (#669):
  // a held page's recovery must reach the summary, not make the page vanish.
  collapses: () => {
    const rules = alertRules();
    return rules.groupWindowMs === 0 && !rules.quiet.enabled;
  },
  upgrade: (snap) => upgradeSnapshot(snap, getThresholds()),
  logger: log,
});
// Smarter alerts (#669): how the sender groups a burst, holds the quiet hours,
// honours Snooze and Ack and tags a known cause. The rules are the display
// config's `alerts` (read with the cache the loop already uses, so a save
// takes effect on the next round); Snooze and Ack are kept in the push file
// (as a producer's state, `alert-policy`), so they survive a restart.
export const alertRules = () => resolveAlerts(readDisplayConfig()?.alerts);
export const alertPolicy = createAlertPolicy({
  rules: alertRules,
  state: createAlertState({
    initial: () => pushSnapshot.producerState('alert-policy')?.state,
    save: (state) => pushSnapshot.notify('alert-policy', state, [], { push: false }),
  }),
});
export const pushSender = createPushSender({
  outbox: pushSnapshot,
  store: getPushStore,
  channels: getPushChannels(),
  policy: alertPolicy,
  logger: log,
  // Settings → Notifications' test push follows its sends (#320).
  onResult: (event, token, outcome) => testPush.onResult(event, token, outcome),
});
// "Send test push" (#320): through the same outbox, so it is sent and recorded like any push.
export const testPush = createTestPush({
  snapshot: pushSnapshot,
  sender: pushSender,
  store: getPushStore,
  channels: getPushChannels(),
});

/**
 * The push outbox for /api/health (#579): how many pushes wait to be sent,
 * and the oldest one's age in seconds (null with none), so a key the push service
 * refuses or a long outage shows. It never changes `status`. With push off it
 * reads nothing: 0 and null, as for an empty outbox, so the public probe
 * doesn't say whether push is set up.
 */
export function getPushHealth(now = Date.now()) {
  if (!getPushChannels().isPushEnabled()) return { queued: 0, oldestAgeS: null };
  const queued = pushSnapshot.outbox().length;
  // A push held on purpose (a burst's window, the quiet hours, #669) is not a stall:
  // the age shown is the oldest one that is not.
  const entries = pushSnapshot.entries();
  const waiting = alertPolicy.plan(entries).filter((unit) => unit.ready).flatMap((unit) => unit.entries);
  const oldest = waiting.length > 0 ? Math.min(...waiting.map((e) => e.queuedAt)) : null;
  // Web Push (#653): how many browsers are subscribed and how many of them failed their
  // last send, counts only (never an id or an endpoint), so a silent subscription death shows.
  const web = getPushStore().getDevices().filter((d) => d.platform === 'web');
  return {
    queued,
    oldestAgeS: oldest === null ? null : Math.max(0, Math.round((now - oldest) / 1000)),
    webSubscriptions: web.length,
    webFailing: web.filter((d) => d.lastError).length,
  };
}

// ── Status model wiring (#292) ───────────────────────────────────────────
// Built once a cycle, after the refreshes: /api/status serves it and push
// builds its snapshot from it. Its memory (hysteresis levels, "for 2 cycles"
// runs) lives in this process, so it starts from the levels push last
// persisted (#361): a reading still inside a hysteresis band after a restart
// is still over its line, and sends neither a repeat alert nor a false
// "back to normal". With them, when each held reading's hold began (#469):
// the starts the model served and push copied, so a restart doesn't start
// a hold's 24 h again. From the history's baseline (#267), which every cycle
// moves, push on or off: the model's latest levels. (Push's holds while push
// is off; with push on the two are the same.) So a restart inside a band
// records no false "back to normal" with push off, and with push back on a
// reading that fell below its clear line meanwhile is normal, and its clear is
// sent. Only the nodes services.yaml still has are seeded. A seed that fails
// (an unreadable file is already null) starts the model without it.
const statusTracker = createStatusTracker({
  onDriveFault: reportDriveFault,
  seed: (thresholds) => {
    try {
      const nodes = getConfig()?.nodes;
      const prev = pushSnapshot.historyPrev();
      return memoryFromLevels(heldLevels(prev, thresholds), {
        nodes: nodes && typeof nodes === 'object' ? Object.keys(nodes) : null,
        heldSince: heldSinceOf(prev),
      });
    } catch (err) {
      log.warn({ err }, 'push snapshot levels not usable; the status model starts without them');
      return null;
    }
  },
});
// The message of the drive fault last logged (null: none last cycle). Judging
// a node's drives is allowed to throw (status/drives.js): it is logged once
// until the error changes, and the node is judged without its drives.
let driveFaultMessage = null;
function reportDriveFault(err) {
  if (err === null || err === undefined) {
    if (driveFaultMessage !== null) log.info('drive health judged again');
    driveFaultMessage = null;
    return;
  }
  const message = String(err?.message ?? err);
  if (message === driveFaultMessage) return;
  driveFaultMessage = message;
  log.error({ err }, 'judging drive health failed: the node is judged without its drives, and what it held for them is kept');
}

// The message of the model failure last logged (null: it built last cycle), so
// a failure that repeats every cycle logs once.
let statusModelError = null;
// The status model's run of failed cycles, for /api/health (#440): null while
// it builds; else when the run began (the first failed cycle's clock), how
// many cycles it has failed and the last error's class. This process's own:
// push keeps its count in the push snapshot, across a restart.
let statusModelFailure = null;
// Whether the model has run yet this process (false: /api/health says starting).
let statusModelRan = false;
// display-config.json's backupJobs, the cron jobs that are backups (#291),
// read each cycle from the display config the loop already holds; what it
// drops is logged once.
const backupJobsOf = createBackupJobsReader({ logger: log });

// ── Helpers ──────────────────────────────────────────────────────────────

// display-config.json is cached: the loop needs its refresh interval and push
// thresholds every cycle, and re-parsing the file each time was pure waste.
// Each read stats the file and parses it again only when its identity (mtime,
// size, inode) differs from the cached copy's. Any difference counts, not just
// a newer mtime: a save by rename brings a new inode, and a restore can set an
// older mtime. A hand edit therefore takes effect on the next cycle. The
// displayConfig POST route also invalidates the cache after a save.
let cachedDisplayConfig; // undefined: not read yet; null: missing or unreadable
let cachedDisplayConfigId = null; // the file identity cachedDisplayConfig was read from

export function invalidateDisplayConfigCache() {
  cachedDisplayConfig = undefined;
}

function displayConfigId() {
  try {
    const st = statSync(DISPLAY_CONFIG_PATH);
    return `${st.mtimeMs}:${st.size}:${st.ino}`;
  } catch {
    return null; // missing
  }
}

/** The parsed display-config.json, or null on missing/error. The embed check
 * (routes/embedCheck.js) reads the saved app tabs through it too. */
export function readDisplayConfig() {
  const id = displayConfigId();
  if (cachedDisplayConfig !== undefined && id === cachedDisplayConfigId) return cachedDisplayConfig;
  cachedDisplayConfigId = id;
  cachedDisplayConfig = null;
  if (id === null) return null;
  try {
    cachedDisplayConfig = JSON.parse(readFileSync(DISPLAY_CONFIG_PATH, 'utf8'));
  } catch (err) {
    // Once per bad file: it is parsed again only when it changes.
    // A parse error as its reason and position: V8's message quotes the file (#504).
    log.warn(jsonFileErrorFields(err), 'display-config.json is unreadable; using the default refresh interval and push thresholds');
  }
  return cachedDisplayConfig;
}

/**
 * The thresholds a display config and saved lines set (status/thresholds.js):
 * the defaults, with thresholds.json's lines over them when there are any
 * (`saved`, #320), else the display config's `pushThresholds`. The demo reads
 * its own config's through it (#437), with no saved lines: it reads no file.
 */
export function thresholdsOf(displayConfig, saved = null) {
  return resolveThresholds(displayConfig?.pushThresholds, saved);
}

/**
 * The server's thresholds in force: thresholds.json's lines, as Settings →
 * Notifications saved them, over the defaults (thresholdsOf; display-config.json's
 * `pushThresholds` while there are none). The status model reads them, and
 * push sends what the model judges, so there is one set of lines.
 */
export function getThresholds() {
  return thresholdsOf(readDisplayConfig(), readSavedThresholds());
}

/**
 * Builds this cycle's status from what the refreshes cached (reading
 * cron-jobs.json once, for the model and so for push), keeps it for
 * /api/status and returns it. `cycleErrors` is runCycleRefreshes' error set.
 * The display config gives the thresholds and which jobs are backups
 * (`backupJobs`, #291); the Arcane poller's last read gives the agents
 * (arcane/agents.js), with no Arcane request of the model's own; config.js
 * says whether services.yaml is no usable config, and why (#505), from its
 * last read, with no read of the model's own.
 *
 * It never throws. If the model throws (an input it can't read), it logs the
 * error once until the error changes or the model builds again, keeps the
 * last status for /api/status, counts the failed cycle for /api/health
 * (getStatusModelHealth), and returns null: push then holds its snapshot and
 * pages the failure itself after 2 cycles in a row (#440, runStatusAndPush).
 *
 * The status stays fresh in the cache for two refresh intervals (at least the
 * cache's 120 s), so /api/status has one between cycles however long they are.
 */
export function updateStatus(cycleErrors = [], now = Date.now()) {
  let status;
  try {
    const displayConfig = readDisplayConfig();
    status = statusTracker.update({
      inputs: readStatusInputs(liveCaches, {
        cycleErrors,
        backupJobs: backupJobsOf(displayConfig),
        arcaneAgents: getArcaneAgents(),
        configProblem: configProblem()?.reason ?? null,
      }),
      thresholds: thresholdsOf(displayConfig, readSavedThresholds()),
      now,
    });
  } catch (err) {
    statusModelRan = true;
    statusModelFailure = {
      since: statusModelFailure?.since ?? now,
      failedCycles: (statusModelFailure?.failedCycles ?? 0) + 1,
      error: errorClassOf(err),
    };
    const message = String(err?.message ?? err);
    if (message !== statusModelError) {
      log.error(
        { err },
        'status model failed: /api/status keeps the last status, and push holds its snapshot (one push after 2 cycles)'
      );
      statusModelError = message;
    }
    return null;
  }
  statusModelRan = true;
  if (statusModelFailure !== null) {
    log.info(
      { failedCycles: statusModelFailure.failedCycles, since: new Date(statusModelFailure.since).toISOString() },
      'status model built again'
    );
    statusModelFailure = null;
  }
  statusModelError = null;
  const intervalMs = bgRefreshIntervalMs ?? getRefreshIntervalMs();
  setCache('status', status, null, { ttlMs: Math.max(CACHE_TTL_MS, 2 * intervalMs) });
  return status;
}

/**
 * An error's class for /api/health ("TypeError"): never its message, which
 * can quote the input the model couldn't read. A name that isn't a plain
 * identifier is "Error".
 */
function errorClassOf(err) {
  const name = err?.name;
  return typeof name === 'string' && /^[A-Za-z_$][\w$]{0,63}$/.test(name) ? name : 'Error';
}

/**
 * The status model's health, for /api/health (#440): `starting` before its
 * first cycle, `ok` while it builds, and `degraded` while it throws, with the
 * error's class, since when (ISO) and for how many cycles in a row. Nothing
 * of the input or the error's message. In this process's memory: after a
 * restart, the run counts from the restart's first cycle.
 */
export function getStatusModelHealth() {
  if (statusModelFailure !== null) {
    return {
      state: 'degraded',
      error: statusModelFailure.error,
      since: new Date(statusModelFailure.since).toISOString(),
      failedCycles: statusModelFailure.failedCycles,
    };
  }
  return { state: statusModelRan ? 'ok' : 'starting' };
}

/** The drive read in flight, so a slow Prometheus never stacks reads (refreshDrives). */
let drivesReading = null;

/**
 * Starts the drive read (drives.js) and returns at once: the status step never
 * waits for it, so a Prometheus outage or a slow query adds nothing to a cycle
 * and the model's `now` stays the cycle's. The model uses the last result the
 * `drives` cache key holds (kept two refresh intervals, at least the cache's
 * TTL, like the status), so a read lands one cycle after it is asked. The
 * module being off is the exception: it is a switch, read here, and the cache
 * says so before this cycle's status is built.
 *
 * A read that failed leaves the last result in place until it ages out, then
 * null, which the model takes as a read that did not run: it keeps what it
 * holds for drives and invents nothing. With no Prometheus to ask (none set
 * up, or its URL refused, #419, #704) no request is made. Never throws.
 */
function refreshDrives() {
  const intervalMs = bgRefreshIntervalMs ?? getRefreshIntervalMs();
  const ttlMs = Math.max(CACHE_TTL_MS, 2 * intervalMs);
  if (!drivesEnabled()) {
    setCache('drives', { enabled: false }, null, { ttlMs });
    return;
  }
  if (drivesReading || promUrlProblem() || noPrometheus()) return;
  drivesReading = (async () => {
    try {
      const data = await drivesCache.read();
      if (data) setCache('drives', data, null, { ttlMs });
    } catch (err) {
      log.warn({ err: failureDetail(err) }, 'drive read failed; the status model keeps what it holds for drives');
    }
  })().finally(() => {
    drivesReading = null;
  });
}

/** Test seam: resolves when the drive read in flight (if any) has landed. */
export function settleDrives() {
  return drivesReading ?? Promise.resolve();
}

/** The read refreshContainerEvents makes: a seam, as drivesCache.read is, for a test to replace. */
export const containerEventsFeed = {
  read: (now) => readRecentContainerEvents({ queryRange: promQueryRange, config: getConfig(), now }),
};

/** The container events read in flight, and when the last one started (refreshContainerEvents). */
let containerEventsReading = null;
let containerEventsReadAt = 0;

/**
 * Starts the read of cAdvisor's restarts and OOM kills over the last hour
 * (containerEvents.js, #764) and returns at once, as refreshDrives does: the
 * status step never waits for it, a slow Prometheus adds nothing to a cycle,
 * and the model uses the last result the `containerEvents` cache key holds
 * (kept two refresh intervals, at least the cache's TTL). The series' step is
 * a minute, so the read runs at most once in CONTAINER_EVENTS_EVERY_MS, not
 * every cycle. A read that failed leaves the last result until it ages out,
 * then null, which the model takes as no read (no restart-loop issues, and
 * push keeps what it holds, push/snapshot.js buildContainerConditions). With
 * no Prometheus to ask no request is made. Never throws.
 */
function refreshContainerEvents(now = Date.now()) {
  if (containerEventsReading || promUrlProblem() || noPrometheus()) return;
  if (now - containerEventsReadAt < CONTAINER_EVENTS_EVERY_MS) return;
  containerEventsReadAt = now;
  const intervalMs = bgRefreshIntervalMs ?? getRefreshIntervalMs();
  const ttlMs = Math.max(CACHE_TTL_MS, 2 * intervalMs, 2 * CONTAINER_EVENTS_EVERY_MS);
  containerEventsReading = (async () => {
    try {
      const data = await containerEventsFeed.read(now);
      setCache('containerEvents', data, null, { ttlMs });
    } catch (err) {
      log.warn({ err: failureDetail(err) }, 'container event read failed; the status model keeps the last read until it ages out');
    }
  })().finally(() => {
    containerEventsReading = null;
  });
}

/** Test seam: resolves when the container event read in flight (if any) has landed. */
export function settleContainerEvents() {
  return containerEventsReading ?? Promise.resolve();
}

/**
 * The status-and-push half of a background cycle, after the refreshes: the
 * status model (updateStatus), then the push cycle on it, which queues its
 * pushes for the sender and returns without waiting for one (#579). It can NEVER reject:
 * updateStatus never throws, and runPushCycle swallows everything. In a cycle
 * with no status (the model threw), push diffs and sends nothing the model
 * judges, and keeps that part of its snapshot as it was, so the next cycle
 * the model builds diffs against the last good snapshot and a change made
 * meanwhile is still sent. It counts the failed cycle as a source's (#440,
 * push/snapshot.js modelFailedSnapshot): the second in a row sends one
 * "JagHelm status check failing", and the cycle it builds again one recovery.
 * With push off it still diffs and records each change in the alert history
 * (#267), and queues and sends nothing.
 *
 * `now` is the model's clock. Push reads none: a held reading is timed by the
 * model alone, and the snapshot copies its starts (#469).
 */
export async function runStatusAndPush(cycleErrors = [], now = Date.now()) {
  refreshDrives();
  refreshContainerEvents(now);
  const status = updateStatus(cycleErrors, now);
  await runPushCycle({
    buildSnapshotFn: (prev) => cycleSnapshot(liveCaches, prev, status),
    status,
    store: getPushStore(),
    channels: getPushChannels(),
    snapshot: pushSnapshot,
    sender: pushSender,
    logger: log,
  });
}

function formatContainerName(name) {
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function getRefreshIntervalMs() {
  const data = readDisplayConfig();
  const seconds = data?.refreshInterval;
  if (typeof seconds === 'number' && seconds >= MIN_INTERVAL_SECONDS) return seconds * 1000;
  return DEFAULT_INTERVAL_MS;
}

const reportPrometheusHealth = createSourceHealthLog('prometheus', log);

/**
 * Prometheus failing or recovering, logged once each, and again when it fails
 * for another reason (sourceHealthLog.js): `error` is the failure (an error,
 * or its text), logged as its raw detail, and `words` what a client is told,
 * by default the failure in words (failureWords.js, #605). A refused
 * PROMETHEUS_URL (#419) fails every cycle with its problem, which the boot
 * warned once: its cycles log nothing more.
 *
 * @param {{ ok: boolean, error?: unknown, words?: string | null }} outcome
 */
function reportPrometheus({ ok, error = null, words = null }) {
  if (promUrlProblem()) return;
  if (ok) reportPrometheusHealth({ ok });
  else reportPrometheusHealth({ ok, error: failureDetail(error), words: words ?? failureSentence('prometheus', error) });
}

// ── Domain refresh functions ─────────────────────────────────────────────

/**
 * Build the unified /api/services payload: node metrics, container stats,
 * Kuma monitor health, and config overrides — merged into one structure.
 */
export async function refreshServices() {
  return dedupe('services', _refreshServices);
}

/**
 * Rank for the canonical per-node sort: down → unknown → up. Both frontends
 * inherit this order (web renders in array order, mobile re-sorts identically).
 */
function serviceRank(s) {
  if (s.status === 'down') return 0;
  if (s.status === 'unknown') return 1;
  return 2;
}

/**
 * Pure assembly of the services cache payload from discovered node data, Kuma
 * monitors, and the container presence registry. Extracted from _refreshServices
 * so it can be unit-tested without the network.
 *
 * Monitors are matched to containers once for the whole cycle
 * (assignMonitors, #240): a monitor marks one container unless services.yaml
 * maps it explicitly to several (`monitor`, `monitor_per_node`). The containers
 * that compete for monitors are the running ones on the board, and the ones
 * that stopped in the last 24 hours (the container registry's missing ones,
 * from the moment they stop, until JAGHELM_PRESENCE_TTL_MS): a down monitor
 * whose container stopped stays with it while it is the better match, so its
 * outage shows on that container's card, not on a lookalike's. Once the monitor
 * is up, a running container can have it. CI job containers are left out, as
 * discovery leaves them out (util/helperContainers.js), including the ones the
 * container registry recorded before that. `lastSeenNodeOf` /
 * `lastSeenContainerOf` place outage cards.
 *
 * Three passes:
 *  (a) Running-container cards — Kuma overlays the status of the monitor the
 *      container got, unless it is paused (isFreshMonitor: then the card is
 *      the container's own, #488); each running container is recorded into the container
 *      registry (last-seen node + timing). A name running on several nodes
 *      (cadvisor, alloy...) is recorded once, with the last node in the pass,
 *      and so is an explicitly mapped monitor in `seen`: recording each
 *      sighting flipped the node within every pass and rewrote the registries
 *      every cycle. The containers of a node are taken in name order, so `seen`
 *      does not depend on the order discovery listed them in.
 *  (b) Monitors no running container got — each active one reporting `down`
 *      or `up` is placed (placeMonitor): on the node of the stopped container
 *      that got the monitor, under its name (on the monitor's last-seen node
 *      when that container is the one it last ran as); otherwise on the
 *      monitor's last-seen node, under the container it was last matched to
 *      (base spec).
 *      A uid is never one a card already on the node has, or one a monitor
 *      placed earlier in the pass took: a monitor whose last container still
 *      runs there, matched to something else now, is under the monitor's name.
 *      A down one becomes a red card. An up one draws nothing on the board; its
 *      uid goes in `upWithoutCard`, which the push snapshot reads as up, so the
 *      monitor's recovery is sent on the uid of its down push (#390).
 *  (c) Breadcrumb synthesis — established, UNMONITORED containers that have
 *      vanished (absent past grace, within TTL) become grey `unknown`
 *      `source:'presence'` cards on their last-seen node. Skipped if the
 *      container is running anywhere this cycle, if it got a down monitor in
 *      the matching that isn't paused (isFreshMonitor: a paused one draws no
 *      red card) or a down monitor's red card has its uid (Kuma owns it: its
 *      outage is the monitor's red card, #438), or if it is a CI job's.
 *      Skipped altogether when `presenceKnown` is false: a
 *      Prometheus query failed this cycle, or a node is unread because
 *      Prometheus hasn't scraped it yet (#470), so a container missing from
 *      the list may still be running, and a missed breadcrumb beats a false
 *      one (#232). Otherwise skipped on a node that is unread (`failedReads`)
 *      for a reason that lasts (Prometheus failing for that node, #476, #477:
 *      status/upMissing.js), so only that node's breadcrumbs wait for it.
 *
 * Each node carries `reachable` from discovery (Prometheus' `up` for the node:
 * true, false, or null when Prometheus has no `up` series for it), and
 * `failedReads`: the parts of the node whose queries failed this cycle
 * (discovery's NODE_READS names; [] when they all answered), or every part
 * for a node Prometheus hasn't scraped yet (#470). The status model makes
 * each of those unknown, and push holds its last level for them. A node
 * whose `up` discovery checked against Prometheus's targets carries its
 * verdict (`whyNoUp`, status/upMissing.js); `whyNoUp` (nodeKey -> verdict)
 * keeps it beside the payload for the status model, which words the node by
 * it.
 *
 * Every node's cards are ordered down → unknown → up.
 *
 * Finally it computes ONE `overallHealth` from the whole assembled board (after
 * sorting) — `down` if any card is down; else `degraded` if any card is unknown
 * (presence breadcrumbs included); else `up` if there are cards; else `unknown`.
 * BOTH frontends read this single server value for their global dot, so they are
 * symmetric and deterministic (no client re-derivation).
 *
 * `unmatched` (unique names of the shown, running containers that got no
 * monitor on any node, leaving out those opted out with `monitor: false`) and
 * `containerCount` (how many shown, running containers there were) feed the
 * once-per-boot "no matching monitor" log line.
 *
 * `monitorOf` (uid -> Kuma monitor id) names the monitor each monitored uid of
 * the cycle carries: a running card's, a red card's, an up entry's, and a
 * pending or in-maintenance monitor's with no card (`kumaWithoutCard`). The
 * push snapshot keeps it, so a monitor's state goes with it when its uid
 * changes (#395), and a monitor is one push however many cards it feeds
 * (#407). Like `upWithoutCard`, it is for push only.
 *
 * Three more maps are for the status model only (status/, #290), kept beside
 * the payload like those two, so the payload keeps its shape and meaning
 * (spec §6.3):
 *  - `kumaStatusOf` (uid -> 'pending' | 'maintenance' | 'paused'): the running
 *    cards whose monitor Kuma reports pending or in maintenance, or has
 *    stopped checking (paused: stale or `active: false`, #488). Their `status`
 *    stays 'unknown', as today.
 *  - `kumaWithoutCard` (uid -> 'pending' | 'maintenance'): the active monitors
 *    no running container got that are pending or in maintenance, each under
 *    the uid placeMonitor gives it. They are placed after the up and down
 *    ones, so they take no uid one of those would have had.
 *  - `backedBy` (uid -> { monitor, status }): the grey presence cards of
 *    containers that were the last container of a Kuma monitor Kuma still has
 *    (the service registry's), with the monitor's name and Kuma's status for
 *    it ('up', 'down', 'pending', 'maintenance' or 'unknown'). The model
 *    judges such a missing container by its monitor's status (#438).
 *
 * @returns {{ nodes: object, seen: Array<{monitorId:any, nodeKey:string, container:string}>, outageCount: number, breadcrumbCount: number, overallHealth: 'down'|'degraded'|'up'|'unknown', unmatched: string[], containerCount: number, upWithoutCard: string[], monitorOf: Record<string, string>, kumaStatusOf: Record<string, string>, kumaWithoutCard: Record<string, string>, backedBy: Record<string, { monitor: string, status: string }>, monitorPlaced: Record<string, { monitor: string, node: string, by: string }> }}
 */
export function assembleServices({ nodeResults, monitors, config, lastSeenNodeOf, lastSeenContainerOf, containerRegistry, now = Date.now, presenceKnown = true }) {
  const consumed = new Set();
  const seen = new Map(); // monitor id -> { monitorId, nodeKey, container }, last in the pass
  const monitorOf = {}; // uid -> the id of the monitor it carries (#395)
  const kumaStatusOf = {}; // uid -> 'pending' | 'maintenance', for the status model (#290)
  const kumaWithoutCard = {}; // uid -> 'pending' | 'maintenance', a monitor with no card (#290)
  const backedBy = {}; // presence uid -> the Kuma monitor its container last ran as, and its status (#290, #438)
  const runningOn = new Map(); // container name -> the last node it runs on in this pass
  const projectOf = new Map(); // container name -> its Compose project, as the last node that runs it says (#642)
  const webMonitored = new Set(); // uids of the cards whose own monitor checks a web address (#642)
  const nowMs = now();
  const entries = nodeResults.filter(Boolean);
  const nodeOrder = entries.map(([nodeKey]) => nodeKey);

  // The shown, running containers of each node, in name order.
  const shown = entries.map(([nodeKey, nodeCfg, nodeData]) => {
    const hideList = (nodeCfg.hide || []).map((h) => h.toLowerCase());
    const containers = nodeData.containers
      .filter((c) => !hideList.some((h) => c.container.toLowerCase().includes(h)))
      .sort((a, b) => (a.container < b.container ? -1 : a.container > b.container ? 1 : 0));
    for (const c of containers) {
      runningOn.set(c.container, nodeKey);
      if (c.project) projectOf.set(c.container, c.project);
    }
    return containers;
  });
  const containerCount = shown.reduce((n, containers) => n + containers.length, 0);

  // Containers that stopped in the last 24 hours compete for down monitors too.
  const stopped = containerRegistry
    ? containerRegistry
        .getMissing({ now: nowMs, graceMs: 0 })
        .filter((v) => !runningOn.has(v.container) && !isJobContainer(v.container))
        .sort((a, b) => (a.container < b.container ? -1 : a.container > b.container ? 1 : 0))
    : [];

  // Warns once per bad mapping; with no nodes in the config, it can't tell.
  const configNodeKeys = Object.keys(config.nodes || {});
  checkMonitorMappings(config.services, configNodeKeys.length ? configNodeKeys : null);
  checkMonitorNodes(config.monitor_nodes, configNodeKeys.length ? configNodeKeys : null);
  checkMonitorNodeNames(config.monitor_nodes, monitors);
  const running = shown.flatMap((containers, n) => containers.map((c) => ({ container: c.container, nodeKey: nodeOrder[n] })));
  const assigned = assignMonitors({
    candidates: [...running, ...stopped.map((v) => ({ container: v.container, nodeKey: v.lastSeenNode, stopped: true }))],
    monitors,
    services: config.services,
    nodeOrder,
  });

  // The stopped containers that got a (down) monitor: Kuma owns them. Not by a
  // paused one, which draws no red card: the container keeps its grey card.
  // A stopped container's Compose project, so its red card stays in its stack (#642).
  const stoppedProject = new Map(stopped.filter((v) => v.project).map((v) => [v.container, v.project]));
  const stoppedOwner = new Map(); // monitor id -> the first stopped container that got it
  const ownedStopped = new Set();
  stopped.forEach((v, j) => {
    const m = assigned[running.length + j];
    if (!m || !isFreshMonitor(m, { now: nowMs })) return;
    ownedStopped.add(v.container);
    if (!stoppedOwner.has(m.id)) stoppedOwner.set(m.id, v);
  });

  // (a) Running-container cards.
  const withMonitor = new Set(); // container names that got a monitor on some node
  let next = 0;
  const nodeEntries = entries.map(([nodeKey, nodeCfg, nodeData], n) => {
    const metrics = nodeData.metrics;
    const services = shown[n].map((c) => {
      const displayName = overrideOf(config.services, c.container, nodeKey, 'display_name') || formatContainerName(c.container);
      const monitor = assigned[next++];
      // A paused or stale monitor (isFreshMonitor) says nothing about the
      // container: the card keeps the container's own status and the model
      // reads the service as no signal ('paused'), so the push snapshot holds
      // the uid at its last state: no down on staleness, no repeat page when
      // the monitor flaps, a recovery if it paged first (#488).
      const paused = !!monitor && !isFreshMonitor(monitor, { now: nowMs });
      if (monitor) {
        consumed.add(monitor.id);
        withMonitor.add(c.container);
        monitorOf[`${nodeKey}:${c.container}`] = String(monitor.id);
        if (isWebMonitor(monitor)) webMonitored.add(`${nodeKey}:${c.container}`);
        if (paused) kumaStatusOf[`${nodeKey}:${c.container}`] = 'paused';
        else if (isPendingOrMaintenance(monitor)) kumaStatusOf[`${nodeKey}:${c.container}`] = monitor.kumaStatus;
        // Remember the container too, so a later outage's synth card can reuse
        // this exact uid (keeps down→recovery on ONE key for the push differ).
        seen.set(monitor.id, { monitorId: monitor.id, nodeKey, container: c.container });
      }
      const rawStatus = (!paused && monitor?.status) || c.status || 'unknown';
      // Normalise Docker's 'running' to the Kuma-aligned 'up' so the status
      // vocabulary is consistent across container and monitor cards.
      const status = rawStatus === 'running' ? 'up' : rawStatus;

      const card = {
        container: c.container,
        uid: `${nodeKey}:${c.container}`,
        display_name: displayName,
        icon: overrideOf(config.services, c.container, nodeKey, 'icon'),
        status,
        monitored: !!monitor,
        ping: (!paused && monitor?.ping) || null,
        uptime24: (!paused && monitor?.uptime24) || null,
        docker: c.docker,
        integration: null,
        source: 'container',
      };
      // Where it runs from: its Compose project and image, when cAdvisor says (#642).
      if (c.project) card.project = c.project;
      if (c.image) card.image = c.image;
      return card;
    });

    return [
      nodeKey,
      {
        display_name: nodeCfg.display_name || nodeKey,
        subtitle: nodeCfg.subtitle || '',
        icon: nodeCfg.icon || '🖥',
        border_color: nodeCfg.border_color || '#6366f1',
        reachable: typeof nodeData.reachable === 'boolean' ? nodeData.reachable : null,
        failedReads: Array.isArray(nodeData.failedReads) ? nodeData.failedReads : [],
        metrics,
        services,
      },
    ];
  });

  const nodes = Object.fromEntries(nodeEntries);
  const nodeKeys = Object.keys(nodes);
  // Each checked node's verdict on its `up` (#476), for the status model.
  const whyNoUp = {};
  for (const [nodeKey, , nodeData] of entries) {
    if (typeof nodeData.whyNoUp === 'string') whyNoUp[nodeKey] = nodeData.whyNoUp;
  }
  if (containerRegistry) {
    for (const [name, nodeKey] of runningOn) containerRegistry.recordSeen(name, nodeKey, nowMs, projectOf.get(name), webMonitored.has(`${nodeKey}:${name}`));
  }
  // A container opted out with `monitor: false` has no monitor on purpose.
  const wantsMonitor = running.filter((r) => mappingOf(config.services, r.container, r.nodeKey)?.monitor !== false);
  const unmatched = [...new Set(wantsMonitor.map((r) => r.container))].filter((name) => !withMonitor.has(name));

  // (b) Monitors no running container got: down-monitor synthesis, and the up
  // entries of the push snapshot (#390). selectUnclaimedMonitors keeps only
  // monitors that are up or down, active, and FRESH (a paused monitor's
  // heartbeat goes stale and is excluded, so a retired-while-down service can't
  // leave a phantom red card or send a false recovery — `active` reads null on
  // real Kuma and can't be relied on). Each one gets its uid from placeMonitor,
  // in one pass whatever its status, in id order, so a monitor keeps its uid
  // from down to up while its last container isn't in the stopped list (a
  // stopped owner only competes for a down monitor; when it moves anyway, the
  // push snapshot carries the monitor's state to its new uid, #395). A down one
  // becomes a red card; an up one draws nothing and is listed in
  // `upWithoutCard`, which the push snapshot reads as up, so its recovery is
  // sent on the uid its down push had.
  const taken = new Set(nodeKeys.flatMap((k) => nodes[k].services.map((s) => s.uid)));
  const upWithoutCard = [];
  const monitorPlaced = {}; // uid -> { monitor, node, by } for each monitor no container carries (#644)
  const candidates = candidatesOf(entries);
  const where = {
    setting: (m) => nodeBySetting(config.monitor_nodes, m.name, candidates),
    inferred: (m) => inferMonitorNode(m, candidates),
  };
  let outageCount = 0;
  for (const m of selectUnclaimedMonitors(monitors, consumed, { now: nowMs })) {
    if (m.status === 'down') outageCount += 1;
    const place = placeMonitor(m, { nodes, nodeKeys, taken, owner: stoppedOwner.get(m.id), lastSeenNodeOf, lastSeenContainerOf, where });
    if (!place) continue; // no nodes to attach to
    taken.add(place.uid);
    monitorOf[place.uid] = String(m.id);
    monitorPlaced[place.uid] = { monitor: m.name, node: place.nodeKey, by: place.by };
    if (m.status === 'up') {
      upWithoutCard.push(place.uid);
      continue;
    }
    const { nodeKey, idPart, remembered } = place;
    // A stopped member's red card is still its stack's member (#642).
    if (isWebMonitor(m)) webMonitored.add(place.uid);
    const redProject = stoppedProject.get(idPart);
    nodes[nodeKey].services.push({
      ...(redProject && { project: redProject }),
      container: idPart,
      uid: place.uid,
      display_name: monitorOverrideOf(config.services, [idPart, m.name], nodeKey, 'display_name') || (idPart === remembered ? formatContainerName(remembered) : m.name),
      icon: monitorOverrideOf(config.services, [idPart, m.name], nodeKey, 'icon'),
      status: 'down',
      monitored: true,
      ping: m.ping || null,
      uptime24: m.uptime24 || null,
      docker: null,
      integration: null,
      source: 'monitor',
    });
  }
  // The pending and in-maintenance ones, for the status model only, after the
  // up and down ones so they take no uid of theirs.
  for (const m of selectUnclaimedMonitors(monitors, consumed, { now: nowMs, pick: isPendingOrMaintenance })) {
    const place = placeMonitor(m, { nodes, nodeKeys, taken, owner: undefined, lastSeenNodeOf, lastSeenContainerOf, where });
    if (!place) continue;
    taken.add(place.uid);
    kumaWithoutCard[place.uid] = m.kumaStatus;
    monitorPlaced[place.uid] = { monitor: m.name, node: place.nodeKey, by: place.by };
    // Push holds such a monitor at its last state, so it goes with its
    // monitor like the others (#292): down, then pending, then down is one
    // outage, wherever its key lands.
    monitorOf[place.uid] = String(m.id);
  }

  // (c) Breadcrumb synthesis — vanished, established, UNMONITORED containers.
  let breadcrumbCount = 0;
  if (containerRegistry && presenceKnown) {
    const candidates = containerRegistry.getMissing({ now: nowMs });
    // The container each monitor Kuma has last ran as, lowest monitor id first,
    // with Kuma's status for the monitor: the model judges the grey card by it (#438).
    const backing = new Map();
    if (candidates.length > 0 && lastSeenContainerOf) {
      const byId = Object.values(monitors).filter(Boolean).sort((a, b) => Number(a.id) - Number(b.id));
      for (const m of byId) {
        const last = lastSeenContainerOf(m.id);
        if (last && !backing.has(last)) backing.set(last, { monitor: m.name, status: monitorStatus(m, nowMs) });
      }
    }
    // The uids of the cards already drawn: the running containers' and the red cards.
    const drawn = new Set(nodeKeys.flatMap((k) => nodes[k].services.map((s) => s.uid)));
    for (const cand of candidates) {
      if (runningOn.has(cand.container)) continue;                // running somewhere this cycle
      if (isJobContainer(cand.container)) continue;               // a CI job, done
      // Kuma owns it: it got a down monitor in the matching, by its explicit
      // mapping or by name, so the outage shows as that monitor's red card.
      if (ownedStopped.has(cand.container)) continue;
      let nodeKey = cand.lastSeenNode;
      if (!nodeKey || !nodes[nodeKey]) nodeKey = nodeKeys[0];
      if (!nodeKey || !nodes[nodeKey]) continue; // no nodes to attach to
      if (nodes[nodeKey].failedReads.length > 0) continue; // its node unread: it may still run there
      // Kuma owns it too when a down monitor's red card has its uid: placed
      // under the container the monitor last ran as, which didn't get it by
      // name (#438). One card for one uid, and one crit for one outage.
      if (drawn.has(`${nodeKey}:${cand.container}`)) continue;
      const crumb = {
        container: cand.container,
        uid: `${nodeKey}:${cand.container}`,
        display_name: overrideOf(config.services, cand.container, nodeKey, 'display_name') || formatContainerName(cand.container),
        icon: overrideOf(config.services, cand.container, nodeKey, 'icon'),
        status: 'unknown',
        monitored: false,
        source: 'presence',
        lastSeenAt: cand.lastSeenAt,
        ping: null,
        uptime24: null,
        docker: null,
        integration: null,
      };
      // Still a member of the stack it ran in (#642).
      if (cand.project) crumb.project = cand.project;
      // Its own row, as it was when it ran, if its monitor checked a web address.
      if (cand.project && cand.web) webMonitored.add(crumb.uid);
      nodes[nodeKey].services.push(crumb);
      if (backing.has(cand.container)) backedBy[`${nodeKey}:${cand.container}`] = backing.get(cand.container);
      // What still names it, for the Remove button's confirm (#688): the monitor
      // services.yaml maps it to, and the one Kuma last had on it.
      const mapped = mappingOf(config.services, cand.container, nodeKey)?.monitor;
      if (typeof mapped === 'string') crumb.mapped = mapped;
      if (backing.has(cand.container)) crumb.kuma = backing.get(cand.container).monitor;
      breadcrumbCount += 1;
    }
  }

  // Canonical order per node: down → unknown → up, then alphabetical.
  for (const node of Object.values(nodes)) {
    node.services.sort((a, b) => serviceRank(a) - serviceRank(b) || a.display_name.localeCompare(b.display_name));
  }

  // One row per Compose stack (#642): annotates the cards, keeping their uids.
  groupStacks({
    nodes,
    stacks: config.stacks,
    web: webMonitored,
    nameOf: formatContainerName,
    configNodes: configNodeKeys.length ? configNodeKeys : null,
  });

  // Server-computed global health (the web header reads the status model,
  // /api/status, since #296). Computed ONCE from
  // every assembled card across all nodes, so it is deterministic — a presence
  // breadcrumb (status 'unknown') drives 'degraded', exactly as a
  // tracked-unknown monitor would.
  let anyCard = false;
  let anyDown = false;
  let anyUnknown = false;
  for (const node of Object.values(nodes)) {
    for (const s of node.services) {
      anyCard = true;
      if (s.status === 'down') anyDown = true;
      else if (s.status === 'unknown') anyUnknown = true;
    }
  }
  const overallHealth = anyDown ? 'down' : anyUnknown ? 'degraded' : anyCard ? 'up' : 'unknown';

  return {
    nodes,
    seen: [...seen.values()],
    outageCount,
    breadcrumbCount,
    overallHealth,
    unmatched: [...unmatched].sort(),
    containerCount,
    upWithoutCard,
    monitorOf,
    kumaStatusOf,
    kumaWithoutCard,
    backedBy,
    monitorPlaced,
    whyNoUp,
  };
}

/** A monitor Kuma reports pending or in maintenance (kumaMetrics.js kumaStatusFromValue). */
function isPendingOrMaintenance(m) {
  return m.kumaStatus === 'pending' || m.kumaStatus === 'maintenance';
}

/**
 * Kuma's status for a monitor: 'up', 'down', 'pending', 'maintenance', or
 * 'unknown' when it has none or is paused (isFreshMonitor): a paused monitor
 * vouches for nothing, whatever its last beat said.
 */
function monitorStatus(m, nowMs) {
  if (!isFreshMonitor(m, { now: nowMs })) return 'unknown';
  if (isPendingOrMaintenance(m)) return m.kumaStatus;
  return m.status === 'up' || m.status === 'down' ? m.status : 'unknown';
}

/**
 * The services refresh's cache entry for one assembleServices() result: the
 * `/api/services` payload, and what is kept beside it (setCache's `internal`).
 * The demo builds its board's entry through it too (demoFixtures.js), so the
 * status model reads the demo's board as it reads a live one (#437).
 *
 * overallHealth is server-computed once and shipped in the payload (the web
 * header reads /api/status since #296).
 * `sources` says whether each upstream answered this cycle (#232): the push
 * snapshot keeps its last state for one that didn't, so a failed poll is not
 * read as every host or service going down. `upWithoutCard`, the uids of the
 * up monitors no card is drawn for (#390), and `monitorOf`, the monitor each
 * monitored uid carries (#395), are for the push snapshot only, so they are
 * kept beside the payload, not in the served JSON. So are the status model's
 * (#290): `kumaStatusOf`, `kumaWithoutCard`, `backedBy` and `whyNoUp` (see
 * assembleServices) and `sourceErrors`, why Prometheus or Kuma failed, as
 * its cause (`{ cause, status? }`, failureWords.js readFailure, from the
 * error, the failure, or its text given): the model says it in words (#605);
 * and `prometheusProblem`, what Prometheus fails at while it answers (a
 * node's verdict on its missing `up`, #476), or null.
 *
 * `beats` (#312), when given, is served: each monitored uid's heartbeat
 * strip (kumaBeats.js encodedFor), which the rows read beside the
 * latencies. The status model reads nothing of it, so /api/status, and its
 * ETag, hold while the strips move.
 *
 * @param {ReturnType<typeof assembleServices>} assembled
 * @param {{ prometheusOk: boolean, kumaOk: boolean, prometheusError?: unknown, prometheusProblem?: string|null, kumaError?: unknown, beats?: Record<string, object>|null }} outcome
 */
export function servicesCacheEntry(
  assembled,
  { prometheusOk, kumaOk, prometheusError = null, prometheusProblem = null, kumaError = null, beats = null }
) {
  const { nodes, overallHealth, upWithoutCard, monitorOf, kumaStatusOf, kumaWithoutCard, backedBy, monitorPlaced = {}, whyNoUp = {} } = assembled;
  const sources = { prometheus: { ok: prometheusOk }, kuma: { ok: kumaOk } };
  const sourceErrors = {
    prometheus: prometheusOk ? null : failureOrNull(prometheusError),
    kuma: kumaOk ? null : failureOrNull(kumaError),
  };
  return {
    payload: { nodes, overallHealth, sources, ...(beats && { beats }) },
    internal: {
      upWithoutCard,
      monitorOf,
      kumaStatusOf,
      kumaWithoutCard,
      backedBy,
      monitorPlaced,
      whyNoUp,
      sourceErrors,
      prometheusProblem: prometheusOk ? prometheusProblem : null,
    },
  };
}

// What the services refresh asks Prometheus when services.yaml has no nodes:
// there is nothing to read, only whether it answers (#449).
const PROMETHEUS_PROBE = 'vector(1)';

/**
 * The services refresh's cache entry when services.yaml has no nodes (#449):
 * an empty board, with the flag a board with nodes carries
 * (servicesCacheEntry) saying whether Prometheus answered the probe, and why
 * not. So the status model sees a Prometheus that doesn't answer as a failed
 * source: a first run with a wrong PROMETHEUS_URL says "Prometheus
 * unreachable", not that nothing is monitored. Kuma isn't read with no nodes,
 * so it has no flag.
 *
 * While the first boot waits for nodes (firstBoot.js, #566), the answer is
 * its discovery's, not the probe's, and the payload says so with
 * `discovery: 'waiting'`, for Settings → Nodes: the nodes appear as soon as
 * Prometheus has some. Absent otherwise.
 *
 * @param {{ prometheusOk: boolean, prometheusError?: unknown, waiting?: boolean }} outcome
 */
export function noNodesCacheEntry({ prometheusOk, prometheusError = null, waiting = false }) {
  return {
    payload: {
      nodes: {},
      overallHealth: 'unknown',
      sources: { prometheus: { ok: prometheusOk } },
      ...(waiting ? { discovery: 'waiting' } : {}),
    },
    internal: { sourceErrors: { prometheus: prometheusOk ? null : failureOrNull(prometheusError) } },
  };
}

/** A source's failure as the model is handed it: its cause (readFailure), or null for none. */
function failureOrNull(error) {
  return error == null ? null : readFailure(error);
}

/**
 * Where a monitor no running container got goes, down or up (#390): its node
 * and the uid its card has, `{ nodeKey, idPart, uid, remembered }`, or null with
 * no node to attach to. Pass (b) of assembleServices is its only caller, for
 * both statuses, so a monitor's up entry has the uid its red card had while its
 * last container isn't in the stopped list: `owner` is only ever set for a down
 * monitor (when the uid moves, the push snapshot carries the monitor's state
 * to the new one, #395).
 *
 * The node is the one services.yaml's `monitor_nodes` gives the monitor, else
 * that of the stopped container that got the (down) monitor (`owner`), else the
 * monitor's last-seen node, else the one its target host or its name points to
 * (monitorNode.js: one node only), else the first node (#644). `by` says which.
 * A monitor placed on a different node than before (the setting was added, or
 * the rule found one) takes a new uid; the push snapshot carries its state to
 * it by `monitorOf` (#395), so its outage is still one down and one recovery.
 *
 * When the owner is the container the monitor last ran as, the monitor's last-seen node
 * comes first while it is on the board: the container registry keeps one
 * record per name, with the last node in the pass, so when both copies of an
 * unpinned replica stop, the owner's node can be the copy the monitor was not
 * on. The uid reuses the container the monitor was last matched to (the owner,
 * else the service registry's), the uid its running card had, so a down→recovery
 * transition stays on ONE key: the push differ only emits a recovery when
 * 'down' and 'up' share a key. It falls back to the monitor's name for a
 * monitor that never had a container, or when the uid is `taken` (a running
 * container's card, or a monitor placed earlier in the pass), and then to the
 * name and id.
 */
function placeMonitor(m, { nodes, nodeKeys, taken, owner, lastSeenNodeOf, lastSeenContainerOf, where }) {
  const lastNode = lastSeenNodeOf(m.id);
  const lastContainer = lastSeenContainerOf ? lastSeenContainerOf(m.id) : null;
  const ownerIsLast = !!owner && owner.container === lastContainer && !!lastNode && !!nodes[lastNode];
  // The node: services.yaml's `monitor_nodes`, else the owner's or last-seen
  // one, else what the monitor's target host and then its name say, else the
  // first node (#644).
  let nodeKey = where?.setting(m) ?? null;
  let by = nodeKey ? 'setting' : null;
  if (!nodeKey) {
    nodeKey = owner && !ownerIsLast ? owner.lastSeenNode : lastNode;
    if (nodeKey && nodes[nodeKey]) by = owner && !ownerIsLast ? 'owner' : 'last-seen';
  }
  if (!nodeKey || !nodes[nodeKey]) {
    const inferred = where?.inferred(m) ?? null;
    nodeKey = inferred?.nodeKey ?? nodeKeys[0];
    by = inferred ? inferred.by : 'first';
  }
  if (!nodeKey || !nodes[nodeKey]) return null;
  const remembered = owner ? owner.container : lastContainer;
  const free = (part) => !!part && !taken.has(`${nodeKey}:${part}`);
  const idPart = [remembered, m.name].find(free) || `${m.name} (${m.id})`;
  return { nodeKey, idPart, uid: `${nodeKey}:${idPart}`, remembered, by };
}

// Each Kuma monitor's recent beats, for the heartbeat strips (#312):
// in memory, at most BEATS_KEPT per monitor Kuma has (kumaBeats.js).
const beatStore = createBeatStore();

async function _refreshServices() {
  try {
    // While the first boot waits for nodes (#566), discovery asks Prometheus
    // again, and saves services.yaml once it has some: this cycle reads them.
    const asked = await askAgain();
    const config = getConfig();
    if (!config || !config.nodes || Object.keys(config.nodes).length === 0) {
      const outcome =
        asked ??
        (await promQuery(PROMETHEUS_PROBE).then(
          () => ({ prometheusOk: true }),
          (err) => ({ prometheusOk: false, prometheusError: err })
        ));
      reportPrometheus({ ok: outcome.prometheusOk, error: outcome.prometheusError });
      const { payload, internal } = noNodesCacheEntry(outcome);
      setCache('services', payload, internal);
      return payload;
    }

    // Monitors are best-effort; if Kuma is down we still want node data.
    const monitorsSettled = fetchMonitors(true).catch((err) => {
      log.warn({ err }, 'monitors fetch failed');
      return { ok: false, monitors: {} };
    });
    // Every visible node is read in one batch, one query per reading across all
    // of them (#234). Should the batch throw, Kuma's result is still used, no
    // node is in the payload, and Prometheus counts as failed.
    const visibleNodes = Object.entries(config.nodes).filter(([, nodeCfg]) => nodeCfg.visible !== false);
    const promLabelOf = ([nodeKey, nodeCfg]) => nodeCfg.prometheus_node || nodeKey;
    // A problem Prometheus has with a node names it as the board does (#605).
    const nameByLabel = new Map();
    for (const entry of visibleNodes) {
      const label = promLabelOf(entry);
      if (!nameByLabel.has(label)) nameByLabel.set(label, entry[1].display_name || entry[0]);
    }
    const nameOf = (label) => nameByLabel.get(label);
    const nodesSettled = getNodesData(visibleNodes.map(promLabelOf), { nameOf }).then(
      (byLabel) => ({ ok: true, byLabel }),
      (err) => ({ ok: false, err })
    );
    const [kuma, nodesOutcome] = await Promise.all([monitorsSettled, nodesSettled]);
    const monitors = kuma.monitors;
    // Each monitor's heartbeat strip (#312): Kuma's own beats, else this cycle's state.
    beatStore.record({ ok: kuma.ok, monitors, now: Date.now() });

    // Prometheus failed this cycle if any query did: every node's `ok` is then
    // false, with the same `failedReads` naming what the failed queries feed
    // (or only those nodes', for the `up` asked again of a few: discovery.js).
    // A node whose verdict on its missing `up` is Prometheus failing for it
    // (status/upMissing.js: a target unscraped too long, stored nothing, no
    // target for any node, the targets read failed) carries a `problem`
    // instead: Prometheus answered, so only that node is held, while the
    // source's health names the problem (#476, #477).
    // Each failure is kept as its raw detail, for the log, and its cause, for
    // the words the model says it in (#605).
    const nodeResults = [];
    const promErrors = [];
    let prometheusProblem = null;
    let problemDetail = null;
    if (nodesOutcome.ok) {
      for (const entry of visibleNodes) {
        const nodeData = nodesOutcome.byLabel.get(promLabelOf(entry));
        nodeResults.push([entry[0], entry[1], nodeData]);
      }
      const failed = [...nodesOutcome.byLabel.values()].find((nodeData) => nodeData.ok === false);
      if (failed) promErrors.push({ detail: failed.error, failure: failed.failure ?? readFailure(failed.error) });
      const troubled = nodeResults.find(([, , nodeData]) => typeof nodeData?.problem === 'string');
      if (troubled) {
        prometheusProblem = troubled[2].problem;
        problemDetail = troubled[2].problemDetail ?? null;
      }
    } else {
      const msg = failureDetail(nodesOutcome.err);
      log.warn({ err: msg }, 'node refresh failed');
      promErrors.push({ detail: msg, failure: readFailure(nodesOutcome.err) });
    }
    const prometheusOk = promErrors.length === 0;
    const promFailure = promErrors[0] ?? null;
    if (promFailure) {
      reportPrometheus({ ok: false, error: promFailure.detail, words: failureSentence('prometheus', promFailure.failure) });
    } else if (prometheusProblem) {
      reportPrometheus({ ok: false, error: problemDetail ?? prometheusProblem, words: prometheusProblem });
    } else {
      reportPrometheus({ ok: true });
    }
    // A container missing from the list may still be running when a query
    // failed, or on a node Prometheus hasn't scraped yet (#470): no
    // breadcrumbs then. That passes within a scrape or so. A node unread for a
    // reason that lasts (Prometheus failing for it: #476, #477) holds back only
    // its own (assembleServices).
    const presenceKnown = nodesOutcome.ok && nodeResults.every(([, , nodeData]) => {
      if (!nodeData?.failedReads?.length) return true;
      const row = UP_MISSING[nodeData.whyNoUp];
      return !!row && row.unread && !row.passing;
    });

    const assembled = assembleServices({
      nodeResults,
      monitors,
      config,
      lastSeenNodeOf: (id) => serviceRegistry.getLastSeenNode(id),
      lastSeenContainerOf: (id) => serviceRegistry.getLastSeenContainer(id),
      containerRegistry,
      now: Date.now,
      presenceKnown,
    });
    const { seen, unmatched, containerCount } = assembled;

    // Remember where each running, monitored service lives (and which container
    // it maps to) so an outage that later loses its container still lands on its
    // panel AND keeps the same uid for recovery detection.
    for (const { monitorId, nodeKey, container } of seen) serviceRegistry.recordSeen(monitorId, nodeKey, container);
    serviceRegistry.save();
    // containerRegistry was updated in-pass (recordSeen) inside assembleServices;
    // decommission-prune (>TTL) then persist here. prune() is an explicit refresh-loop
    // step (NOT a save() side effect) so persistence never silently deletes by clock.
    containerRegistry.prune();
    containerRegistry.save();

    const { payload: result, internal } = servicesCacheEntry(assembled, {
      prometheusOk,
      kumaOk: kuma.ok,
      prometheusError: promFailure?.failure ?? null,
      prometheusProblem,
      kumaError: kuma.failure ?? kuma.error ?? null,
      beats: beatStore.encodedFor(assembled.monitorOf, { ok: kuma.ok }),
    });
    setCache('services', result, internal);

    logUnmatchedContainers({ unmatched, containerCount, monitors });
    return result;
  } catch (err) {
    log.error({ err }, 'services refresh error');
    return null;
  }
}

/**
 * UPS battery, charge, runtime, load — sourced from NUT via Prometheus: the
 * UPS JAGHELM_UPS_NAME names, or, unset, the one the exporter reports (the
 * first by name, with several; #249).
 */
export async function refreshUPS() {
  return dedupe('ups', _refreshUPS);
}

// The NUT exporter series each UPS payload field reads.
const UPS_METRICS = {
  status: 'nut_status',
  charge: 'nut_battery_charge',
  runtime: 'nut_battery_runtime_seconds',
  load: 'nut_load',
};

// A UPS whose exporter has gone quiet still counts as set up for this long.
const UPS_SEEN_WITHIN = '7d';

/**
 * The UPS readings, plus the exporter's info series as last seen within
 * UPS_SEEN_WITHIN: one query (#234). For the UPS `name` (NUT's name for it,
 * JAGHELM_UPS_NAME, its `ups` label), or with none, for every UPS the
 * exporter reports, of which pickUps takes one (#249).
 * @param {string | null} name
 */
export function upsQuery(name) {
  const ups = name ? `ups=${promString(name)}` : null;
  const readings = `{__name__=~"${Object.values(UPS_METRICS).join('|')}"${ups ? `,${ups}` : ''}}`;
  const info = `nut_ups_info${ups ? `{${ups}}` : ''}`;
  return `${readings} or last_over_time(${info}[${UPS_SEEN_WITHIN}])`;
}

/** A series' UPS: its `ups` label ('' without one: an exporter for one UPS). */
const upsOf = (s) => (typeof s.metric?.ups === 'string' ? s.metric.ups : '');

/**
 * The UPS the panel shows when JAGHELM_UPS_NAME is unset, out of the series
 * of every UPS the exporter reports (#249): the first by name of those with a
 * reading now, else of those seen within UPS_SEEN_WITHIN. Returns its name
 * (null with none), every name found, and its series.
 * @param {Array<{ metric?: Record<string, string> }>} series
 */
export function pickUps(series) {
  const names = [...new Set(series.map(upsOf))].sort();
  const readings = new Set(Object.values(UPS_METRICS));
  const hasReading = (u) => series.some((s) => upsOf(s) === u && readings.has(s.metric?.__name__));
  const name = names.find(hasReading) ?? names[0] ?? null;
  return { name, names, series: series.filter((s) => upsOf(s) === name) };
}

// The UPS choice last logged (pickUps with several UPSes), so it is logged
// once until what NUT reports changes.
let upsChoiceLogged = '';

/** The series of the UPS the panel shows, of an answer to upsQuery(name). */
function upsSeries(series, name) {
  if (name) return series;
  const picked = pickUps(series);
  const choice = picked.names.length > 1 ? `${picked.name} of ${picked.names.join(',')}` : '';
  if (choice !== upsChoiceLogged) {
    upsChoiceLogged = choice;
    if (choice) {
      log.info(
        { ups: picked.name, found: picked.names },
        'NUT reports several UPSes: the UPS panel shows one; set JAGHELM_UPS_NAME to choose'
      );
    }
  }
  return picked.series;
}

/**
 * The payload is `{ status, charge, runtime, load, ok, configured, model }`,
 * read with one query (#234). A value is null when Prometheus has no series for
 * it (no UPS, or its exporter is quiet) or the query failed; `ok` is false when
 * it failed (#232), so the push snapshot keeps the last UPS state instead of
 * reading the failure as "unknown". A Prometheus outage is logged by the
 * services refresh, which queries the same Prometheus every cycle.
 *
 * `configured` says whether this install has a UPS (#272): true when a reading
 * is there now or the exporter's info series was seen within UPS_SEEN_WITHIN,
 * false when neither, null when the query failed (not known). The dashboard
 * shows the UPS panel by it. `model` is the UPS's description or model from
 * that info series, or null. Nothing else from its labels is sent: they also
 * carry the exporter's address, the driver and USB ids.
 */
async function _refreshUPS() {
  try {
    const name = envValue('JAGHELM_UPS_NAME').trim() || null;
    let series = null;
    try {
      series = upsSeries(await promQuery(upsQuery(name)), name);
    } catch (err) {
      // A refused PROMETHEUS_URL (#419) was warned once at boot.
      if (!promUrlProblem()) log.debug({ err }, 'UPS read failed');
    }

    const results = {};
    for (const [k, name] of Object.entries(UPS_METRICS)) {
      const raw = series?.find((r) => r.metric?.__name__ === name)?.value?.[1];
      let val = raw != null ? parseFloat(raw) : null;
      if (val !== null && (k === 'charge' || k === 'load')) val = val * 100;
      results[k] = val;
    }
    // Found by its labels, not its name: older Prometheus versions drop the
    // name in last_over_time.
    const info = series?.find((r) => r.metric?.description || r.metric?.model)?.metric;
    results.ok = series !== null;
    results.configured =
      series === null ? null : Object.keys(UPS_METRICS).some((k) => results[k] !== null) || Boolean(info);
    results.model = info?.description || info?.model || null;
    setCache('ups', results);
    return results;
  } catch (err) {
    log.error({ err }, 'UPS refresh error');
    return null;
  }
}

/** Aggregate data from every configured integration (presets + custom). */
export async function refreshIntegrations() {
  return dedupe('integrations', _refreshIntegrations);
}

// Which integrations are due this cycle (#239): a failing one backs off, and a
// login refused twice waits for its config to change. See integrations/backoff.js.
const integrationBackoff = createIntegrationBackoff({ logger: log });

/**
 * Attempt the integration stored under `key` in the next refresh, whatever its
 * backoff, as a changed config would. The Settings save calls it, so saving an
 * integration, changed or not, is the way to say "try again", and so does
 * enabling it from its row in Settings. A call while the integration's fetch
 * is in flight holds for the refresh after it.
 */
export function retryIntegrationNow(key) {
  integrationBackoff.retryNow(key, performance.now());
}

/**
 * The /api/integrations payload: one entry per enabled integration, in config
 * order. An entry is the integration's fields plus `_`-prefixed internals:
 * `_error` when the fetch failed (with no fields), and `_failure`, its cause
 * when it threw (failureWords.js, #605), `_vms` / `_storagePools` /
 * `_lastBackup` (Proxmox), `_target`, `_instance` and `_preset` (on a failed
 * fetch too), and `_status`, its backoff state (integrations/backoff.js).
 *
 * Only the integrations that are due are fetched, through at most CONCURRENCY
 * at a time. One that is backing off or whose login was refused is not queued
 * at all, so it holds no slot and spends no timeout: its entry is the one its
 * last attempt left, served again. Each integration's config is resolved once a
 * cycle, for its fingerprint, and the fetch reuses it.
 */
// The retired-preset integrations already warned about, so the log says it once.
const warnedRetired = new Set();

async function _refreshIntegrations() {
  try {
    const config = getConfig();
    const integrations = config?.integrations || {};
    // The cycle's start times every attempt in it, so the next cycle, one
    // interval later, is the one an attempt due after that interval falls in.
    // The payload shows wall-clock times; whether an attempt is due is worked
    // out on the monotonic clock, which a clock step doesn't move.
    const at = { wall: Date.now(), mono: performance.now() };

    const byKey = {};
    const entries = Object.entries(integrations).filter(([key, cfg]) => {
      if (cfg.enabled === false) return false;
      // A saved integration of a removed preset (Nextcloud) is skipped, not
      // fetched: it would only fail as "not configured". Settings lists it so
      // it can be deleted.
      if (isRetiredEntry(key, cfg)) {
        if (!warnedRetired.has(key)) {
          warnedRetired.add(key);
          log.warn({ key, preset: integrationInput(key, cfg).type }, 'Skipping a saved integration whose preset was removed; delete it in Settings');
        }
        return false;
      }
      return true;
    });
    integrationBackoff.retain(entries.map(([key]) => key));

    const due = [];
    for (const [key, cfg] of entries) {
      // As the connection test builds it too (#427).
      const { type: handlerType, yamlConfig } = integrationInput(key, cfg);
      // Left undefined when resolving throws: the fetch then resolves the config
      // itself and reports what is wrong with it.
      let resolved;
      let fingerprint = null;
      try {
        const r = resolveIntegrationConfig(handlerType, yamlConfig);
        fingerprint = configFingerprint(yamlConfig, r);
        resolved = r;
      } catch {
        // left for the fetch to report
      }
      const held = integrationBackoff.held(key, fingerprint, at);
      if (held) byKey[key] = held;
      else due.push({ key, cfg, handlerType, yamlConfig, resolved, fingerprint });
    }

    const fetchOne = async ({ key, cfg, handlerType, yamlConfig, resolved, fingerprint }) => {
      let entry;
      let authRejected = false;
      try {
        const result = await fetchIntegration(handlerType, yamlConfig, resolved);
        entry = { ...(result.fields || {}) };
        // Surface fetch/auth failures instead of dropping them — otherwise a
        // down integration renders as silent zeros, not an error state.
        if (result.error) entry._error = result.error;
        // Its cause, which the status model says in words (#605).
        if (result.failure) entry._failure = result.failure;
        if (result.vms) entry._vms = result.vms;
        if (result.storagePools) entry._storagePools = result.storagePools;
        if (result.lastBackup) entry._lastBackup = result.lastBackup;
        authRejected = !!result.authRejected;
      } catch (err) {
        entry = { _error: String((err && err.message) || err), _failure: readFailure(err) };
      }
      // Stamped on a fetch that threw too, so a failed read is still known for
      // what it is and where: the status model holds a Proxmox node's pools
      // through one, and reads a node with no Proxmox entry as having none
      // set up (#468).
      if (cfg.target) entry._target = cfg.target;
      if (cfg.instance) entry._instance = cfg.instance;
      // Stamp the preset identity so the client can detect integration type
      // directly (e.g. proxmox child panels) rather than sniffing output fields.
      entry._preset = handlerType;
      byKey[key] = integrationBackoff.record(key, fingerprint, entry, { authRejected }, at);
    };

    // Bounded fan-out: a fully-wired board can have 30-50+ integrations; firing them
    // all at once opened that many concurrent sockets every refresh cycle. Cap the
    // peak (no head-of-line blocking — runners pull from a shared queue).
    const CONCURRENCY = 6;
    const queue = [...due];
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        while (queue.length) await fetchOne(queue.shift());
      })
    );
    // Config order, not the order the fetches finished in, so an unchanged
    // payload serializes the same and keeps its ETag.
    const results = Object.fromEntries(entries.map(([key]) => [key, byKey[key]]));
    setCache('integrations', results);
    return results;
  } catch (err) {
    log.error({ err }, 'integrations refresh error');
    return null;
  }
}

// ── Background loop ──────────────────────────────────────────────────────

// A cycle this slow logs at info: half the shortest interval allowed
// (MIN_INTERVAL_SECONDS), so it fires before a cycle can overrun any cadence.
// A healthy cycle takes well under a second, so this catches only outliers.
const SLOW_CYCLE_MS = (MIN_INTERVAL_SECONDS * 1000) / 2;

// The refreshes one background cycle runs, each with the name it goes by in the
// cycle's error set. One list, so a name can't drift from its function.
export const CYCLE_REFRESHES = [
  ['services', refreshServices],
  ['ups', refreshUPS],
  ['gitea', refreshGitea],
  ['integrations', refreshIntegrations],
];

/**
 * Run the refreshes in parallel and return the cycle's error set: the name of
 * every refresh that failed (each returns null after logging its own error) and
 * `integration:<key>` for every integration that came back with an `_error`.
 * Keys only, not messages, so an error whose text varies doesn't read as a
 * change. Sorted.
 */
export async function runCycleRefreshes(refreshes = CYCLE_REFRESHES) {
  const settled = await Promise.allSettled(refreshes.map(([, fn]) => fn()));
  const errors = [];
  settled.forEach((r, i) => {
    const name = refreshes[i][0];
    if (r.status === 'rejected' || r.value == null) {
      errors.push(name);
      return;
    }
    if (name === 'integrations') {
      for (const [key, entry] of Object.entries(r.value)) {
        if (entry && entry._error) errors.push(`integration:${key}`);
      }
    }
  });
  return errors.sort();
}

/**
 * Logs one line per background cycle, at debug in steady state. At info only
 * when the cycle was slow (`slow: true`), or when its error set differs from the
 * previous cycle's (`added` / `cleared`): a new failure, or a recovery when the
 * set empties. A failure that persists stays quiet here; its own refresh
 * function keeps logging it.
 */
export function createCycleReporter(logger = log) {
  let prevErrors = [];
  return function reportCycle({ ms, errors }) {
    const current = [...new Set(errors)].sort();
    const added = current.filter((e) => !prevErrors.includes(e));
    const cleared = prevErrors.filter((e) => !current.includes(e));
    prevErrors = current;
    const slow = ms >= SLOW_CYCLE_MS;
    const changed = added.length > 0 || cleared.length > 0;
    const fields = { ms, errors: current };
    if (slow) fields.slow = true;
    if (changed) Object.assign(fields, { added, cleared });
    (slow || changed ? logger.info : logger.debug)(fields, 'background cycle complete');
  };
}

const reportCycle = createCycleReporter();

async function runBackgroundRefresh() {
  // Follow a hand edit of the interval in display-config.json from this tick on.
  const intervalMs = getRefreshIntervalMs();
  if (bgRefreshTimer && intervalMs !== bgRefreshIntervalMs) {
    scheduleBackgroundRefresh(intervalMs);
    log.info({ intervalSec: intervalMs / 1000 }, 'background loop restarted (refresh interval changed)');
  }
  // The grid goes on whether or not this tick runs a cycle.
  nextCycleAt = mono() + (bgRefreshIntervalMs ?? intervalMs);
  await runCycle();
}

/**
 * One cycle: the refreshes, then the status model and push. It does not touch
 * the grid (`nextCycleAt`, the timer), so the phase-lock hint stays true.
 * Returns false, doing nothing, when a cycle is already running.
 */
async function runCycle() {
  if (bgRefreshRunning) return false; // Skip if previous cycle hasn't finished
  bgRefreshRunning = true;
  const start = Date.now();
  cycleStartedAt = mono();
  let ok = true;
  try {
    const errors = await runCycleRefreshes();
    reportCycle({ ms: Date.now() - start, errors });

    // The status model, once a cycle (what /api/status serves), then the push
    // cycle on it: diff this cycle's state vs the last and queue what changed
    // for the subscribed browsers; the sender sends it, and the loop never waits on
    // the push service (#579). It can NEVER reject (see runStatusAndPush), so a model or
    // push failure cannot flip `ok` or break the loop. No-ops when push is disabled.
    await runStatusAndPush(errors);
  } catch (err) {
    ok = false;
    log.error({ err }, 'background cycle error');
  } finally {
    bgRefreshRunning = false;
    lastRefreshComplete = Date.now();
    lastCycleMs = Math.round(mono() - cycleStartedAt);
    recordRefreshCycle(Date.now() - start, ok);
  }
  return true;
}

// The refreshNow run waiting for the cycle in flight to finish, which callers
// arriving meanwhile share (it starts after all of their changes).
let queuedNow = null;

/**
 * Runs a cycle now (#688: a missing container was just forgotten and the board
 * should say so at once), and resolves true when it is done. A cycle already
 * running began before the change, so it is waited out (up to `waitMs`) and a
 * fresh one run after it; callers arriving while that one waits share it.
 * Resolves false if the running cycle did not finish in time (the change is
 * then on the board a cycle later, as the loop would have it).
 *
 * It leaves the grid alone (the next scheduled cycle stays where it was, so
 * clients' X-Next-Refresh-Ms stays true). What it does count: it is a whole
 * cycle to the status model and push, so a rule that waits for N cycles in a
 * row (a pending monitor, CPU over its line, push's debounce) gets one more
 * cycle of its N, sooner than the grid alone would give it.
 */
export function refreshNow({ waitMs = 15_000 } = {}) {
  if (queuedNow) return queuedNow;
  const mine = {};
  mine.promise = (async () => {
    await null; // `queuedNow` is set by the time this goes on
    const until = mono() + waitMs;
    while (bgRefreshRunning) {
      if (mono() >= until) {
        if (queuedNow === mine.promise) queuedNow = null;
        return false;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    // From here a caller needs a cycle that starts after its own change.
    if (queuedNow === mine.promise) queuedNow = null;
    return runCycle();
  })();
  queuedNow = mine.promise;
  return mine.promise;
}

/**
 * Liveness of the background refresh loop, for /api/health (which the Docker
 * HEALTHCHECK + deploy verify gate trust). 'starting' before the first cycle,
 * 'stale' once the loop has missed ~3 expected cycles (wedged), else 'ok'.
 */
export function getRefreshHealth() {
  if (lastRefreshComplete === 0) return { state: 'starting', ageMs: null };
  const ageMs = Date.now() - lastRefreshComplete;
  // The interval the timer runs at: a hand edit is in the file before the
  // timer's next tick picks it up.
  const intervalMs = bgRefreshIntervalMs ?? getRefreshIntervalMs();
  const state = ageMs > Math.max(3 * intervalMs, 90_000) ? 'stale' : 'ok';
  return { state, ageMs };
}

function scheduleBackgroundRefresh(intervalMs) {
  if (bgRefreshTimer) clearInterval(bgRefreshTimer);
  bgRefreshTimer = setInterval(runBackgroundRefresh, intervalMs);
  bgRefreshIntervalMs = intervalMs;
  nextCycleAt = mono() + intervalMs;
}

export function startBackgroundRefresh() {
  const intervalMs = getRefreshIntervalMs();
  scheduleBackgroundRefresh(intervalMs);
  log.info({ intervalSec: intervalMs / 1000 }, 'background loop started');
  // Once per boot, not per cycle: without JAGHELM_GITEA_URL (or GITEA_URL)
  // nothing is polled and the dashboard has no Pipeline panel, which a deploy
  // check can see here.
  if (!giteaConfigured()) log.info('Gitea panel off: JAGHELM_GITEA_URL is not set');
  // Warm the cache immediately so the first dashboard load isn't a cold miss
  runBackgroundRefresh();
}

export function restartBackgroundRefresh() {
  // The cached display config is stale by definition when this is called (the
  // route that triggers a restart just wrote a new value).
  invalidateDisplayConfigCache();
  const intervalMs = getRefreshIntervalMs();
  scheduleBackgroundRefresh(intervalMs);
  log.info({ intervalSec: intervalMs / 1000 }, 'background loop restarted');
}

/**
 * Stop the background loop. Called on shutdown so the timer doesn't fire
 * mid-drain. Also writes what the loop holds in memory ahead of the files: the
 * container registry's refreshed lastSeenAt (up to PRESENCE_FLUSH_MS old on
 * disk) and the push snapshot, if a failed write left its file behind (see
 * createPushSnapshot). The push outbox needs nothing: it is on disk with each
 * change, and a send cut short is sent again after the restart (push/outbox.js).
 */
export function stopBackgroundRefresh() {
  if (bgRefreshTimer) {
    clearInterval(bgRefreshTimer);
    bgRefreshTimer = null;
    bgRefreshIntervalMs = null;
  }
  nextCycleAt = 0;
  containerRegistry.flush();
  pushSnapshot.flush();
}
