/**
 * JagHelm Config Manager
 * Loads/saves/watches data/services.yaml with hot-reload on file change.
 * Generates a default config from discovery results on first boot.
 *
 * services.yaml has a version (#423): an HMAC-SHA256 of its bytes on disk,
 * keyed per install, so it survives a restart and changes with any edit, by
 * hand or by JagHelm. readConfig() answers the config with the version of the
 * file it came from, and writeConfig() is the one writer: it writes only over
 * the version its caller read, checked against the file in the same
 * synchronous step, and never over a file that doesn't parse.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

import { atomicWriteFileSync, createExclusiveFileSync } from './util/atomicWrite.js';
import { DATA_DIR } from './util/dataDir.js';
import { createLogger } from './util/logger.js';
import { describeParseError, yamlParseError } from './util/parseError.js';

const log = createLogger('config');

const CONFIG_PATH = join(DATA_DIR, 'services.yaml');
const VERSION_KEY_PATH = join(DATA_DIR, 'config-version.key');
const VERSION_KEY_BYTES = 32;

// In-memory config state
let config = null;
let lastModified = 0;
let changeListeners = [];
// The version of the bytes last read or written: the file `config` came from,
// or one that didn't parse (kept so it isn't read again until it changes).
let seenVersion = null;
// Why the file at seenVersion is no usable config (unusableReason), or null.
let seenUnusable = null;
// The same for the board and /api/health (#505): `{ line, reason }`, or null.
let seenProblem = null;
// The key versions are made with, once read (versionKey).
let versionKeyBytes = null;

/** The version when there is no services.yaml. No HMAC is this word. */
export const CONFIG_ABSENT = 'absent';

/**
 * The key services.yaml's version is made with: 32 random bytes in
 * DATA_DIR/config-version.key, mode 0600, made on first use (#423). A plain
 * hash of the file, seen in a HAR file or a screenshot, would let anyone
 * rebuild a file JagHelm wrote from the masked read and test guesses at a weak
 * plaintext credential in it offline. Not DASH_SECRET: the installs without
 * one are the ones that still keep plaintext credentials in the file.
 *
 * Two boots racing to make it end up with one key (createExclusiveFileSync).
 * A key file that can't be read, or isn't 32 bytes, throws, at boot
 * (loadConfig) and on every read after: a key made up for this run would
 * change every version at the next restart. The error names the file, never
 * its content. Losing the file costs nothing but one refused Settings save:
 * the next boot makes a new key, so every version changes once.
 */
function versionKey() {
  if (versionKeyBytes) return versionKeyBytes;
  let key = readVersionKey();
  if (!key) {
    createExclusiveFileSync(VERSION_KEY_PATH, randomBytes(VERSION_KEY_BYTES), { mode: 0o600 });
    // Ours, or the one another boot made first.
    key = readVersionKey();
    if (!key) throw new Error(`${VERSION_KEY_PATH} vanished as it was made`);
    log.info('Made a new key for the version of services.yaml (config-version.key)');
  }
  versionKeyBytes = key;
  return key;
}

/** The key on disk, or null when there is no key file. */
function readVersionKey() {
  let bytes;
  try {
    bytes = readFileSync(VERSION_KEY_PATH);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(
      `Can't read ${VERSION_KEY_PATH} (${err.code}), the key for services.yaml's version: ` +
        'fix its permissions, or remove it and JagHelm makes a new one'
    );
  }
  if (bytes.length !== VERSION_KEY_BYTES) {
    throw new Error(
      `${VERSION_KEY_PATH} is not a ${VERSION_KEY_BYTES}-byte key: remove it and JagHelm makes a new one`
    );
  }
  return bytes;
}

/** The version of services.yaml with these bytes: an HMAC-SHA256 of them, base64url. */
function versionOf(bytes) {
  return createHmac('sha256', versionKey()).update(bytes).digest('base64url');
}

/**
 * services.yaml's bytes parsed: `{ config }` when they are a usable config (a
 * mapping), else `{ problem, unusable, parseError? }`: `problem` says why for
 * the log, `unusable` says it for Settings, and a YAML error is `parseError`,
 * its reason and position (#504). None of them quotes the file: js-yaml's own
 * error shows the lines around the bad one, credentials and all, and its
 * reason names an unquoted value read as an alias or a tag, so the error
 * itself is never kept, logged or answered.
 */
function parseConfig(bytes) {
  let parsed;
  try {
    parsed = yaml.load(bytes.toString('utf8'));
  } catch (err) {
    const parseError = yamlParseError(err);
    return unusableBecause(
      `services.yaml doesn't parse (${describeParseError(parseError)})`,
      parseError
    );
  }
  // yaml.load answers undefined for an empty or comments-only document.
  if (parsed === null || parsed === undefined) return unusableBecause('services.yaml is empty');
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return unusableBecause("services.yaml isn't a mapping");
  }
  return { config: parsed };
}

/**
 * @param {string} problem
 * @param {import('./util/parseError.js').ParseError} [parseError]
 */
const unusableBecause = (problem, parseError) => ({
  problem,
  parseError,
  unusable: `${problem}: fix it by hand; JagHelm won't save over it`,
});

/**
 * An unusable file's problem as the board says it (#505): the line a parse
 * error is on, or null (an empty file, one that isn't a mapping, a parse
 * error with no position), and the reason, in a few fixed words and that
 * line: "services.yaml doesn't parse (line 4)". Nothing of the file.
 * @param {{ problem: string, parseError?: import('./util/parseError.js').ParseError }} parsed
 * @returns {{ line: number | null, reason: string }}
 */
function boardProblemOf({ problem, parseError }) {
  if (!parseError) return { line: null, reason: problem };
  const { line } = parseError;
  return line === null
    ? { line, reason: "services.yaml doesn't parse" }
    : { line, reason: `services.yaml doesn't parse (line ${line})` };
}

/** services.yaml's bytes and version now, or no bytes and CONFIG_ABSENT. */
function readDisk() {
  try {
    const bytes = readFileSync(CONFIG_PATH);
    return { bytes, version: versionOf(bytes) };
  } catch (err) {
    if (err.code === 'ENOENT') return { bytes: null, version: CONFIG_ABSENT };
    throw err;
  }
}

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
  // Outside the try: a key file that can't be read stops the boot (versionKey).
  versionKey();
  try {
    const disk = readDisk();
    if (!disk.bytes) {
      log.info('No services.yaml found — first boot, will auto-discover');
      return null;
    }
    if (!adopt(disk)) return getConfig();
    lastModified = statSync(CONFIG_PATH).mtimeMs;
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
    // Not a parse error (parseConfig catches those): reading or stat-ing the
    // file, an error that names its path, never its content.
    return keepAfterFailedRead('Failed to load services.yaml', { err });
  }
}

/**
 * Make `disk` (readDisk's answer, with bytes) the config in memory. False when
 * it is no usable config: the previous one is kept (#463). Either way its
 * version is the one seen, with why it can't be used when it can't, so
 * readConfig doesn't parse it again until the file changes.
 */
function adopt(disk) {
  seenVersion = disk.version;
  const parsed = parseConfig(disk.bytes);
  seenUnusable = parsed.unusable ?? null;
  seenProblem = parsed.unusable ? boardProblemOf(parsed) : null;
  if (parsed.unusable) {
    keepAfterFailedRead(parsed.problem, parsed.parseError && { parseError: parsed.parseError });
    return false;
  }
  config = parsed.config;
  warnUnreadKeys(config);
  return true;
}

/**
 * The config as services.yaml holds it now, with the file's version (#423).
 *
 * The file is read every time: a hand edit the 5 s watcher hasn't loaded yet
 * is loaded here first, so the config and its version always match. The
 * watcher still sees the change and reloads it as usual. With no file the
 * version is CONFIG_ABSENT.
 *
 * A file that is no usable config answers no config, and `unusable`, why
 * ("services.yaml doesn't parse (bad indentation of a mapping entry at line 4,
 * column 4): …", never a quote of the file): the board keeps the last good
 * config (#463), but that config is not this file's, so it never goes out
 * with this file's version, and no writer may write over the file
 * (writeConfig refuses) until it is fixed by hand.
 *
 * Every writer reads through here and writes with writeConfig, in one
 * synchronous step (no `await` in between).
 * @returns {{ config: any, version: string, unusable?: string }}
 */
export function readConfig() {
  const disk = readDisk();
  if (disk.bytes && disk.version !== seenVersion) adopt(disk);
  if (disk.bytes && seenUnusable) {
    return { config: null, version: disk.version, unusable: seenUnusable };
  }
  return { config: getConfig(), version: disk.version };
}

/**
 * Why services.yaml is no usable config, as of its last read (boot, the
 * watcher's reload, a route's readConfig, a save), for the status model
 * (#505): `{ line, reason }` (boardProblemOf), or null while it is a usable
 * config or there is none. The board says it as a failed source, so a broken
 * file at boot is not an empty, calm board. Never a word of the file (#504).
 * @returns {{ line: number | null, reason: string } | null}
 */
export function configProblem() {
  return seenProblem ? { ...seenProblem } : null;
}

/**
 * services.yaml's state for /api/health (#505): `{ state: 'ok' }`, or
 * `{ state: 'unparseable', line }` (line null when there is none) while it is
 * no usable config: the same files every writer refuses with
 * `config_unparseable` (#423). It never changes the probe's `status`.
 */
export function configHealth() {
  return seenProblem ? { state: 'unparseable', line: seenProblem.line } : { state: 'ok' };
}

/**
 * A read that produced no usable config (#463): keep the previous one, or
 * start from an empty one when there is none, without touching the file.
 * `fields` go on the log line: never a YAML error itself (#504).
 */
function keepAfterFailedRead(msg, fields = {}) {
  if (config) {
    log.warn(fields, `${msg}; keeping the previous config until the file changes again`);
  } else {
    config = {};
    log.error(fields, `${msg}; starting with an empty board and not overwriting the file`);
  }
  return getConfig();
}

/**
 * Write `newConfig` to services.yaml, but only over `ifVersion`, the version
 * the caller read (readConfig). This is the one place services.yaml is
 * written (#423).
 *
 * The check and the write are one synchronous step: the file is read and
 * hashed, compared with `ifVersion`, and replaced, with no `await` in
 * between, so no other request can write after the check. A file that is no
 * longer at `ifVersion` (another save, or a hand edit) is left as it is:
 * `{ ok: false, conflict: true }`. A file that is no usable config (it doesn't
 * parse, or is empty or not a mapping) is never written over, whatever
 * version the caller passes: `{ ok: false, unusable }`, why, so a hand edit
 * gone wrong is fixed by hand, not replaced by the last good config (or by
 * `{}` at boot) plus one change. A write that fails, or a reentrant one, is
 * `{ ok: false }`. Otherwise `{ ok: true, version }`, the version written.
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

/**
 * @param {any} newConfig
 * @param {string} ifVersion
 * @returns {{ ok: true, version: string } | { ok: false, conflict?: true, unusable?: string }}
 */
export function writeConfig(newConfig, ifVersion) {
  if (saveInProgress) {
    log.error('writeConfig reentered while a write was in progress — refusing');
    return { ok: false };
  }
  saveInProgress = true;
  try {
    const disk = readDisk();
    if (disk.version !== ifVersion) {
      log.warn('services.yaml changed since it was read; not saving over it');
      return { ok: false, conflict: true };
    }
    // Parsed here, from the bytes about to be replaced, not taken from what
    // the caller read: no caller can skip it.
    const unusable = disk.bytes && parseConfig(disk.bytes).unusable;
    if (unusable) {
      log.warn('services.yaml is no usable config; not saving over it until it is fixed by hand');
      return { ok: false, unusable };
    }
    const yamlStr = yaml.dump(newConfig, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
    });
    const header =
      '# JagHelm Configuration\n# This file is managed by the dashboard. Edit here or in Settings UI — both are equivalent.\n\n';
    const text = header + yamlStr;
    // Atomic write: temp file → fsync → rename. A reader can never observe a
    // half-written services.yaml, even if the process crashes mid-write.
    atomicWriteFileSync(CONFIG_PATH, text);
    // Defensive deep copy: a caller that retains and later mutates `newConfig`
    // must not be able to reach into our canonical in-memory state.
    config = structuredClone(newConfig);
    seenVersion = versionOf(Buffer.from(text, 'utf8'));
    seenUnusable = null;
    seenProblem = null;
    lastModified = statSync(CONFIG_PATH).mtimeMs;
    log.info('Saved services.yaml');
    return { ok: true, version: seenVersion };
  } catch (err) {
    log.error({ err }, 'Failed to save services.yaml');
    return { ok: false };
  } finally {
    saveInProgress = false;
  }
}

/**
 * Write `newConfig` over whatever services.yaml holds now, through
 * writeConfig, so never over a file that doesn't parse. For first boot,
 * which writes the file discovery generated before the server listens, and
 * for tests. A route reads with readConfig and writes with writeConfig over
 * the version it read. Returns true when written.
 */
export function saveConfig(newConfig) {
  return writeConfig(newConfig, readDisk().version).ok;
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
