/**
 * JagHelm Integration Registry
 *
 * Loads all preset definitions from the presets/ directory.
 * Presets are pure data — no code execution, just config shapes.
 *
 * Usage:
 *   import { getPreset, listPresets } from './integrations/registry.js';
 *   const adguard = getPreset('adguard');     // returns preset object or null
 *   const all = listPresets();                 // returns [{ type, name, icon, description }, ...]
 *
 * ─── Schema validation ───────────────────────────────────────────────────
 * Every preset loaded from disk is validated against a known key set:
 *   - REQUIRED_KEYS must all be present and truthy, else the preset is
 *     SKIPPED (logged at error level). This is graceful degradation —
 *     one broken preset shouldn't take down the whole integrations system.
 *   - Unknown top-level keys trigger a warn-and-strip: the key is removed
 *     from the preset object and logged with filename + key name so the
 *     author can spot the typo. This catches the class of bugs where a
 *     preset declares e.g. `transform:` (never read) instead of
 *     `structuredTransform:` (read by handler.js).
 * The allowed key list is the union of every property handler.js / lib/*.js
 * actually reads. If you add a new field to a preset, you MUST also add it
 * to ALLOWED_KEYS below — that's intentional friction so dead keys don't
 * accumulate again.
 *
 * ─── Arr-family factory (follow-up) ──────────────────────────────────────
 * Radarr, Sonarr, Lidarr, Readarr, and Prowlarr share a near-identical
 * shape: header auth with `X-Api-Key`, a queue endpoint, a system/status
 * test endpoint, and a single `totalRecords` field (or `_length` for
 * Prowlarr's indexer list). A follow-up PR could collapse these into a
 * `createArrPreset({ name, version, queueEndpoint, ... })` factory living
 * next to this file, which would cut ~80 lines and make adding a new
 * *arr trivial. Deferred for now — wanted this PR to be pure hygiene, no
 * structural changes that touch multiple presets at once.
 */

import { readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRESETS_DIR = join(__dirname, 'presets');

const presets = new Map();

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
    files = readdirSync(PRESETS_DIR).filter(f => f.endsWith('.js'));
  } catch (err) {
    console.warn('[integrations] No presets directory found at', PRESETS_DIR);
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
        console.warn(`[integrations] ${file}: ${w}`);
      }

      if (!ok) {
        // Match the existing error-logging style; skip rather than throw so
        // one bad preset doesn't disable the entire integrations subsystem.
        console.error(`[integrations] Skipping invalid preset ${file}: ${errors.join(', ')}`);
        continue;
      }

      preset.type = type;
      presets.set(type, preset);
    } catch (err) {
      console.error(`[integrations] Failed to load preset ${file}:`, err.message);
    }
  }

  console.log(`[integrations] Loaded ${presets.size} presets: ${[...presets.keys()].join(', ')}`);
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
 */
export function listPresets() {
  return [...presets.values()].map(p => ({
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
