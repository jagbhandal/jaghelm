/**
 * Settings → Integrations (#323, spec §7): what the section's parts say, from
 * the stored entries, the presets and the status model alone.
 *
 *  - An entry is the preset it says. A stored entry's preset is its `preset`
 *    field, else its own key, which is what the server resolves it by
 *    (integrations/lib/config.js: `entry.preset || key`); one whose
 *    name isn't a preset's is custom, and says "Custom". The list used to
 *    take the part of the key before the first `_`, so a custom `my_api`
 *    read as a preset called `my`.
 *  - A row's name is the preset's, with its instance: "AdGuard Home
 *    (primary)"; a custom entry has only its key to be called by.
 *  - A preset the gallery doesn't list is not custom when the entry names
 *    it: the server gates presets marked `unsupported` out of the list
 *    (registry.js listPresets), so one that is a known preset's type reads
 *    "Unsupported preset" with its type as its name, never "Custom". While
 *    the presets couldn't be read at all, no row can be told apart: each shows
 *    its key and no kind, and the list says why.
 *  - Its lamp and word are the status model's for it (`integrations/<key>`
 *    among the entities, the board's own judgement), drawn as no signal while
 *    the status is stale (statusFreshness.js); a disabled one isn't fetched
 *    and says so. The client judges nothing (spec §6).
 *  - A custom entry written by hand with an `endpoint` or `fields` keeps them
 *    when saved from Settings (#402), but the form has no inputs for them: the
 *    row and the form say they are set in services.yaml.
 */
import { iconImageSrc } from '../../../../utils/icon.jsx';
import { drawnState } from '../../../../shell/statusFreshness.js';
import { AUTH_FIELDS, CATEGORIES, PRESET_CATEGORIES, isStoredMarker } from './constants.js';

/** What the list says while the presets couldn't be read. */
export const PRESETS_UNREAD =
  "The presets couldn't be read, so each integration shows its key and whether it is a preset isn't known. Reload to try again.";

/** The type an entry names: its `preset`, else its key (the server's rule). */
const typeOf = (key, entry) =>
  typeof entry?.preset === 'string' && entry.preset ? entry.preset : key;

/** True for an entry naming a preset the server knows but doesn't list (marked unsupported). */
export function isUnsupported(key, entry, presets) {
  return !presetOf(key, entry, presets) && Object.hasOwn(PRESET_CATEGORIES, typeOf(key, entry));
}

/** True when the entry has a stored password or token (read as a marker or a reference). */
export function hasStoredSecrets(entry) {
  return ['password', 'token'].some((f) => {
    const v = entry?.[f];
    return (
      isStoredMarker(v) ||
      (typeof v === 'string' && v !== '') ||
      (v != null && typeof v === 'object')
    );
  });
}

/** The preset a stored entry is, or null for a custom one. */
export function presetOf(key, entry, presets) {
  const type = typeOf(key, entry);
  return presets.find((p) => p.type === type) ?? null;
}

/** An entry's display name: its preset's, with its instance; a custom one its key. */
export function displayName(key, entry, presets) {
  const preset = presetOf(key, entry, presets);
  if (!preset && isUnsupported(key, entry, presets) && entry?.instance)
    return `${typeOf(key, entry)} (${entry.instance})`;
  if (!preset && isUnsupported(key, entry, presets)) return typeOf(key, entry);
  if (!preset) return key;
  return entry?.instance ? `${preset.name} (${entry.instance})` : preset.name;
}

/** True when a custom entry carries an endpoint or fields the form cannot edit. */
export function hasHandWritten(entry) {
  return Boolean(entry?.endpoint) || (Array.isArray(entry?.fields) && entry.fields.length > 0);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The sentence about what only services.yaml holds, or null. */
export function handWrittenNote(entry) {
  const parts = [];
  if (entry?.endpoint) parts.push('an endpoint');
  const n = Array.isArray(entry?.fields) ? entry.fields.length : 0;
  if (n > 0) parts.push(plural(n, 'data field', 'data fields'));
  if (parts.length === 0) return null;
  return `It has ${parts.join(' and ')}, set in services.yaml on the host. Settings keeps them as they are; change them in the file.`;
}

/**
 * The Connected list's rows. `status` is the header's poll (null before the
 * first), `freshness` its staleness. A row is `{ id, name, kind, url,
 * urlHidden, target, enabled, state, word, error, notes, secrets, iconSrc }`.
 */
export function listRows({
  configured,
  presets,
  presetsFailed = false,
  containers = [],
  status = null,
  freshness = null,
}) {
  const targetName = (uid) => containers.find((c) => c.uid === uid)?.name ?? null;
  return Object.entries(configured).map(([key, entry]) => {
    const cfg = entry && typeof entry === 'object' ? entry : {};
    const preset = presetOf(key, cfg, presets);
    const enabled = cfg.enabled !== false;
    const live = status?.entities?.find((e) => e.id === `integrations/${key}`) ?? null;
    let state = null;
    let word = '';
    let error = null;
    if (!enabled) {
      word = 'Disabled';
    } else if (!status) {
      state = drawnState('unknown', freshness);
      word = 'No signal';
    } else if (!live) {
      state = drawnState('unknown', freshness);
      word = 'Not fetched yet';
    } else {
      state = drawnState(live.state, freshness);
      word = live.word || '';
      if (live.state !== 'ok') error = live.reason || null;
    }
    const target = typeof cfg.target === 'string' && cfg.target ? cfg.target : null;
    const notes = [];
    const unsupported = !presetsFailed && isUnsupported(key, cfg, presets);
    if (unsupported) notes.push("This preset is marked unsupported, so JagHelm doesn't fetch it.");
    else if (!preset && !presetsFailed && hasHandWritten(cfg))
      notes.push('Endpoint and fields are set in services.yaml.');
    return {
      id: key,
      name: presetsFailed ? key : displayName(key, cfg, presets),
      kind: presetsFailed
        ? null
        : preset
          ? 'Preset'
          : unsupported
            ? 'Unsupported preset'
            : 'Custom',
      secrets: hasStoredSecrets(cfg),
      url: typeof cfg.url === 'string' ? cfg.url : null,
      urlHidden: isStoredMarker(cfg.url),
      target: target ? (targetName(target) ?? target) : null,
      enabled,
      state,
      word,
      error,
      notes,
      iconSrc: preset ? iconImageSrc(preset.icon) : null,
    };
  });
}

/** The gallery's category choices, with how many presets each holds. */
export function categoryItems(presets) {
  const counts = {};
  for (const p of presets) {
    const cat = PRESET_CATEGORIES[p.type] || 'home';
    counts[cat] = (counts[cat] || 0) + 1;
  }
  return CATEGORIES.filter((c) => c.id === 'all' || counts[c.id]).map((c) => ({
    value: c.id,
    label: `${c.label} (${c.id === 'all' ? presets.length : counts[c.id]})`,
  }));
}

/** The presets a search and a category leave, as the gallery's tiles. */
export function galleryTiles({ presets, configured, search, category }) {
  const q = search.trim().toLowerCase();
  const set = new Set(
    Object.entries(configured).map(([key, entry]) => presetOf(key, entry, presets)?.type)
  );
  return presets
    .filter((p) => {
      if (category !== 'all' && (PRESET_CATEGORIES[p.type] || 'home') !== category) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.type.toLowerCase().includes(q)
      );
    })
    .map((p) => ({
      type: p.type,
      name: p.name,
      description: p.description,
      auth: p.auth,
      iconSrc: iconImageSrc(p.icon),
      configured: set.has(p.type),
    }));
}

/** The credentials a form for `preset` (null: custom) asks for. */
export function neededFields(preset) {
  return AUTH_FIELDS[preset?.auth || 'bearer'] || [];
}
