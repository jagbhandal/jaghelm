/**
 * Integrations API.
 *
 *   GET    /api/integrations           → all configured integrations' data
 *   GET    /api/integrations/presets   → built-in preset gallery
 *   POST   /api/integrations/test      → test the form as a save would store it, as a refresh fetches
 *   POST   /api/integrations/save      → encrypt creds + merge the form into config
 *   PATCH  /api/integrations/:key      → enable or disable, { enabled } only
 *   DELETE /api/integrations/:type     → remove a configured integration and its secrets
 *
 * Multiple instances of the same preset are supported via the optional
 * `instance` field, which gets folded into the storage key
 * (e.g. type=adguard, instance=primary → adguard_primary).
 *
 * There is no GET /:type: it returned one integration's data with the whole
 * upstream response and had no caller (#254). The dashboard reads GET /.
 *
 * Each write reads services.yaml with readConfig and writes it with
 * writeConfig over the version it read, in the same synchronous handler
 * (#423): it starts from the file as it is, and changes the version a
 * Settings tab must send to save the whole config. While the file doesn't
 * parse, each is refused (503 `config_unparseable`) before it changes
 * anything, a stored credential included; writeConfig refuses it too. So
 * while it is there but can't be read (503 `config_unreadable`, #536).
 *
 * services.yaml is the record of which secrets an integration has (#502,
 * #415): a save stores what it needs before the file is written, and puts the
 * secret store back as it was if the write fails, so secrets.json ends
 * byte-for-byte as before; a secret secrets.json can't take refuses the save.
 * A delete or a rename drops what it frees, and no other entry uses, once the
 * file is written. A crash between the two leaves only secrets no entry uses,
 * which the boot log counts (integrations/unusedSecrets.js).
 */

import { isDeepStrictEqual } from 'node:util';

import { Router } from 'express';

import { readConfig, writeConfig } from '../config.js';
import {
  copySecret,
  deleteSecret,
  deleteSecrets,
  getSecret,
  getSecretOrigins,
  hasSecret,
  listSecretKeys,
  originsOnEntry,
  restoreSecrets,
  setSecret,
  snapshotSecrets,
} from '../secrets.js';
import { getPreset, listPresets } from '../integrations/registry.js';
import { testIntegration } from '../integrations/handler.js';
import {
  KEYED_SECRET_FIELDS,
  entryOrigin,
  integrationInput,
  keyedSecretName,
} from '../integrations/lib/config.js';
import { formUrlCredentialError } from '../integrations/lib/urlCredential.js';
import { looksLikeSecretRef } from '../integrations/lib/extract.js';
import {
  dropUnusedIntegrationSecrets,
  unusedIntegrationSecrets,
} from '../integrations/unusedSecrets.js';
import { refreshIntegrations, retryIntegrationNow } from '../refresh.js';
import { respondWarmCached } from '../cache.js';
import { apiError, configUnusable } from '../errors.js';
import { asyncHandler } from '../util/asyncHandler.js';
import { createRateLimiter } from '../util/rateLimiter.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('integrations');
const router = Router();

// The connection test fetches a user-supplied URL, so it's a reachability/
// port-scan oracle (even with the SSRF guard). Throttle per-IP and audit it.
const testLimiter = createRateLimiter({ max: 10, windowMs: 60_000 });

// Preset type + instance become part of the secret key / config key, so bound them.
const SAFE_ID = /^[\w-]{1,64}$/;

// Allow-list user-supplied `params` to the preset's declared urlParams keys, so a
// client can't fold handler-honored keys (endpoint/url override, tlsSkip to disable
// cert validation, extraHeaders, authHeader, extraEndpoints) into the saved/tested
// config. Non-preset (custom) integrations declare no urlParams -> nothing accepted.
export function allowedParams(type, params) {
  if (!params || typeof params !== 'object') return {};
  const keys = new Set((getPreset(type)?.urlParams || []).map((p) => p.key));
  const out = {};
  for (const [k, v] of Object.entries(params)) if (keys.has(k)) out[k] = v;
  return out;
}

/** Auto-prepend http:// when the user types a bare host. */
function normalizeUrl(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

// ── List presets ─────────────────────────────────────────────────────────

router.get('/presets', (req, res) => {
  res.json(listPresets());
});

// ── Aggregate live data for the dashboard ────────────────────────────────

router.get(
  '/',
  asyncHandler((req, res) =>
    respondWarmCached(req, res, {
      key: 'integrations',
      refresh: refreshIntegrations,
      fallback: (r) => r.json({}),
    })
  )
);

// ── Save (encrypts secrets into secrets.json, config into services.yaml) ──
//
// A save merges the form into the integration's stored entry (#402). It used
// to rebuild the entry from the form, so whatever the form doesn't send was
// lost: a custom integration's endpoint, auth, header and fields, a credential
// under a secret name Settings doesn't derive, and any key written by hand.
// Now only what the form owns changes:
//   - url, always sent and required (normalized); one that carries a
//     credential, a user name or password before the host or a secret query
//     parameter, is refused (400, field 'url', #422): it never worked, and it
//     went back to the browser in the config;
//   - username and target, when sent: an empty one is removed;
//   - the preset's URL params, when sent (allow-listed): an empty one is removed;
//   - password and token, only when typed (text only, never a `$secret:`
//     reference): blank keeps what is stored, a plaintext value or a
//     `$secret:` under any name;
//   - fields, when sent;
//   - instance, which is part of the key: a changed one moves the entry, and
//     its keyed secrets with it, to its new key; an unchanged one keeps the
//     entry where it is, even under a key Settings would not derive (`my_npm`,
//     `npm_Two`).
// No value the form sends may name a stored secret: one that is a `$secret:`
// reference is refused (400, naming the field) unless it is the value already
// stored in that field of this entry (see mergeForm).
// A stored credential goes only to the address it was entered for (#556): a
// typed password or token is stored for the origin of the entry's URL (the
// value it already held, typed again, adds that origin), and one left blank
// while the URL moves to another origin is refused (400, naming the field:
// re-enter it for the new address).
// `enabled` is set by a save that creates the entry, or one without an
// `editingKey` (an older web app's toggle sent those). An edit leaves it to the
// toggle route, so a form left open can't undo a toggle made since. An edit
// whose entry is gone is refused (409) rather than merged into another one.
// A save never lands on a key another integration holds (#414): a rename onto
// one, or an add the form marks `create`, is refused (409) naming it, before
// anything is stored. A save without `editingKey` or `create` still merges
// into the entry under its key, since an older web app's toggle posts that.
// The preset of an existing entry is never changed. A save that changes
// nothing writes nothing, so services.yaml stays byte-for-byte as it was
// (every write re-serialises the whole file); it still asks for a retry.
// A save whose services.yaml write fails, is refused or throws stores nothing
// (#502): the secret store goes back to what it held before the save, and
// secrets.json byte-for-byte with it. One whose secret secrets.json can't
// take is refused (500) the same way. A save that creates an entry first
// clears what an older delete left under its key (#415), so it starts with
// no credential but the one typed.

/**
 * Write `config` over `version`, the one this handler read. A refusal is
 * answered here: false means the response is sent. services.yaml changing
 * between this handler's read and write would take a writer outside this
 * process (a hand edit in the same instant).
 */
function written(res, config, version) {
  const saved = writeConfig(config, version);
  if (saved.ok) return true;
  if (saved.conflict) apiError(res, 409, 'services.yaml changed while saving; try again');
  else if (saved.unusable) configUnusable(res, saved.unusable, saved.code);
  // A write failure (or a reentrant save) is a 500, not a reported success,
  // matching services.js POST /config.
  else apiError(res, 500, 'Failed to persist config');
  return false;
}

/** True for a value the form sends for an empty field. */
const isBlank = (v) => v === undefined || v === null || v === '';

/** True when an edit names the entry it edits (the web form sends it then). */
const isSent = (v) => v !== undefined && v !== null && v !== '';

/** An instance name as the web form normalizes it (lowercase a-z, 0-9, -). */
function formInstance(v) {
  return typeof v === 'string' ? v.trim().toLowerCase().replace(/[^a-z0-9-]/g, '') : '';
}

/** The stored entry under `key`, when it is one (own key, an object). */
function storedEntry(integrations, key) {
  if (typeof key !== 'string' || !Object.hasOwn(integrations, key)) return null;
  const entry = integrations[key];
  return entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : null;
}

/** An integration's name as the Settings list shows it (HomeView.jsx). */
function listName(key, entry) {
  const presetType = entry.preset || (key.includes('_') ? key.split('_')[0] : key);
  const name = getPreset(presetType)?.name;
  if (entry.instance) return `${name || presetType} (${entry.instance})`;
  return name || key;
}

/**
 * Why a save onto `key`, which `holder` already holds, is refused: it names
 * the holder as the list does (one it names by its key is a custom
 * integration), and says what to do: a preset's form has an Instance Name
 * field to change; the custom builder has none and always derives `_custom`.
 */
function takenKeyError(key, holder, type) {
  const name = listName(key, holder);
  const taken =
    name === key
      ? `A custom integration is already saved under '${key}'`
      : `${name} already uses the key '${key}'`;
  return `${taken}; ${getPreset(type) ? 'choose another instance name' : 'edit or remove it first'}`;
}

/** Set an owned field: an empty value removes it, unless it is already empty. */
function setOwned(entry, key, value) {
  if (!isBlank(value)) entry[key] = value;
  else if (!isBlank(entry[key])) delete entry[key];
}

/**
 * Why the form `body` can't be saved or tested, checked before anything is
 * read: `{ status, error, field? }`, or null. `field` names the form field the
 * error belongs beside: 'url' for a URL that carries a credential (#422),
 * whose message says where the credential goes and never quotes it.
 */
function formRefusal(body) {
  const { type, instance, url, password, token } = body;
  const cleanUrl = normalizeUrl(typeof url === 'string' ? url : '');
  if (!type || !cleanUrl) return { status: 400, error: 'type and url are required' };
  if (!SAFE_ID.test(type) || (instance && !SAFE_ID.test(instance))) {
    return { status: 400, error: 'Invalid type or instance (letters, digits, _ - only; max 64)' };
  }
  // A credential is text. Anything else used to reach setSecret, whose error
  // (with the value in it) was then logged.
  for (const value of [password, token]) {
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return { status: 400, error: 'password and token must be text' };
    }
  }
  // A typed password or token is the credential itself, never a `$secret:`
  // reference: the form never sends a stored one back (blank keeps it).
  for (const [field, value] of [['password', password], ['token', token]]) {
    if (looksLikeSecretRef(value)) return secretRefRefusal(field, field);
  }
  const preset = getPreset(type);
  if (preset?.unsupported) {
    return { status: 400, error: `Integration unavailable: ${preset.unsupported}` };
  }
  const inUrl = formUrlCredentialError(cleanUrl, preset);
  if (inUrl) return { status: 400, error: inUrl, field: 'url' };
  return null;
}

/**
 * The refusal of a form value that is a `$secret:` reference: it names the
 * field, never the value.
 */
function secretRefRefusal(field, label) {
  return {
    status: 400,
    error: `The ${label} can't be a stored-secret reference ($secret:…); type the value itself`,
    field,
  };
}

/** True for a value that is, or holds at any depth, a `$secret:` reference. */
function holdsSecretRef(value) {
  if (looksLikeSecretRef(value)) return true;
  if (value && typeof value === 'object') return Object.values(value).some(holdsSecretRef);
  return false;
}

/** A form field's name in a refusal: the preset's label for a URL param. */
function fieldLabel(type, field) {
  const param = (getPreset(type)?.urlParams || []).find((p) => p.key === field);
  if (param) return param.label || field;
  return { url: 'URL', target: 'target container' }[field] || field;
}

/** A refusal's body: its error, and the field it belongs beside when it has one. */
const refusalBody = ({ error, field }) => (field ? { error, field } : { error });

/**
 * The form `body` merged into the stored entry it is for, as the save stores
 * it and the connection test tests it (#427): the merge rules above, in one
 * place. Changes nothing: `config` and the secret store are only read.
 *
 * Returns `{ refused }` (a 409, or a 400 for a value that names a stored
 * secret, as formRefusal's, or for a stored credential the URL moves away
 * from, #556) or the merge:
 *   - storageKey, the key the entry is stored under; baseKey and base, the
 *     stored entry it merges into (null for a new one); moving, when the
 *     instance name moves it;
 *   - entry, the merged entry, with a `$secret:` reference for each typed
 *     credential (to the name `secretOps` stores it under);
 *   - secretOps, what the save does to the secret store, in order:
 *     `{ drop: names }` (what an older delete left under a new entry's key,
 *     #415), `{ set: name, value, origins }` (a typed password or token, for
 *     the origins it goes to, #556), and
 *     `{ copy: from, to }` (a moved keyed secret; `to` is removed when `from`
 *     holds none);
 *   - leftBehind, the old keyed names a move leaves, dropped once it is
 *     written unless another entry uses one.
 */
function mergeForm(config, body) {
  const { type, instance, url, password, token, enabled, editingKey, fields: customFields } = body;
  const cleanUrl = normalizeUrl(url);
  const integrations = config.integrations || {};

  // The entry this save is for: the one being edited, else the one already
  // under the key this save derives (the gallery adding it again, or an
  // older web app's toggle, which sent the key as the type).
  const derivedKey = instance ? `${type}_${instance}` : type;
  const editing = isSent(editingKey);
  let baseKey = null;
  let base = null;
  if (editing) {
    base = storedEntry(integrations, editingKey);
    // Removed (or replaced) since the form was opened, in another tab or by
    // a hand edit: merging into whatever is under the derived key would
    // overwrite a different integration.
    if (!base) {
      return {
        refused: {
          status: 409,
          error: `Integration '${editingKey}' is no longer configured; reload Settings and try again`,
        },
      };
    }
    baseKey = editingKey;
  } else if ((base = storedEntry(integrations, derivedKey))) {
    baseKey = derivedKey;
  }

  let storageKey = derivedKey;
  let instanceOwned = !!instance;
  if (editing) {
    // The key changes only when the instance name does.
    instanceOwned = formInstance(base.instance) !== (instance || '');
    if (!instanceOwned) storageKey = editingKey;
  } else if (base) {
    instanceOwned = !!instance && formInstance(base.instance) !== instance;
  }
  const moving = !!base && storageKey !== baseKey;

  // A rename onto a key another integration holds used to delete this entry
  // and write over that one, its secrets too (#414); an add from the form
  // (`create`) onto a taken key merged into that integration. Both are
  // refused before any secret is stored, so nothing changes.
  const creating = !editing && body.create === true;
  const holder = moving || creating ? storedEntry(integrations, storageKey) : null;
  if (holder) {
    return {
      refused: { status: 409, error: takenKeyError(storageKey, holder, type), field: 'instance' },
    };
  }

  // The form can never name a stored secret. The resolver reads a `$secret:`
  // reference in the username (and the password and token, refused above),
  // so a username `$secret:<another integration's secret>` sent that secret
  // to the form's URL, on a test at once and on a save at the next refresh.
  // Every value the form puts into the entry is checked, not only those the
  // resolver reads today: one that is or holds a reference is refused unless
  // it is the value already stored in the same field of this entry, so an
  // untouched field (a reference written by hand) still round-trips.
  const formValues = { url };
  for (const field of ['target', 'username']) {
    if (Object.hasOwn(body, field)) formValues[field] = body[field];
  }
  Object.assign(formValues, allowedParams(type, body.params));
  if (customFields) formValues.fields = customFields;
  for (const [field, value] of Object.entries(formValues)) {
    if (holdsSecretRef(value) && !isDeepStrictEqual(value, base?.[field])) {
      return { refused: secretRefRefusal(field, fieldLabel(type, field)) };
    }
  }

  const secretOps = [];
  // A new entry starts with no credential (#415): what a delete before
  // #415 left under its key, and no other entry uses, goes first.
  if (!base) secretOps.push({ drop: unusedIntegrationSecrets(config, listSecretKeys(), storageKey) });
  const typed = { password, token };
  for (const field of ['password', 'token']) {
    if (typed[field]) secretOps.push({ set: keyedSecretName(storageKey, field), value: typed[field] });
  }

  // A new entry keeps the shape and key order a save has always written.
  const entry = base ? { ...base } : { url: cleanUrl, enabled: enabled !== false };
  entry.url = cleanUrl;
  if (!editing && typeof enabled === 'boolean' && (entry.enabled !== false) !== enabled) {
    entry.enabled = enabled;
  }
  if (!base && getPreset(type)) entry.preset = type;
  if (instanceOwned) setOwned(entry, 'instance', instance);
  if (Object.hasOwn(body, 'target')) setOwned(entry, 'target', body.target);
  if (Object.hasOwn(body, 'username')) setOwned(entry, 'username', body.username);
  for (const field of ['password', 'token']) {
    if (typed[field]) entry[field] = `$secret:${keyedSecretName(storageKey, field)}`;
  }

  // URL params (e.g. account_id for Cloudflare presets) — allow-listed to the
  // preset's declared urlParams; unknown keys are dropped (no config injection).
  for (const [k, v] of Object.entries(allowedParams(type, body.params))) setOwned(entry, k, v);

  // Custom fields (only for non-preset integrations)
  if (customFields) entry.fields = customFields;

  // A move takes the entry's keyed secrets with it. What the old key held is
  // copied to the new key (still encrypted), replacing anything left there,
  // and a `$secret:` reference to the old name now names the new one. When
  // the old key held nothing, whatever is left under the new key is removed,
  // so it can't stand in for the entry's own credential. The old names are
  // removed once the move is written; until then the entry still uses them.
  const leftBehind = [];
  if (moving) {
    for (const field of KEYED_SECRET_FIELDS) {
      const from = keyedSecretName(baseKey, field);
      const to = keyedSecretName(storageKey, field);
      if (!typed[field]) secretOps.push({ copy: from, to });
      if (hasSecret(from)) leftBehind.push(from);
      if ((field === 'password' || field === 'token') && entry[field] === `$secret:${from}`) {
        entry[field] = `$secret:${to}`;
      }
    }
  }

  // A stored credential goes only to the origin it was entered for (#556).
  // The URL as a refresh resolves it, so a `.env` URL, which the form can't
  // move, moves nothing.
  const origin = entryOrigin(storageKey, entry, { secrets: secretsAfter(secretOps) });
  if (base && entryOrigin(baseKey, base) !== origin) {
    const kept = movedCredential(base, baseKey, entry, typed);
    if (kept) {
      const label = fieldLabel(type, kept);
      return {
        refused: {
          status: 400,
          error: `The stored ${label} was entered for the old address; re-enter the ${label} for the new address`,
          field: kept,
        },
      };
    }
  }
  for (const op of secretOps) if (op.set) op.origins = originsOnEntry(op.set, op.value, origin);

  return { storageKey, baseKey, base, moving, entry, secretOps, leftBehind };
}

/**
 * The first form field whose stored credential the merged `entry` keeps from
 * `base` (stored under `baseKey`) without its being typed: a password or
 * token the form shows masked (blank keeps it: a keyed secret, a `$secret:`
 * reference or a value typed into services.yaml by hand), or a username that
 * is a reference. Null when there is none.
 */
function movedCredential(base, baseKey, entry, typed) {
  for (const field of ['password', 'token']) {
    if (typed[field]) continue;
    if (!isBlank(base[field]) || hasSecret(keyedSecretName(baseKey, field))) return field;
  }
  return looksLikeSecretRef(entry.username) ? 'username' : null;
}

/**
 * Store a merge's secretOps. setSecret returns false when the secrets manager
 * is uninitialized (no DASH_SECRET); so does this, at the first it can't store.
 */
function storeSecrets(secretOps) {
  for (const op of secretOps) {
    if (op.drop) deleteSecrets(op.drop);
    else if (op.set) {
      if (!setSecret(op.set, op.value, { origins: op.origins })) return false;
    } else if (!copySecret(op.copy, op.to)) deleteSecret(op.to);
  }
  return true;
}

/**
 * What a merge's secretOps would leave under each name they touch, for the
 * connection test to resolve with: a typed credential as typed, for the
 * origins the save stores it for, a moved one as its old name holds it, and a
 * removed one as none (null).
 */
function secretsAfter(secretOps) {
  const after = new Map();
  for (const op of secretOps) {
    if (op.drop) for (const name of op.drop) after.set(name, null);
    else if (op.set) after.set(op.set, { value: op.value, origins: op.origins || [] });
    else {
      after.set(
        op.to,
        hasSecret(op.copy) ? { value: getSecret(op.copy), origins: getSecretOrigins(op.copy) || [] } : null
      );
    }
  }
  return after;
}

router.post('/save', (req, res) => {
  const body = req.body || {};
  const refused = formRefusal(body);
  if (refused) return res.status(refused.status).json(refusalBody(refused));

  // The secret store as it was before this save stored anything, put back
  // unless services.yaml ends up written or needs no write (#502).
  let before = null;
  let committed = false;
  try {
    const read = readConfig();
    // Before any credential is stored: a refused save changes nothing.
    if (read.unusable) return configUnusable(res, read.unusable, read.code);
    const config = read.config || {};
    if (!config.integrations) config.integrations = {};
    const { integrations } = config;

    const merged = mergeForm(config, body);
    if (merged.refused) return res.status(merged.refused.status).json(refusalBody(merged.refused));
    const { storageKey, baseKey, base, moving, entry, secretOps, leftBehind } = merged;

    // From here on, anything short of `committed` puts this back (finally).
    before = snapshotSecrets();

    // Writing entry.password="$secret:…" with no secret stored would persist
    // a config pointing at a credential that was never stored — the
    // integration silently has no credential and fails later with no
    // save-time error. Surface it as a 500 now, matching the standalone
    // secrets route.
    if (!storeSecrets(secretOps)) {
      return apiError(res, 500, 'Secrets manager not initialized (DASH_SECRET missing?)');
    }

    const unchanged = base && !moving && isDeepStrictEqual(entry, base);
    if (!unchanged) {
      // A changed instance name moves the entry: drop it under its old key.
      if (moving) delete integrations[baseKey];
      integrations[storageKey] = entry;
      if (!written(res, config, read.version)) return;
    }
    // Written, or nothing to write: what this save stored stays. The old
    // names go unless another entry uses them (a `$secret:` written by hand).
    committed = true;
    dropUnusedIntegrationSecrets(config, leftBehind);
    // A save is the way to say "try again": the next refresh attempts it even
    // when its login was refused and nothing in it changed (#239).
    retryIntegrationNow(storageKey);

    res.json({ ok: true, type: storageKey });
  } catch (err) {
    apiError(res, 500, 'Failed to save integration', err);
  } finally {
    if (before && !committed) restoreSecrets(before);
  }
});

// ── Test connection (#427) ───────────────────────────────────────────────
//
// The Test button sends what Save sends, and tests what Save would store: the
// form merged into the stored entry by the same merge (mergeForm), handed to
// the handler as the refresh loop hands an entry (integrationInput), then
// resolved and fetched as a refresh does (testIntegration). A typed password
// or token resolves as it will once stored; a blank one, the stored one. So a
// custom integration is tested at its stored endpoint, and a test checks
// exactly what the next refresh will do. Nothing is written: not
// services.yaml, not secrets.json, not a session token or backoff state. The
// same refusals as a save, before anything is fetched: a URL that carries a
// credential (#422), an edit whose entry is gone, a key another integration
// holds.

router.post(
  '/test',
  asyncHandler(async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!testLimiter(ip)) {
      log.warn({ ip }, 'integration test rate-limited');
      return apiError(res, 429, 'Too many connection tests — slow down.');
    }

    // A web app before #427 sent no type for a custom integration.
    const body = { ...(req.body || {}) };
    if (!body.type) body.type = '_custom';
    const refused = formRefusal(body);
    if (refused) return res.status(refused.status).json({ ok: false, ...refusalBody(refused) });

    const read = readConfig();
    if (read.unusable) return configUnusable(res, read.unusable, read.code);
    const merged = mergeForm(read.config || {}, body);
    if (merged.refused) {
      return res.status(merged.refused.status).json({ ok: false, ...refusalBody(merged.refused) });
    }

    const { type, yamlConfig } = integrationInput(merged.storageKey, merged.entry);
    // Audit the probe target (host only, never the credentials in the body).
    let host = yamlConfig.url;
    try {
      host = new URL(yamlConfig.url).host;
    } catch {
      /* keep the raw string if it doesn't parse */
    }
    const result = await testIntegration(type, yamlConfig, {
      secrets: secretsAfter(merged.secretOps),
    });
    log.info({ ip, type, host, ok: !!result.ok }, 'integration connection test');
    res.json(result);
  })
);

// ── Enable / disable ─────────────────────────────────────────────────────
//
// The toggle on an integration's row. It sets `enabled` and nothing else, and
// writes nothing when the integration is already in that state (#402). It used
// to go through /save with the row's URL and username, which rebuilt the entry
// without its target, params, credentials and, for an instance key such as
// adguard_primary, its preset.

router.patch('/:key', (req, res) => {
  const { key } = req.params;
  const body = req.body;
  if (
    !body ||
    typeof body !== 'object' ||
    typeof body.enabled !== 'boolean' ||
    Object.keys(body).length !== 1
  ) {
    return apiError(res, 400, 'Body must be { "enabled": true } or { "enabled": false }');
  }
  const { enabled } = body;

  const { config: read, version, unusable, code } = readConfig();
  if (unusable) return configUnusable(res, unusable, code);
  const config = read || {};
  const integrations = config.integrations || {};
  const entry = storedEntry(integrations, key);
  if (!entry) return apiError(res, 404, `Integration '${key}' not configured`);

  if ((entry.enabled !== false) !== enabled) {
    entry.enabled = enabled;
    if (!written(res, config, version)) return;
  }
  // Enabling is a way to say "try again", as a save is.
  if (enabled) retryIntegrationNow(key);
  res.json({ ok: true, type: key, enabled });
});

// ── Delete ───────────────────────────────────────────────────────────────
//
// Deleting an integration deletes its secrets too (#415): once services.yaml
// is written without the entry, every `integration_<key>_*` secret no other
// entry uses is dropped, so a new integration under the same key starts with
// no credential. A secret another entry names (`$secret:`), or another
// entry's keyed one (`integration_npm_two_*` when `npm` is deleted), stays.
// A write that fails drops nothing. The entry is found by its own key, so
// `constructor` or `__proto__` is not configured.

router.delete('/:type', (req, res) => {
  const { type } = req.params;
  const { config: read, version, unusable, code } = readConfig();
  if (unusable) return configUnusable(res, unusable, code);
  const config = read || {};
  if (!storedEntry(config.integrations || {}, type)) {
    return apiError(res, 404, `Integration '${type}' not configured`);
  }

  delete config.integrations[type];
  if (!written(res, config, version)) return;
  dropUnusedIntegrationSecrets(config, listSecretKeys(), type);
  res.json({ ok: true });
});

export { router as integrationRoutes };
