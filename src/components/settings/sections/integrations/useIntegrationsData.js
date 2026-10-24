import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../../../api/client.js';
import { useToast } from '../../../../context/OverlayContext.jsx';
import { readServerConfig } from '../../readServerConfig.js';

/**
 * useIntegrationsData — fetches presets, configured integrations, and the flat
 * container list used by the target dropdown. Exposes a refetch() for callers
 * that mutate the configured set (save / delete / toggle).
 *
 * `configError` says why the configured set couldn't be read (a services.yaml
 * that doesn't parse names its line, #423): the tab shows it instead of an
 * empty list, which would look like no integration is configured.
 */
export function useIntegrationsData() {
  const toast = useToast();
  const [presets, setPresets] = useState([]);
  const [configured, setConfigured] = useState({});
  const [configError, setConfigError] = useState(null);
  const [allContainers, setAllContainers] = useState([]);
  const [loading, setLoading] = useState(true);

  // `loading` is the first read only: a refetch after a toggle or a save
  // updates the lists in place, so an open row or dialog isn't torn down.
  const refetch = useCallback(async () => {
    try {
      const [presetsRes, read, servicesRes] = await Promise.all([
        apiFetch('/api/integrations/presets').then((r) => (r.ok ? r.json() : [])),
        readServerConfig(),
        apiFetch('/api/services').then((r) => (r.ok ? r.json() : {})),
      ]);
      setPresets(Array.isArray(presetsRes) ? presetsRes : []);
      setConfigError(read.error ?? null);
      setConfigured(read.error ? {} : read.config?.integrations || {});

      // Build flat list of containers with UIDs for the target dropdown
      const containers = [];
      for (const [nodeKey, node] of Object.entries(servicesRes.nodes || {})) {
        for (const svc of node.services || []) {
          containers.push({
            uid: svc.uid || `${nodeKey}:${svc.container}`,
            name: svc.name || svc.container,
            node: node.display_name || nodeKey,
          });
        }
      }
      containers.sort((a, b) => a.name.localeCompare(b.name));
      setAllContainers(containers);
    } catch (err) {
      // A failed fetch would otherwise leave the integrations list silently
      // stale; surface it so the user knows the view may be out of date.
      toast(`Failed to load integrations: ${err.message}`, 'error');
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { presets, configured, configError, allContainers, loading, refetch };
}
