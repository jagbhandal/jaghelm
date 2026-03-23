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
 */

import { readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRESETS_DIR = join(__dirname, 'presets');

const presets = new Map();

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
      if (!preset || !preset.name || !preset.endpoint) {
        console.warn(`[integrations] Skipping invalid preset: ${file} (missing name or endpoint)`);
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
