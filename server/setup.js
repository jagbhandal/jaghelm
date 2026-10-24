/**
 * The guided first run's state (#322, spec §8): whether this install still
 * has its setup to go through.
 *
 * A first boot, one that finds no services.yaml (firstBoot.js), leaves a
 * marker file in the data dir, `setup-pending`. The web app shows the guided
 * setup while it is there; Finish or Skip (POST /api/setup/done) removes it,
 * for every device at once, and it survives a restart. An install that
 * already had a services.yaml never gets one, so an upgrade shows no setup.
 * A services.yaml deleted later brings the first boot, and the setup, back.
 */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { createExclusiveFileSync } from './util/atomicWrite.js';
import { DATA_DIR } from './util/dataDir.js';
import { createLogger } from './util/logger.js';

const log = createLogger('setup');

const markerPath = () => join(DATA_DIR, 'setup-pending');

/** Whether the guided setup is still to do. */
export const setupPending = () => existsSync(markerPath());

/**
 * The first boot's mark. A failure to write it (a read-only data dir) is
 * logged and ignored: the install then simply has no guided setup.
 */
export function markSetupPending() {
  try {
    if (createExclusiveFileSync(markerPath(), Buffer.from('first boot\n'))) {
      log.info('first boot: the guided setup is waiting in the web app');
    }
  } catch (err) {
    log.warn({ err: err?.message }, 'could not note the guided setup; the web app will not offer it');
  }
}

/** Setup is done (finished or skipped). Returns whether the marker was cleared. */
export function finishSetup() {
  try {
    rmSync(markerPath(), { force: true });
    return true;
  } catch (err) {
    log.warn({ err: err?.message }, 'could not clear the guided setup marker');
    return false;
  }
}
