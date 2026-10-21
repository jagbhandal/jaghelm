/**
 * JagHelm Config Manager
 * Loads/saves/watches data/services.yaml with hot-reload on file change.
 * Generates a default config from discovery results on first boot.
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

import { atomicWriteFileSync } from './util/atomicWrite.js';
import { DATA_DIR } from './util/dataDir.js';
import { createLogger } from './util/logger.js';

const log = createLogger('config');

const CONFIG_PATH = join(DATA_DIR, 'services.yaml');

// In-memory config state
let config = null;
let lastModified = 0;
let changeListeners = [];

// ── Default config (generated on first boot) ──
const DEFAULT_CONFIG = {
  nodes: {},
  services: {},
  integrations: {},
};

// Keys that older releases wrote into every generated services.yaml but that
// nothing ever read from it: display settings, links, tabs and the grid live in
// display-config.json, and custom integrations are entries under `integrations`.
// A file that still has them loads and saves unchanged (they are ignored, not
// stripped, so the server never silently drops what a user wrote); loadConfig
// warns once per key, on the first load that sees it, that it can be deleted.
// Remove the warning one release after it ships (#350).
const UNREAD_KEYS = [
  'display',
  'custom_integrations',
  'links',
  'tabs',
  'grid_layout',
  'grid_columns',
];
const warnedUnreadKeys = new Set();

function warnUnreadKeys(cfg) {
  const keys = UNREAD_KEYS.filter((k) => Object.hasOwn(cfg, k) && !warnedUnreadKeys.has(k));
  if (keys.length === 0) return;
  for (const k of keys) warnedUnreadKeys.add(k);
  log.warn(
    { keys },
    `services.yaml has keys JagHelm does not read (${keys.join(', ')}); they are ignored and can be deleted`
  );
}

/**
 * Load config from disk. Returns null only when no file exists (the caller runs
 * discovery and saves a new one); every other outcome returns a config.
 *
 * A file that can't be used (unparseable, empty, comments only, or not a
 * mapping) is a failed read, not an empty board (#463): an editor's
 * truncate-then-write would otherwise drop every host and service for one
 * cycle and re-page every open problem on the next. The previous config stays
 * until the file changes again. With no previous config (at boot) the board
 * starts empty, and the file is never overwritten by discovery.
 */
export function loadConfig() {
  try {
    if (!existsSync(CONFIG_PATH)) {
      log.info('No services.yaml found — first boot, will auto-discover');
      return null;
    }
    const raw = readFileSync(CONFIG_PATH, 'utf8');
    const parsed = yaml.load(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return keepAfterFailedRead('services.yaml is empty or not a mapping');
    }
    config = parsed;
    lastModified = statSync(CONFIG_PATH).mtimeMs;
    warnUnreadKeys(config);
    log.info(
      {
        nodes: Object.keys(config.nodes || {}).length,
        serviceOverrides: Object.keys(config.services || {}).length,
      },
      'Loaded services.yaml'
    );
    // Return a clone too, so all three read paths (loadConfig/getConfig/watcher)
    // honor the same copy-on-read contract — no caller ever holds the canonical ref.
    return getConfig();
  } catch (err) {
    return keepAfterFailedRead('Failed to load services.yaml', err);
  }
}

/**
 * A read that produced no usable config (#463): keep the previous one, or
 * start from an empty one when there is none, without touching the file.
 * `yaml.load` returns undefined for an empty or comments-only document.
 */
function keepAfterFailedRead(msg, err) {
  if (config) {
    log.warn({ err }, `${msg}; keeping the previous config until the file changes again`);
  } else {
    config = {};
    log.error({ err }, `${msg}; starting with an empty board and not overwriting the file`);
  }
  return getConfig();
}

/**
 * Save config to disk as YAML.
 *
 * Synchronous on purpose, NOT an async queue: the whole pipeline (dump → atomic
 * write → statSync → assign lastModified) runs in one event-loop tick, so the 5s
 * watcher (a separate tick) can never observe a half-applied state and always
 * sees our own write as self-originated. An async queue would reopen that
 * watcher↔write race for no gain — the atomic rename already gives crash-safety.
 *
 * Reentrancy: a real mutex on a sync function would deadlock, so we fail fast if
 * saveConfig is re-entered from its own call stack (e.g. a listener that saves).
 */
let saveInProgress = false;

export function saveConfig(newConfig) {
  if (saveInProgress) {
    log.error('saveConfig reentered while a save was in progress — refusing');
    return false;
  }
  saveInProgress = true;
  try {
    const yamlStr = yaml.dump(newConfig, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
    });
    const header =
      '# JagHelm Configuration\n# This file is managed by the dashboard. Edit here or in Settings UI — both are equivalent.\n\n';
    // Atomic write: temp file → fsync → rename. A reader can never observe a
    // half-written services.yaml, even if the process crashes mid-write.
    atomicWriteFileSync(CONFIG_PATH, header + yamlStr);
    // Defensive deep copy: a caller that retains and later mutates `newConfig`
    // must not be able to reach into our canonical in-memory state.
    config = structuredClone(newConfig);
    lastModified = statSync(CONFIG_PATH).mtimeMs;
    log.info('Saved services.yaml');
    return true;
  } catch (err) {
    log.error({ err }, 'Failed to save services.yaml');
    return false;
  } finally {
    saveInProgress = false;
  }
}

/**
 * Get the current config as an isolated deep copy (copy-on-read).
 *
 * Returning the live object let routes mutate shared state in place
 * (`config.integrations[x] = …`, or fetchIntegration writing a resolved
 * `_token` onto it) — which diverges memory from disk on a failed save and can
 * leak credentials into the shared object. Handing back a structuredClone makes
 * every consumer's mutations land on a throwaway copy instead. The config is a
 * few KB and this is called per-request (not in a hot loop), so the cost is
 * negligible. Mutating routes simply mutate the copy and pass it to saveConfig.
 */
export function getConfig() {
  return config ? structuredClone(config) : config;
}

/**
 * Merge discovery results into a default config for first boot.
 * Called when no services.yaml exists.
 *
 * Each discovered node is named by its own Prometheus label: no label maps to a
 * built-in name, so a fresh install never shows someone else's node names
 * (#248). A node's `display_name` in services.yaml renames it.
 */
export function generateDefaultConfig(discoveredNodes) {
  const cfg = structuredClone(DEFAULT_CONFIG);

  for (const nodeLabel of discoveredNodes) {
    cfg.nodes[nodeLabel] = {
      prometheus_node: nodeLabel,
      display_name: nodeLabel,
      subtitle: '',
      icon: '🖥',
      border_color: '#6366f1',
      visible: true,
      auto_discover: true,
      hide: ['prometheus', 'node-exporter', 'cadvisor'],
    };
  }

  // No hardcoded service defaults — let auto-matching handle naming.
  // A container name that runs on several nodes (a replica) can be mapped to a
  // different Kuma monitor on each with a `monitor_per_node:` block in
  // services.yaml, keyed by the node keys above, and `monitor: false` opts a
  // container out of monitors (monitors.js mappingOf, #240). Both are written
  // by hand: the Settings UI edits `monitor` only, and keeps the rest of an
  // entry when it saves.
  cfg.services = {};

  return cfg;
}

/**
 * Watch for external file changes (5s poll).
 * If the file is modified outside the app, reload it.
 *
 * Reloads are debounced 250ms so a burst of writes (or an atomic write that
 * happens to land during a poll) doesn't read the file mid-mutation. With
 * atomic writes (temp → rename) this is mostly defence in depth, but it also
 * coalesces rapid edits from an external YAML editor.
 */
let reloadDebounceTimer = null;

export function startConfigWatcher() {
  setInterval(() => {
    try {
      if (!existsSync(CONFIG_PATH)) return;
      const mtime = statSync(CONFIG_PATH).mtimeMs;
      if (mtime > lastModified) {
        // Record the attempt up front so a persistently-corrupt services.yaml
        // (which loadConfig leaves lastModified unchanged on) isn't re-parsed,
        // re-failed, and re-logged every single 5s tick.
        lastModified = mtime;
        if (reloadDebounceTimer) clearTimeout(reloadDebounceTimer);
        reloadDebounceTimer = setTimeout(() => {
          reloadDebounceTimer = null;
          log.info('External change detected, reloading services.yaml');
          loadConfig();
          // Hand listeners an isolated copy, consistent with getConfig() — a
          // listener must not be able to mutate shared in-memory state.
          changeListeners.forEach((fn) => fn(getConfig()));
        }, 250);
      }
    } catch (err) {
      log.warn({ err }, 'Watcher error');
    }
  }, 5000);
}

/**
 * Register a callback for config changes (from file watcher or API save).
 */
export function onConfigChange(fn) {
  changeListeners.push(fn);
}
