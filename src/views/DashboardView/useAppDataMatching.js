import { useMemo } from 'react';

/**
 * Maps integration data (from /api/integrations) onto discovered containers.
 *
 * Two matching modes:
 *   1. Target-scoped — when the integration config has a `_target` field
 *      (e.g. "pi:adguard-home"), the data is mapped to that exact container.
 *   2. Fuzzy — when no `_target` is set, the integration's preset type is
 *      matched against container names by keyword. Exact name match wins;
 *      partial/substring match is the fallback.
 *
 * Returns: { [containerName]: { ...displayFields } }
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
      all.push({ ...s, _nodeKey: nodeKey });
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
  for (const svc of allContainers) {
    const uid = svc.uid || `${svc._nodeKey}:${svc.container}`;
    if (uid === targetUid) return svc;
  }
  return null;
}

function findByKeywords(allContainers, keywords, alreadyMatched) {
  // First pass: exact container-name match
  for (const svc of allContainers) {
    const containerLower = (svc.container || '').toLowerCase();
    if (
      keywords.some((kw) => containerLower === kw.toLowerCase()) &&
      !alreadyMatched[svc.container]
    ) {
      return svc;
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
    if (matched && !alreadyMatched[svc.container]) return svc;
  }
  return null;
}

export function useAppDataMatching(integrationData, serviceData) {
  return useMemo(() => {
    const map = {};
    const allContainers = flattenContainers(serviceData);

    for (const [intKey, fields] of Object.entries(integrationData)) {
      const displayFields = stripInternalFields(fields);
      // Carry the last redacted fetch error so the card can answer "why is this
      // dashed?" — an errored integration has only `_`-fields (empty display),
      // so without this it was skipped and the error was dropped on the floor.
      const doctor = fields._error ? { error: fields._error } : null;
      if (Object.keys(displayFields).length === 0 && !doctor) continue;
      const appEntry = doctor ? { ...displayFields, _doctor: doctor } : displayFields;

      // Mode 1: target-scoped
      if (fields._target) {
        const svc = findByTarget(allContainers, fields._target);
        if (svc) map[svc.container] = appEntry;
        continue;
      }

      // Mode 2: fuzzy keyword match
      // Strip instance suffix: "adguard_primary" → "adguard"
      const baseType = intKey.includes('_') ? intKey.split('_')[0] : intKey;
      const keywords = INTEGRATION_KEYWORDS[baseType] || [baseType];

      const match = findByKeywords(allContainers, keywords, map);
      if (match) map[match.container] = appEntry;
    }

    return map;
  }, [integrationData, serviceData]);
}
