/**
 * JagHelm Config Manager
 * Loads/saves/watches data/services.yaml with hot-reload on file change.
 * Generates a default config from discovery results on first boot.
 */

import { readFileSync, writeFileSync, existsSync, watchFile, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
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
    console.log('[config] Loaded services.yaml (%d nodes, %d service overrides)',
      Object.keys(config.nodes || {}).length,
      Object.keys(config.services || {}).length);
    return config;
  } catch (err) {
    console.error('[config] Failed to load services.yaml:', err.message);
    return null;
  }
}

/**
 * Save config to disk as YAML.
 */
export function saveConfig(newConfig) {
  try {
    config = newConfig;
    const yamlStr = yaml.dump(newConfig, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
    });
    const header = '# JagHelm Configuration\n# This file is managed by the dashboard. Edit here or in Settings UI — both are equivalent.\n\n';
    writeFileSync(CONFIG_PATH, header + yamlStr, 'utf8');
    lastModified = statSync(CONFIG_PATH).mtimeMs;
    console.log('[config] Saved services.yaml');
    return true;
  } catch (err) {
    console.error('[config] Failed to save services.yaml:', err.message);
    return false;
  }
}

/**
 * Get the current in-memory config (read-only).
 */
export function getConfig() {
  return config;
}

/**
 * Merge discovery results into a default config for first boot.
 * Called when no services.yaml exists.
 */
export function generateDefaultConfig(discoveredNodes) {
  const cfg = structuredClone(DEFAULT_CONFIG);
  
  // Map discovered Prometheus nodes to config entries
  const nodeDefaults = {
    pi: { display_name: 'Gateway Services', subtitle: 'Raspberry Pi 5', icon: '🛡', border_color: '#a78bfa' },
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

  return cfg;
}

/**
 * Watch for external file changes (5s poll).
 * If the file is modified outside the app, reload it.
 */
export function startConfigWatcher() {
  setInterval(() => {
    try {
      if (!existsSync(CONFIG_PATH)) return;
      const mtime = statSync(CONFIG_PATH).mtimeMs;
      if (mtime > lastModified) {
        console.log('[config] External change detected, reloading services.yaml');
        loadConfig();
        changeListeners.forEach(fn => fn(config));
      }
    } catch {}
  }, 5000);
}

/**
 * Register a callback for config changes (from file watcher or API save).
 */
export function onConfigChange(fn) {
  changeListeners.push(fn);
}
