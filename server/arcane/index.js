/**
 * Arcane wiring: builds the poller from env + stores and starts it.
 * Only boot() calls startArcane(); importing this module starts nothing.
 */
import { join } from 'path';
import { readArcaneConfig } from './config.js';
import { createArcaneClient } from './client.js';
import { createArcaneStateStore } from './stateStore.js';
import { createArcanePoller } from './poller.js';
import { createHeldBackStore } from '../watchtower/heldBackStore.js';
import { recordRun } from '../cron-store.js';
import { dispatchEvents } from '../push/dispatch.js';
import { getPushStore } from '../push/store.js';
import * as fcmModule from '../push/fcm.js';
import { isDemoMode } from '../demo.js';
import { DATA_DIR } from '../util/dataDir.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('arcane');
let poller = null;

export function startArcane({ env = process.env, demo = isDemoMode() } = {}) {
  stopArcane();
  if (demo) {
    log.info('Arcane integration off in demo mode');
    return null;
  }
  const cfg = readArcaneConfig(env);
  if (!cfg.enabled) {
    log.info('Arcane integration off (ARCANE_URL / ARCANE_API_KEY not set)');
    return null;
  }
  if (cfg.cleartext) {
    log.warn('ARCANE_URL is cleartext http://; the API key travels unencrypted');
  }
  poller = createArcanePoller({
    client: createArcaneClient({ baseUrl: cfg.url, apiKey: cfg.apiKey }),
    stateStore: createArcaneStateStore({ path: join(DATA_DIR, 'arcane-state.json') }),
    heldBackStore: createHeldBackStore({ path: join(DATA_DIR, 'arcane-held-back.json') }),
    recordRun,
    dispatch: dispatchEvents,
    pushStore: getPushStore(),
    fcm: fcmModule,
    checkOnlyEnvs: cfg.checkOnlyEnvs,
    logger: log,
  });
  poller.start({ pollMs: cfg.pollMs, releaseMs: cfg.releaseMs });
  return poller;
}

export function stopArcane() {
  if (poller) poller.stop();
  poller = null;
}
