/**
 * Arcane wiring: builds the poller and the weekly vulnerability digest from env +
 * stores and starts them. Only boot() calls startArcane(); importing this module
 * starts nothing.
 */
import { join } from 'path';
import { readArcaneConfig } from './config.js';
import { createArcaneClient } from './client.js';
import { createArcaneStateStore } from './stateStore.js';
import { createArcanePoller } from './poller.js';
import { createVulnStateStore } from './vulnStateStore.js';
import { createVulnDigest } from './vulnDigest.js';
import { createHeldBackStore } from '../watchtower/heldBackStore.js';
import { recordRun } from '../cron-store.js';
import { dispatchEvents } from '../push/dispatch.js';
import { getPushStore } from '../push/store.js';
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

export function startArcane({ env = process.env, demo = isDemoMode(), deps = {} } = {}) {
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
  poller = makePoller({
    client: createArcaneClient({ baseUrl: cfg.url, apiKey: cfg.apiKey }),
    stateStore: createArcaneStateStore({ path: join(DATA_DIR, 'arcane-state.json') }),
    heldBackStore: createHeldBackStore({ path: join(DATA_DIR, 'arcane-held-back.json') }),
    recordRun,
    dispatch: dispatchEvents,
    pushStore: getPushStore(),
    fcm: fcmModule,
    checkOnlyEnvs: cfg.checkOnlyEnvs,
    checkEverySeconds: cfg.checkEverySeconds,
    logger: log,
  });
  poller.start({ pollMs: cfg.pollMs, releaseMs: cfg.releaseMs });
  digest = makeDigest({
    client: createArcaneClient({
      baseUrl: cfg.url,
      apiKey: cfg.apiKey,
      timeoutMs: DIGEST_TIMEOUT_MS,
    }),
    stateStore: createVulnStateStore({ path: join(DATA_DIR, 'arcane-vuln-state.json') }),
    recordRun,
    dispatch: dispatchEvents,
    pushStore: getPushStore(),
    fcm: fcmModule,
    logger: log,
    day: cfg.vulnDay,
    hour: cfg.vulnHour,
  });
  digest.start();
  return poller;
}

export function stopArcane() {
  if (poller) poller.stop();
  if (digest) digest.stop();
  poller = null;
  digest = null;
}
