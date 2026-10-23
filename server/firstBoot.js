/**
 * First boot (#566): with no services.yaml, discovery names the nodes
 * Prometheus has, and the default config is saved with them.
 *
 * No file is written until discovery has found a node. A first boot whose
 * discovery fails (Prometheus down, a typo in PROMETHEUS_URL) or finds no
 * node (Prometheus up but not scraped yet, the #470 start order) saves
 * nothing: JagHelm runs on the default config in memory, and the refresh
 * loop asks again each cycle (askAgain, from refresh.js's services refresh,
 * so no timer of its own) until discovery finds a node, then saves the
 * default with those nodes, once. One log line when the wait starts, one
 * when it ends, none per cycle. Before, the boot saved the default with no
 * nodes, the file existed, and discovery never ran again.
 *
 * Any file on disk is the user's. Whatever it holds, a file that is there
 * ends the wait and is never discovered over: one saved in Settings
 * meanwhile, one put there by hand, one that doesn't parse or can't be read.
 * The default is written only where there is no file (writeConfig over
 * CONFIG_ABSENT, which creates the file atomically only if none is there),
 * so a file that lands while discovery asks always stands. The wait is the
 * first boot's alone: a file deleted later is not discovered again (as
 * before, the next save writes it).
 *
 * A refused PROMETHEUS_URL (#419) can't be asked until it is fixed, which
 * takes a restart: the boot says so once and does not wait, so neither
 * /api/health nor Settings says discovery is under way.
 */

import {
  CONFIG_ABSENT,
  configHealth,
  generateDefaultConfig,
  getConfig,
  readConfig,
  useUnsavedConfig,
  writeConfig,
} from './config.js';
import { discoverNodes, promUrlProblem } from './discovery.js';
import { createLogger } from './util/logger.js';

const log = createLogger('config');

// True from a first boot whose discovery found no node until discovery saves
// its nodes or a file is there.
let waiting = false;

/** Why a discovery that rejected failed, in its own words. */
const reasonOf = (err) => err?.message || String(err);

/**
 * Save the default config with `nodes`, only where there is no file, and say
 * so once (`found` begins the line). A file that got there first stands and
 * is loaded now. A write that fails (writeConfig logged why: a services.yaml
 * that is a symlink to nothing, an unwritable data dir) leaves JagHelm on the
 * nodes in memory, and the next save writes the file. Either way there is a
 * config in memory after it, so the boot never runs on none.
 */
function saveDiscovered(nodes, found) {
  const cfg = generateDefaultConfig(nodes);
  const saved = writeConfig(cfg, CONFIG_ABSENT);
  if (saved.ok) {
    log.info({ nodes }, `${found}, saved services.yaml with them`);
  } else if (saved.conflict) {
    readConfig();
    if (!getConfig()) useUnsavedConfig(cfg); // gone again before the read
    log.info(`${found}, but services.yaml was written meanwhile; it stays as it is`);
  } else {
    useUnsavedConfig(cfg);
    log.warn({ nodes }, `${found}; running on them, services.yaml not saved (the next save writes it)`);
  }
}

/**
 * At boot, when loadConfig() found no services.yaml: discover the nodes and
 * save the default config with them, or, when there are none yet, start
 * waiting for them on the default config in memory. Returns the config.
 */
export async function firstBoot() {
  waiting = false;
  const problem = promUrlProblem();
  if (problem) {
    // The boot warned the URL once (sourceUrls.js); this says what it means here.
    useUnsavedConfig(generateDefaultConfig([]));
    log.warn(
      'first boot: PROMETHEUS_URL is refused, so no node discovery and nothing saved; fix it and restart'
    );
    return getConfig();
  }
  log.info('first boot — running node discovery');
  let nodes = [];
  let failure = null;
  try {
    nodes = await discoverNodes();
  } catch (err) {
    failure = err;
  }
  if (nodes.length > 0) {
    saveDiscovered(nodes, 'first boot: discovered nodes');
    return getConfig();
  }
  useUnsavedConfig(generateDefaultConfig([]));
  waiting = true;
  if (failure) {
    log.warn(
      { err: reasonOf(failure) },
      'first boot: node discovery could not reach Prometheus; nothing saved, asking again each refresh until it has nodes'
    );
  } else {
    log.info('first boot: Prometheus has no nodes yet; nothing saved, asking again each refresh until it has some');
  }
  return getConfig();
}

/**
 * Whether the first boot still waits for nodes: false once a file is there
 * (read now, so a save in Settings or a file put there by hand ends it at
 * once), and for good.
 */
export function waitingForNodes() {
  if (waiting && readConfig().version !== CONFIG_ABSENT) {
    waiting = false;
    log.info('first boot: services.yaml was written meanwhile, so discovery stops; it stays as it is');
  }
  return waiting;
}

/**
 * Once a refresh cycle, from the services refresh: while the first boot
 * waits, ask Prometheus for nodes again, and save the default config with
 * them once there are some. Returns null when not waiting, else what the
 * services refresh would have probed, `{ prometheusOk, prometheusError? }`
 * (whether Prometheus answered, and why not), and `waiting`, whether it
 * still waits. Logs only when the wait ends (the services refresh logs
 * Prometheus failing and recovering, once each).
 * @returns {Promise<{ prometheusOk: boolean, prometheusError?: string, waiting: boolean } | null>}
 */
export async function askAgain() {
  if (!waitingForNodes()) return null;
  let nodes;
  try {
    nodes = await discoverNodes();
  } catch (err) {
    return { prometheusOk: false, prometheusError: reasonOf(err), waiting: waitingForNodes() };
  }
  // A file may have got there while discovery asked: it stands.
  if (nodes.length > 0 && waitingForNodes()) {
    waiting = false;
    saveDiscovered(nodes, 'first boot: Prometheus has nodes now');
  }
  return { prometheusOk: true, waiting: waitingForNodes() };
}

/**
 * services.yaml's state for /api/health: configHealth() (config.js, #505,
 * #536), or `{ state: 'discovering' }` while the first boot waits for nodes
 * with no file yet. Never a down config source: there is nothing wrong with
 * a file that isn't there yet.
 */
export function configHealthNow() {
  const health = configHealth();
  return health.state === 'ok' && waitingForNodes() ? { state: 'discovering' } : health;
}
