/**
 * Arcane wiring: builds the poller and the weekly vulnerability digest from env +
 * their state and starts them. Only boot() calls startArcane(); importing this
 * module starts nothing. Their notices go through the push outbox (#581): `push`
 * is the refresh loop's push snapshot and sender (refresh.js), which hold their
 * state with the outbox and the alert history (arcane/notices.js).
 */
import { readArcaneConfig } from './config.js';
import { createArcaneClient } from './client.js';
import { createArcanePoller } from './poller.js';
import { createVulnDigest } from './vulnDigest.js';
import { setArcaneAgentsSource } from './agents.js';
import { openDigestState, openPollerState } from './notices.js';
import { recordRun } from '../cron-store.js';
import * as fcmModule from '../push/fcm.js';
import { isDemoMode } from '../demo.js';
import { DATA_DIR } from '../util/dataDir.js';
import { createLogger } from '../util/logger.js';

const defaultLog = createLogger('arcane');
// Reading a few dozen pages of findings and Arcane's risk overview can take longer
// than the poller's 8-second reads.
const DIGEST_TIMEOUT_MS = 30_000;
let poller = null;
let digest = null;

/**
 * `env`: the process's environment (env.js) unless a test passes its own.
 * `push`: `{ snapshot, sender }`, the push snapshot and its sender (refresh.js
 * pushSnapshot, pushSender); `isPushEnabled` and `dir` (the data directory,
 * where the state files of a JagHelm before #581 are) only a test replaces.
 */
export function startArcane({
  env,
  demo = isDemoMode(),
  push,
  isPushEnabled = fcmModule.isPushEnabled,
  dir = DATA_DIR,
  deps = {},
} = {}) {
  stopArcane();
  const log = deps.logger || defaultLog;
  const makePoller = deps.createPoller || createArcanePoller;
  const makeDigest = deps.createDigest || createVulnDigest;
  if (demo) {
    log.info('Arcane integration off in demo mode');
    return null;
  }
  const cfg = readArcaneConfig(env, { logger: log });
  if (!cfg.enabled) {
    log.info('Arcane integration off (ARCANE_URL / ARCANE_API_KEY not set)');
    return null;
  }
  if (cfg.cleartext) {
    log.warn('ARCANE_URL is cleartext http://; the API key travels unencrypted');
  }
  const outbox = { snapshot: push.snapshot, sender: push.sender, isPushEnabled, dir, logger: log };
  poller = makePoller({
    client: createArcaneClient({ baseUrl: cfg.url, apiKey: cfg.apiKey }),
    ...openPollerState(outbox),
    recordRun,
    checkOnlyEnvs: cfg.checkOnlyEnvs,
    checkEverySeconds: cfg.checkEverySeconds,
    logger: log,
  });
  // The status model reads the agents from this poller's last environment list.
  const agentsOf = poller;
  setArcaneAgentsSource(() => agentsOf.agents?.() ?? null);
  poller.start({ pollMs: cfg.pollMs, releaseMs: cfg.releaseMs });
  digest = makeDigest({
    client: createArcaneClient({
      baseUrl: cfg.url,
      apiKey: cfg.apiKey,
      timeoutMs: DIGEST_TIMEOUT_MS,
    }),
    ...openDigestState(outbox),
    recordRun,
    logger: log,
    envs: cfg.vulnDigestEnvs,
    day: cfg.vulnDay,
    hour: cfg.vulnHour,
  });
  digest.start();
  return poller;
}

export function stopArcane() {
  setArcaneAgentsSource(null);
  if (poller) poller.stop();
  if (digest) digest.stop();
  poller = null;
  digest = null;
}
