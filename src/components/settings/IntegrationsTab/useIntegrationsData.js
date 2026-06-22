import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../../api/client.js';
import { useToast } from '../../../context/OverlayContext.jsx';

/**
 * useIntegrationsData — fetches presets, configured integrations, and the flat
 * container list used by the target dropdown. Exposes a refetch() for callers
 * that mutate the configured set (save / delete / toggle).
 */
export function useIntegrationsData() {
  const toast = useToast();
  const [presets, setPresets] = useState([]);
  const [configured, setConfigured] = useState({});
  const [allContainers, setAllContainers] = useState([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const [presetsRes, configRes, servicesRes] = await Promise.all([
        apiFetch('/api/integrations/presets').then(r => r.ok ? r.json() : []),
        apiFetch('/api/services/config').then(r => r.ok ? r.json() : {}),
        apiFetch('/api/services').then(r => r.ok ? r.json() : {}),
      ]);
      setPresets(presetsRes);
      setConfigured(configRes?.integrations || {});

      // Build flat list of containers with UIDs for the target dropdown
      const containers = [];
      for (const [nodeKey, node] of Object.entries(servicesRes.nodes || {})) {
        for (const svc of (node.services || [])) {
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

  useEffect(() => { refetch(); }, [refetch]);

  return { presets, configured, allContainers, loading, refetch };
}
