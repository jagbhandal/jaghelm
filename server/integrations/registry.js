/**
 * JagHelm Integration Registry — loads preset config (pure data, no code) from
 * presets/ and validates each against a known key set:
 *   - REQUIRED_KEYS missing → preset SKIPPED (logged), so one broken preset
 *     can't take down the whole integrations subsystem (graceful degradation).
 *   - Unknown top-level key → warn-and-strip, which catches typos like
 *     `transform:` (never read) vs `structuredTransform:` (read by handler.js).
 * ALLOWED_KEYS is the union of every field handler.js / lib/*.js actually reads;
 * adding a new preset field means adding it here too — intentional friction so
 * dead keys can't accumulate again.
 */

import { readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createLogger } from '../util/logger.js';

const log = createLogger('integrations');

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRESETS_DIR = join(__dirname, 'presets');

const presets = new Map();

// Helper modules that live in presets/ but aren't themselves presets (they're
// imported BY presets). Excluded from the directory scan so they don't trip the
// "default export is not an object" validation and log a spurious load error.
const NON_PRESET_FILES = new Set(['createArrPreset.js']);

// Keys that every preset MUST declare. Verified against the actual readers:
//   - `name`      → registry.listPresets() exposes to UI
//   - `endpoint`  → handler.js fetchIntegration builds the request URL
//   - `auth`      → handler.js + lib/auth.js + lib/session.js dispatch
//   - `icon`      → registry.listPresets() exposes to UI gallery
const REQUIRED_KEYS = ['name', 'endpoint', 'auth', 'icon'];

// Keys we tolerate at the top level of a preset. Anything else is a typo
// or a leftover dead field — see the warn-and-strip branch in initRegistry.
//
// Maintenance note: when you teach handler.js or lib/* to read a NEW preset
// field, add it here in the same PR. Otherwise validation will strip it at
// load time and you'll spend an hour wondering why your new feature is dead.
const ALLOWED_KEYS = new Set([
  // Identity / display
  'name', 'icon', 'description', 'type',
  // Auth mode + per-mode config
  'auth', 'authHeader', 'authPrefix', 'queryParam',
  'session', 'authFallback', 'oauth2', 'oauth2Instructions',
  // Endpoints
  'endpoint', 'testEndpoint', 'extraEndpoints',
  // Transport
  'extraHeaders', 'tlsSkip',
  // Response shaping
  'fields', 'structuredTransform',
  // Credential resolution
  'envKeys',
  // UI hints
  'urlParams', 'defaultUrl',
  // Availability gate: when set to a non-empty reason string, the preset is
  // recognized (getPreset/getPresetFull still return it) but gated OUT of the
  // gallery by listPresets(), so it can't be added/configured/polled. Used for
  // presets that can't work against the current handler (GET-only) or that hit
  // a side-effecting endpoint on every refresh. Non-destructive: the file stays
  // on disk for when the underlying limitation is fixed.
  'unsupported',
]);

/**
 * Validate a preset against REQUIRED_KEYS / ALLOWED_KEYS.
 *
 * Returns { ok, errors, warnings } — caller decides whether to skip or load.
 * Mutates `preset` to strip unknown keys when ok=true; leaves it untouched
 * when ok=false (caller is going to drop it on the floor anyway).
 */
function validatePreset(file, preset) {
  const errors = [];
  const warnings = [];

  if (!preset || typeof preset !== 'object') {
    errors.push('default export is not an object');
    return { ok: false, errors, warnings };
  }

  for (const key of REQUIRED_KEYS) {
    if (!preset[key]) errors.push(`missing required key '${key}'`);
  }
  if (errors.length > 0) return { ok: false, errors, warnings };

  for (const key of Object.keys(preset)) {
    if (!ALLOWED_KEYS.has(key)) {
      warnings.push(`unknown key '${key}' — stripping`);
      delete preset[key];
    }
  }

  return { ok: true, errors, warnings };
}

/**
 * Load all .js files from presets/ directory.
 * Each file default-exports a preset config object.
 * The filename (minus .js) becomes the preset type key.
 */
export async function initRegistry() {
  let files;
  try {
    files = readdirSync(PRESETS_DIR)
      .filter(f => f.endsWith('.js') && !NON_PRESET_FILES.has(f));
  } catch (err) {
    log.warn({ presetsDir: PRESETS_DIR }, 'No presets directory found');
    return;
  }

  for (const file of files) {
    const type = basename(file, '.js');
    try {
      const filePath = join(PRESETS_DIR, file);
      const fileUrl = pathToFileURL(filePath).href;
      const mod = await import(fileUrl);
      const preset = mod.default;

      const { ok, errors, warnings } = validatePreset(file, preset);

      // Emit warnings even on success — they're informational, not blocking.
      for (const w of warnings) {
        log.warn({ file }, w);
      }

      if (!ok) {
        // Match the existing error-logging style; skip rather than throw so
        // one bad preset doesn't disable the entire integrations subsystem.
        log.error({ file, errors: errors.join(', ') }, 'Skipping invalid preset');
        continue;
      }

      preset.type = type;
      presets.set(type, preset);
    } catch (err) {
      log.error({ file, err }, 'Failed to load preset');
    }
  }

  log.info({ count: presets.size, presets: [...presets.keys()].join(', ') }, 'Loaded presets');
}

/**
 * Get a preset by type key (e.g. 'adguard', 'plex', 'sonarr').
 * Returns the preset object or null if not found.
 */
export function getPreset(type) {
  return presets.get(type) || null;
}

/**
 * List all available presets (for the Settings UI gallery).
 * Returns a lightweight summary array — no auth details or endpoints exposed.
 *
 * Presets flagged `unsupported` (a non-empty reason string) are gated out:
 * they're still resolvable via getPreset()/getPresetFull() for any config that
 * already references them, but they never appear in the gallery, so they can't
 * be newly added — and therefore aren't polled or connection-tested.
 */
export function listPresets() {
  return [...presets.values()].filter(p => !p.unsupported).map(p => ({
    type: p.type,
    name: p.name,
    icon: p.icon,
    description: p.description || '',
    auth: p.auth,
    fields: (p.fields || []).map(f => ({ key: f.key, label: f.label })),
    urlParams: p.urlParams || undefined,
  }));
}

/**
 * Get the full preset including auth config (for server-side use only).
 * Never expose this directly to the frontend.
 */
export function getPresetFull(type) {
  return presets.get(type) || null;
}

// Exposed for tests only. Not part of the public registry API — do not call
// from runtime code paths; use initRegistry() / getPreset() instead.
export const __test__ = { validatePreset, REQUIRED_KEYS, ALLOWED_KEYS };
