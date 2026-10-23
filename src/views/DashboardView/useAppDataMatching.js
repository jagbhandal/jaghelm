import { useMemo } from 'react';

/**
 * Maps integration data (from /api/integrations) onto discovered services, for
 * the Overview's Services section (#300).
 *
 * Two matching modes:
 *   1. Target-scoped — when the integration config has a `_target` field
 *      (e.g. "pi:adguard-home"), the data is mapped to that exact container.
 *   2. Fuzzy — when no `_target` is set, the integration's preset type is
 *      matched against container names by keyword. Exact name match wins;
 *      partial/substring match is the fallback.
 *
 * Returns: { [uid]: { ...displayFields } }, keyed by the service's uid
 * ("node:container"), so a container of one name on two nodes (AdGuard on
 * both gateways) is two services, each with its own numbers or none.
 * Internal `_target`, `_instance`, `_vms`, etc. fields are stripped.
 */

// Keywords for fuzzy matching (used when an integration has no _target set).
const INTEGRATION_KEYWORDS = {
  adguard: ['adguard'],
  npm: ['nginx-proxy-manager', 'npm', 'nginxproxymanager'],
  plex: ['plex'],
  sonarr: ['sonarr'],
  radarr: ['radarr'],
  pihole: ['pihole', 'pi-hole'],
  jellyfin: ['jellyfin'],
  portainer: ['portainer'],
  grafana: ['grafana'],
  gitea: ['gitea'],
  nextcloud: ['nextcloud'],
  vaultwarden: ['vaultwarden'],
  homeassistant: ['homeassistant', 'home-assistant', 'hass'],
  immich: ['immich'],
  paperless: ['paperless'],
  photoprism: ['photoprism'],
};

function flattenContainers(serviceData) {
  const all = [];
  for (const [nodeKey, node] of Object.entries(serviceData.nodes || {})) {
    for (const s of node.services || []) {
      all.push({ ...s, _nodeKey: nodeKey, _uid: s.uid || `${nodeKey}:${s.container}` });
    }
  }
  return all;
}

function stripInternalFields(fields) {
  const display = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!k.startsWith('_')) display[k] = v;
  }
  return display;
}

function findByTarget(allContainers, targetUid) {
  return allContainers.find((svc) => svc._uid === targetUid) ?? null;
}

function findByKeywords(allContainers, keywords, alreadyMatched) {
  // Prefer an unclaimed container (fall-through: when several containers match
  // the keywords, distinct integrations land on distinct containers). But if
  // every matching container is already claimed, still return the first match so
  // the caller can detect the collision and resolve it by precedence — rather
  // than silently returning null and dropping the integration with no signal.
  let claimedFallback = null;

  const consider = (svc) => {
    if (!alreadyMatched[svc._uid]) return svc; // unclaimed — take it now
    if (!claimedFallback) claimedFallback = svc; // remember first claimed match
    return null;
  };

  // First pass: exact container-name match
  for (const svc of allContainers) {
    const containerLower = (svc.container || '').toLowerCase();
    if (keywords.some((kw) => containerLower === kw.toLowerCase())) {
      const hit = consider(svc);
      if (hit) return hit;
    }
  }
  // Second pass: substring match against container name OR display name
  for (const svc of allContainers) {
    const containerLower = (svc.container || '').toLowerCase();
    const displayLower = (svc.display_name || '').toLowerCase();
    const matched = keywords.some((kw) => {
      const kwLower = kw.toLowerCase();
      return containerLower.includes(kwLower) || displayLower.includes(kwLower);
    });
    if (matched) {
      const hit = consider(svc);
      if (hit) return hit;
    }
  }
  return claimedFallback;
}

// Precedence when two integrations resolve to the SAME container. Higher wins.
// An explicit `_target` (operator pinned this integration to this container) beats
// a fuzzy name guess. Within the same tier, the FIRST integration in
// integrationData key-iteration order wins — deterministic regardless of how the
// keys happen to be ordered, so metrics don't flip between refreshes.
const PRECEDENCE = { target: 2, fuzzy: 1 };

/**
 * Which integration each service's numbers come from: `{ [uid]: integration
 * key }`, by the two modes above and their precedence. The hook below turns it
 * into each service's fields; the detail drawer (#310) reads it to name the
 * integration over its stats.
 */
export function integrationClaims(integrationData, serviceData) {
  // Per-service claim record so collisions resolve deterministically instead
  // of last-write-wins. { [uid]: { tier, intKey } }
  const claims = {};
  const allContainers = flattenContainers(serviceData || {});

  // Record a claim, honoring precedence.
  const claim = (uid, tier, intKey) => {
    const prior = claims[uid];
    if (prior) {
      // Two integrations want the same container. Keep the higher-precedence
      // one; on a tie keep the earlier (already-recorded) one. Either way warn
      // in dev so the ambiguous config is fixable, instead of silently picking.
      const incomingWins = PRECEDENCE[tier] > PRECEDENCE[prior.tier];
      if (import.meta.env.DEV) {
        const kept = incomingWins ? intKey : prior.intKey;
        const dropped = incomingWins ? prior.intKey : intKey;
        console.warn(
          `[useAppDataMatching] container "${uid}" matched by multiple ` +
            `integrations ("${prior.intKey}" and "${intKey}"); keeping "${kept}" ` +
            `(${incomingWins ? tier : prior.tier}), dropping "${dropped}". ` +
            `Set a Target Container to disambiguate.`
        );
      }
      if (!incomingWins) return;
    }
    claims[uid] = { tier, intKey };
  };

  for (const [intKey, fields] of Object.entries(integrationData || {})) {
    if (!fields || typeof fields !== 'object') continue;
    // An integration with nothing to show (no display field, no error) claims nothing.
    if (Object.keys(stripInternalFields(fields)).length === 0 && !fields._error) continue;

    // Mode 1: target-scoped
    if (fields._target) {
      const svc = findByTarget(allContainers, fields._target);
      if (svc) claim(svc._uid, 'target', intKey);
      continue;
    }

    // Mode 2: fuzzy keyword match
    // Strip instance suffix: "adguard_primary" → "adguard"
    const baseType = intKey.includes('_') ? intKey.split('_')[0] : intKey;
    const keywords = INTEGRATION_KEYWORDS[baseType] || [baseType];

    const match = findByKeywords(allContainers, keywords, claims);
    if (match) claim(match._uid, 'fuzzy', intKey);
  }

  return Object.fromEntries(Object.entries(claims).map(([uid, c]) => [uid, c.intKey]));
}

/**
 * An integration's fields as a service shows them: its display fields, and
 * its last redacted fetch error as `_doctor`, so the card can answer "why is
 * this dashed?" (an errored integration has only `_`-fields).
 */
export function appEntryOf(fields) {
  const displayFields = stripInternalFields(fields);
  return fields._error ? { ...displayFields, _doctor: { error: fields._error } } : displayFields;
}

export function useAppDataMatching(integrationData, serviceData) {
  return useMemo(() => {
    const claims = integrationClaims(integrationData, serviceData);
    return Object.fromEntries(
      Object.entries(claims).map(([uid, intKey]) => [uid, appEntryOf(integrationData[intKey])])
    );
  }, [integrationData, serviceData]);
}
