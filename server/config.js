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
  custom_integrations: {},
  display: {
    title: 'JAGHELM',
    subtitle: 'Infrastructure Dashboard',
    theme: 'dark',
    accent_color: '#6366f1',
    bg_image: '',
    bg_opacity: 0.3,
    overlay_opacity: 0.75,
    show_dots: true,
    show_search: true,
    search_engine: 'google',
    show_weather: true,
    weather_lat: '39.88',
    weather_lon: '-83.09',
    weather_city: 'Grove City',
    temp_unit: 'F',
    service_detail_level: 'stats',
    refresh_interval: 30,
    show_todos: true,
    show_cron_jobs: true,
  },
  links: {
    personal: [],
    management: [],
    devops: [],
  },
  tabs: [],
  grid_layout: null,
  grid_columns: 12,
};

/**
 * Load config from disk. If no file exists, returns null (caller should trigger discovery).
 */
export function loadConfig() {
  try {
    if (!existsSync(CONFIG_PATH)) {
      console.log('[config] No services.yaml found — first boot, will auto-discover');
      return null;
    }
    const raw = readFileSync(CONFIG_PATH, 'utf8');
    config = yaml.load(raw) || {};
    lastModified = statSync(CONFIG_PATH).mtimeMs;
    console.log(
      '[config] Loaded services.yaml (%d nodes, %d service overrides)',
      Object.keys(config.nodes || {}).length,
      Object.keys(config.services || {}).length
    );
    // Return a clone too, so all three read paths (loadConfig/getConfig/watcher)
    // honor the same copy-on-read contract — no caller ever holds the canonical ref.
    return getConfig();
  } catch (err) {
    console.error('[config] Failed to load services.yaml:', err.message);
    return null;
  }
}

/**
 * Save config to disk as YAML.
 *
 * Write coordination — why this is synchronous and NOT an async queue:
 *   writeFileSync's whole pipeline (yaml.dump → atomic temp+fsync+rename →
 *   statSync → assign) runs in a single event-loop tick, so concurrent POST
 *   handlers can't interleave and the 5s file watcher (a separate tick) can
 *   never observe a half-applied state. `lastModified` is updated before the
 *   watcher's next poll, so our own write is recognised as self-originated and
 *   not re-read. An async mutation queue would REOPEN the watcher↔write race
 *   (a poll could fire between the rename and the lastModified update) for no
 *   gain — the atomic rename already gives crash-safety, see atomicWrite.js.
 *
 * Reentrancy: a true mutex on a sync function would deadlock, so we fail fast
 * if saveConfig is re-entered from inside its own call stack (e.g. a config
 * listener that saves again) and let the caller surface the bug.
 */
let saveInProgress = false;

export function saveConfig(newConfig) {
  if (saveInProgress) {
    console.error('[config] saveConfig reentered while a save was in progress — refusing');
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
    console.log('[config] Saved services.yaml');
    return true;
  } catch (err) {
    console.error('[config] Failed to save services.yaml:', err.message);
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
 */
export function generateDefaultConfig(discoveredNodes) {
  const cfg = structuredClone(DEFAULT_CONFIG);

  // Map discovered Prometheus nodes to config entries
  const nodeDefaults = {
    pi1: {
      display_name: 'Gateway Primary',
      subtitle: 'Raspberry Pi 5',
      icon: '🛡',
      border_color: '#a78bfa',
    },
    pi2: {
      display_name: 'Gateway Secondary',
      subtitle: 'Raspberry Pi 5',
      icon: '🛡',
      border_color: '#a78bfa',
    },
    vm103: { display_name: 'Production', subtitle: 'VM 103', icon: '🚀', border_color: '#6366f1' },
    vm101: { display_name: 'Staging', subtitle: 'VM 101', icon: '🔬', border_color: '#fbbf24' },
  };

  for (const nodeLabel of discoveredNodes) {
    const defaults = nodeDefaults[nodeLabel] || {
      display_name: nodeLabel,
      subtitle: '',
      icon: '🖥',
      border_color: '#6366f1',
    };
    cfg.nodes[nodeLabel] = {
      prometheus_node: nodeLabel,
      ...defaults,
      visible: true,
      auto_discover: true,
      hide: ['prometheus', 'node-exporter', 'cadvisor'],
    };
  }

  // No hardcoded service defaults — let auto-matching handle naming.
  // Users with multi-instance containers (same container name on multiple nodes)
  // can configure per-node monitor mapping via the Settings UI, which writes
  // `monitor_per_node:` blocks to services.yaml.
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
          console.log('[config] External change detected, reloading services.yaml');
          loadConfig();
          // Hand listeners an isolated copy, consistent with getConfig() — a
          // listener must not be able to mutate shared in-memory state.
          changeListeners.forEach((fn) => fn(getConfig()));
        }, 250);
      }
    } catch (err) {
      console.warn('[config] Watcher error:', err.message);
    }
  }, 5000);
}

/**
 * Register a callback for config changes (from file watcher or API save).
 */
export function onConfigChange(fn) {
  changeListeners.push(fn);
}
