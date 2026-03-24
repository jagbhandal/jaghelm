import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import HelmGrid from '../components/HelmGrid';
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import NodeCard from '../components/NodeCard';
import TodoCard from '../components/TodoCard';
import DroppablePanel from '../components/DroppablePanel';
import ServiceDragOverlay from '../components/ServiceDragOverlay';
import { UPSCard, GiteaActivity, QuickLaunch } from '../components/Widgets';
import { getServices, getUPSStatus, getGiteaActivity, getAllIntegrations, cachedIconUrl } from '../hooks/useData';

/**
 * DashboardView v8 — Phase 3
 * 
 * Key changes from Phase 1:
 * - Node sections driven by /api/services (unified API)
 * - Tier 3 app data now comes from the Integration Engine via GET /api/integrations
 *   instead of hardcoded AdGuard/NPM calls with manual field mapping
 * 
 * What /api/services gives us per node:
 * - Node metrics (CPU, RAM, disk, temp, uptime)
 * - Services array with: container name, display name, icon, status, ping, uptime24, docker stats
 * 
 * What /api/integrations gives us:
 * - Per-integration field data (e.g. { adguard: { Queries: "3,508", Blocked: "282" } })
 * - Matched to containers by name for Tier 3 service card display
 * 
 * What still uses dedicated endpoints:
 * - UPS data (dedicated section, not a service card)
 * - Gitea activity (dedicated section, commit list — will move to integration engine later)
 */

const DEFAULT_LAYOUTS = {
  lg: [
    // 24-column grid — minW:4 = narrowest panel is ~17% of screen (fits 6 across)
    // minH:3 = safety floor, user can resize down to 3 rows (~156px)
    { i: 'node-gateway', x: 0, y: 0, w: 24, h: 7, minW: 4, minH: 3 },
    { i: 'node-production', x: 0, y: 7, w: 24, h: 7, minW: 4, minH: 3 },
    { i: 'node-staging', x: 0, y: 14, w: 12, h: 6, minW: 4, minH: 3 },
    { i: 'ups', x: 12, y: 14, w: 12, h: 5, minW: 4, minH: 3 },
    { i: 'pipeline', x: 0, y: 20, w: 16, h: 5, minW: 4, minH: 3 },
    { i: 'todos', x: 16, y: 20, w: 8, h: 5, minW: 4, minH: 3 },
    { i: 'quicklaunch', x: 0, y: 25, w: 24, h: 4, minW: 4, minH: 2 },
  ],
  md: [
    { i: 'node-gateway', x: 0, y: 0, w: 20, h: 7 },
    { i: 'node-production', x: 0, y: 7, w: 20, h: 7 },
    { i: 'node-staging', x: 0, y: 14, w: 20, h: 6 },
    { i: 'ups', x: 0, y: 20, w: 20, h: 5 },
    { i: 'pipeline', x: 0, y: 25, w: 20, h: 5 },
    { i: 'todos', x: 0, y: 30, w: 20, h: 5 },
    { i: 'quicklaunch', x: 0, y: 35, w: 20, h: 4 },
  ],
};

// Map old section keys to new node-prefixed keys for layout migration
const LEGACY_KEY_MAP = {
  gateway: 'node-gateway',
  production: 'node-production',
  staging: 'node-staging',
};

function migrateLayouts(layouts) {
  if (!layouts) return null;
  const migrated = {};
  let changed = false;
  for (const [bp, items] of Object.entries(layouts)) {
    migrated[bp] = items.map(item => {
      const newKey = LEGACY_KEY_MAP[item.i];
      if (newKey) {
        changed = true;
        return { ...item, i: newKey };
      }
      return item;
    });
  }
  return changed ? migrated : layouts;
}

export default function DashboardView({ config, setConfig, refreshKey }) {
  // HelmGrid manages its own container width internally.
  // We just need isMobile for disabling service card drag on small screens.
  const mobileRef = useRef(null);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const el = mobileRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setIsMobile(el.clientWidth < 480));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Unified service data from /api/services
  const [serviceData, setServiceData] = useState({ nodes: {} });

  // Dedicated section data (not yet in /api/services)
  const [ups, setUps] = useState(null);
  const [commits, setCommits] = useState([]);

  // Phase 3: Integration engine data (replaces hardcoded AdGuard/NPM)
  const [integrationData, setIntegrationData] = useState({});

  // ── Drag-and-drop service cards between panels ──
  // PointerSensor with 8px activation distance prevents accidental drags when clicking
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );
  const [activeDrag, setActiveDrag] = useState(null);

  const handleDragStart = useCallback((event) => {
    const { active } = event;
    if (active?.data?.current?.service) {
      setActiveDrag(active.data.current.service);
    }
  }, []);

  const handleDragEnd = useCallback((event) => {
    setActiveDrag(null);
    const { active, over } = event;
    if (!active || !over) return;

    const uid = active.data?.current?.uid;
    const sourcePanel = active.data?.current?.sourcePanel;
    const targetPanelId = over.data?.current?.panelId;

    if (!uid || !targetPanelId || sourcePanel === targetPanelId) return;

    const customGroups = config.customGroups || [];

    // Case 1: Dropping into a custom group panel
    if (targetPanelId.startsWith('group-')) {
      const targetGroupId = targetPanelId.replace('group-', '');
      const updatedGroups = customGroups.map(g => {
        // Remove from any existing custom group first
        const filtered = (g.containers || []).filter(c => c !== uid);
        // Add to target group
        if (g.id === targetGroupId) {
          return { ...g, containers: [...filtered, uid] };
        }
        return { ...g, containers: filtered };
      });
      setConfig(p => ({ ...p, customGroups: updatedGroups }));
    }
    // Case 2: Dropping back onto a node panel — release from custom group
    else if (targetPanelId.startsWith('node-')) {
      const updatedGroups = customGroups.map(g => ({
        ...g,
        containers: (g.containers || []).filter(c => c !== uid),
      }));
      setConfig(p => ({ ...p, customGroups: updatedGroups }));
    }
  }, [config, setConfig]);

  const handleDragCancel = useCallback(() => {
    setActiveDrag(null);
  }, []);

  // ── Independent data fetches — each updates state immediately when it resolves ──
  // No more Promise.allSettled barrier. Fast data renders instantly.
  // Returns null from fetchJson mean 304 Not Modified — skip setState, no re-render.

  const fetchServices = useCallback(async () => {
    try {
      const data = await getServices();
      if (data !== null) setServiceData(data || { nodes: {} });
    } catch (err) { console.warn('[dashboard] Services fetch failed:', err.message); }
  }, []);

  const fetchSections = useCallback(async () => {
    try {
      const [upsData, giteaData] = await Promise.allSettled([getUPSStatus(), getGiteaActivity()]);
      if (upsData.status === 'fulfilled' && upsData.value !== null) setUps(upsData.value);
      if (giteaData.status === 'fulfilled' && giteaData.value !== null) setCommits(giteaData.value || []);
    } catch (err) { console.warn('[dashboard] Sections fetch failed:', err.message); }
  }, []);

  const fetchIntegrations = useCallback(async () => {
    try {
      const data = await getAllIntegrations();
      if (data !== null) setIntegrationData(data || {});
    } catch (err) { console.warn('[dashboard] Integrations fetch failed:', err.message); }
  }, []);

  // Fetch on mount and on every refreshKey change.
  // All three fire independently — no barriers between them.
  useEffect(() => {
    fetchServices();
    fetchSections();
    fetchIntegrations();
  }, [fetchServices, fetchSections, fetchIntegrations, refreshKey]);

  // Build Tier 3 app data map from integration engine + container matching
  // Two matching modes:
  //   1. Target-scoped: integration has _target field (e.g. "pi:adguard-home") → exact match only
  //   2. Fuzzy: no target → scan all containers for keyword match (original behavior)
  const appDataByContainer = useMemo(() => {
    const map = {};

    // Keywords for fuzzy matching (used when no _target is set)
    const integrationKeywords = {
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

    // Collect all discovered containers with their UIDs for matching
    const allContainers = [];
    for (const [nodeKey, node] of Object.entries(serviceData.nodes || {})) {
      for (const s of (node.services || [])) {
        allContainers.push({ ...s, _nodeKey: nodeKey });
      }
    }

    for (const [intKey, fields] of Object.entries(integrationData)) {
      // Strip internal metadata fields for display
      const displayFields = {};
      for (const [k, v] of Object.entries(fields)) {
        if (!k.startsWith('_')) displayFields[k] = v;
      }
      if (Object.keys(displayFields).length === 0) continue;

      // Mode 1: Target-scoped — exact UID match
      if (fields._target) {
        const targetUid = fields._target;
        for (const svc of allContainers) {
          const uid = svc.uid || `${svc._nodeKey}:${svc.container}`;
          if (uid === targetUid) {
            map[svc.container] = displayFields;
            break;
          }
        }
        continue;
      }

      // Mode 2: Fuzzy keyword match — extract base preset type from storage key
      // e.g. "adguard_primary" → base type "adguard"
      const baseType = intKey.includes('_') ? intKey.split('_')[0] : intKey;
      const keywords = integrationKeywords[baseType] || [baseType];

      for (const svc of allContainers) {
        const containerLower = (svc.container || '').toLowerCase();
        const displayLower = (svc.display_name || '').toLowerCase();

        const matched = keywords.some(kw => {
          const kwLower = kw.toLowerCase();
          return containerLower.includes(kwLower) || displayLower.includes(kwLower);
        });

        if (matched && !map[svc.container]) {
          map[svc.container] = displayFields;
        }
      }
    }
    return map;
  }, [integrationData, serviceData]);

  const sc = config.sections || {};
  const rawLayouts = config.gridLayout || DEFAULT_LAYOUTS;
  const layouts = useMemo(() => migrateLayouts(rawLayouts) || DEFAULT_LAYOUTS, [rawLayouts]);

  const cols = useMemo(() => {
    const lg = config.gridColumns || 24;
    return { lg, md: Math.min(lg, 20), sm: 1 };
  }, [config.gridColumns]);

  // ── Layout persistence ──
  // HelmGrid only fires onLayoutChange after drag/resize completes — no mid-interaction saves.
  const handleLayoutChange = useCallback((_, allLayouts) => {
    setConfig(p => ({ ...p, gridLayout: allLayouts }));
  }, [setConfig]);

  // ── Custom Groups: containers assigned to user-created groups ──
  const customGroups = config.customGroups || [];

  // Build set of containers claimed by custom groups
  // claimedContainers now stores UIDs like "vm103:tailscale"
  const claimedContainers = useMemo(() => {
    const set = new Set();
    for (const group of customGroups) {
      for (const c of (group.containers || [])) {
        set.add(c);
      }
    }
    return set;
  }, [customGroups]);

  // Build a flat lookup of all discovered services (for custom groups to reference)
  // Key is nodeKey:container (e.g. "vm103:tailscale") to handle duplicate container names across nodes
  const allServicesFlat = useMemo(() => {
    const map = {};
    for (const [nodeKey, node] of Object.entries(serviceData.nodes || {})) {
      for (const s of (node.services || [])) {
        const uid = `${nodeKey}:${s.container}`;
        map[uid] = {
          name: s.display_name,
          container: s.container,
          uid,
          node: nodeKey,
          status: s.status,
          uptime: s.uptime24,
          ping: s.ping,
          icon: s.icon,
          docker: s.docker,
          appData: appDataByContainer[s.container] || null,
        };
      }
    }
    return map;
  }, [serviceData, appDataByContainer]);

  // Build node section elements dynamically from service data
  const nodeElements = useMemo(() => {
    const nodes = serviceData.nodes || {};
    return Object.entries(nodes).map(([nodeKey, node]) => {
      // Map to old section config key for backward compat (section colors, icons, etc.)
      // Old keys: "gateway", "production", "staging"
      // The config.sections still uses old keys — the node key from the API matches
      const sectionCfg = sc[nodeKey] || {};
      if (sectionCfg.visible === false) return null;

      const gridKey = `node-${nodeKey}`;
      const borderColor = node.border_color || sectionCfg.borderColor || 'var(--accent)';

      // Build metrics array for NodeCard
      const m = node.metrics || {};
      const metrics = [];

      metrics.push({
        label: 'CPU',
        value: m.cpu,
        unit: '%',
        percent: parseFloat(m.cpu),
      });

      // RAM: show as used/total for nodes with enough RAM, just percent for Pi
      if (m.memTotalGB && parseFloat(m.memTotalGB) > 4) {
        metrics.push({
          label: 'RAM',
          value: `${m.memUsedGB || '—'}/${m.memTotalGB || '—'}`,
          unit: 'GB',
          percent: parseFloat(m.memPercent),
          small: true,
        });
      } else {
        metrics.push({
          label: 'RAM',
          value: m.memPercent,
          unit: '%',
          percent: parseFloat(m.memPercent),
        });
      }

      // Temp (only for nodes that report it, e.g. Pi)
      if (m.temp != null) {
        const tempUnit = config.tempUnit || 'F';
        const tempVal = tempUnit === 'C' ? m.temp : (parseFloat(m.temp) * 9 / 5 + 32).toFixed(1);
        metrics.push({ label: 'Temp', value: tempVal, unit: `°${tempUnit}` });
      }

      // Disk (only if reported) — uses TB when total exceeds 1000 GB
      if (m.diskTotal != null) {
        metrics.push({
          label: 'Disk',
          value: `${m.diskUsed || '—'}/${m.diskTotal || '—'}`,
          unit: m.diskUnit || 'GB',
          percent: parseFloat(m.diskPercent),
          small: true,
        });
      }

      metrics.push({ label: 'Uptime', value: m.uptime, small: true });

      // Transform services for NodeCard/ServiceCard — exclude containers claimed by custom groups
      const services = (node.services || [])
        .filter(s => !claimedContainers.has(`${nodeKey}:${s.container}`))
        .map(s => ({
          name: s.display_name,
          container: s.container,
          uid: `${nodeKey}:${s.container}`,
          node: nodeKey,
          status: s.status,
          uptime: s.uptime24,
          ping: s.ping,
          icon: s.icon,
          docker: s.docker,
          appData: appDataByContainer[s.container] || null,
        }));

      // Proxmox data — show as children inside the PVE node panel
      const proxmoxVms = (nodeKey === 'pve' && integrationData.proxmox?._vms) || null;
      const proxmoxStorage = (nodeKey === 'pve' && integrationData.proxmox?._storagePools) || null;
      const proxmoxBackup = (nodeKey === 'pve' && integrationData.proxmox?._lastBackup) || null;

      return (
        <div key={gridKey}>
          <DroppablePanel panelId={gridKey} disabled={isMobile}>
            <NodeCard
              sectionKey={nodeKey}
              config={config}
              setConfig={setConfig}
              borderColor={borderColor}
              metrics={metrics}
              services={services}
              nodeData={node}
              panelId={gridKey}
              dragDisabled={isMobile}
              >
                {/* ── Proxmox: Virtual Machines ── */}
                {proxmoxVms && proxmoxVms.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div className="stat-label" style={{ marginBottom: 6, paddingLeft: 2, fontSize: 9 }}>Virtual Machines</div>
                    <div className="pve-vm-grid">
                      {proxmoxVms.map(vm => {
                        const isRunning = vm.status === 'running';
                        const isPaused = vm.status === 'paused';
                        const statusColor = isRunning ? 'var(--green)' : isPaused ? 'var(--amber)' : 'var(--red)';
                        const memPercent = vm.memTotalGB && parseFloat(vm.memTotalGB) > 0
                          ? ((parseFloat(vm.memUsedGB) / parseFloat(vm.memTotalGB)) * 100)
                          : 0;
                        return (
                          <div key={vm.vmid} style={{
                            background: 'var(--bg-card-inner)', border: '1px solid var(--border-color)',
                            borderRadius: 12, padding: '10px 12px',
                            borderLeft: `3px solid ${statusColor}`,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{
                                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                                background: statusColor, boxShadow: `0 0 6px ${statusColor}`,
                              }} />
                              <span style={{
                                fontFamily: 'var(--font-body)', fontSize: 'var(--fs-service-name)', fontWeight: 500,
                                flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}>{vm.name}</span>
                              <span style={{
                                fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-service-badge)', padding: '2px 5px',
                                borderRadius: 4, textTransform: 'uppercase', fontWeight: 500,
                                background: isRunning ? 'var(--green-bg)' : isPaused ? 'var(--amber-bg)' : 'var(--red-bg)',
                                color: statusColor,
                                border: `1px solid ${isRunning ? 'var(--green-border)' : isPaused ? 'var(--amber-border)' : 'var(--red-border)'}`,
                              }}>{vm.status}</span>
                            </div>
                            <div style={{
                              display: 'flex', gap: 8, marginTop: 6, justifyContent: 'center',
                            }}>
                              <div className="stat-box" style={{ padding: '4px 8px' }}>
                                <div className="stat-value">{vm.maxcpu}</div>
                                <div className="stat-label" style={{ marginTop: 1 }}>vCPU</div>
                              </div>
                              <div className="stat-box" style={{ padding: '4px 8px' }}>
                                <div className="stat-value">{vm.vmid}</div>
                                <div className="stat-label" style={{ marginTop: 1 }}>VMID</div>
                              </div>
                            </div>
                            {/* RAM usage per VM */}
                            {vm.memUsedGB && vm.memTotalGB && (
                              <div style={{ marginTop: 6, padding: '0 2px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
                                  <span className="stat-label">RAM</span>
                                  <span className="text-mono text-secondary" style={{ fontSize: 10 }}>{vm.memUsedGB}/{vm.memTotalGB} GB</span>
                                </div>
                                <div style={{
                                  height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden',
                                }}>
                                  <div style={{
                                    height: '100%', borderRadius: 2,
                                    width: `${Math.min(memPercent, 100)}%`,
                                    background: memPercent > 90 ? 'var(--red)' : memPercent > 70 ? 'var(--amber)' : borderColor || 'var(--accent)',
                                    transition: 'width 0.3s ease',
                                  }} />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Proxmox: Storage Pools ── */}
                {proxmoxStorage && proxmoxStorage.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{
                      fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)',
                      letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6, paddingLeft: 2,
                    }}>Storage Pools</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {proxmoxStorage.map(pool => (
                        <div key={pool.name} style={{
                          background: 'var(--bg-card-inner)', border: '1px solid var(--border-color)',
                          borderRadius: 10, padding: '8px 12px',
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500 }}>{pool.name}</span>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{pool.type}</span>
                            </div>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                              {pool.usedGB}/{pool.totalGB} GB
                            </span>
                          </div>
                          <div style={{
                            height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden',
                          }}>
                            <div style={{
                              height: '100%', borderRadius: 3,
                              width: `${Math.min(pool.percent, 100)}%`,
                              background: pool.percent > 90 ? 'var(--red)' : pool.percent > 70 ? 'var(--amber)' : borderColor || 'var(--accent)',
                              transition: 'width 0.3s ease',
                            }} />
                          </div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginTop: 3, textAlign: 'right' }}>
                            {pool.percent}%
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Proxmox: Backup Status ── */}
                {proxmoxBackup && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{
                      fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)',
                      letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6, paddingLeft: 2,
                    }}>Backups</div>
                    <div style={{
                      background: 'var(--bg-card-inner)', border: '1px solid var(--border-color)',
                      borderRadius: 10, padding: '10px 14px',
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                      <span style={{
                        fontSize: 16,
                        filter: proxmoxBackup.ok ? 'none' : 'grayscale(1)',
                      }}>
                        {proxmoxBackup.ok ? '✓' : '✕'}
                      </span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                          Last backup: {proxmoxBackup.ago || 'unknown'}
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                          {proxmoxBackup.vmCount > 0 ? `${proxmoxBackup.vmCount} VM${proxmoxBackup.vmCount > 1 ? 's' : ''} backed up` : 'No VMs in batch'}
                        </div>
                      </div>
                      <span style={{
                        fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 8px',
                        borderRadius: 4, fontWeight: 500,
                        background: proxmoxBackup.ok ? 'var(--green-bg)' : 'var(--red-bg)',
                        color: proxmoxBackup.ok ? 'var(--green)' : 'var(--red)',
                        border: `1px solid ${proxmoxBackup.ok ? 'var(--green-border)' : 'var(--red-border)'}`,
                      }}>
                        {proxmoxBackup.ok ? 'OK' : proxmoxBackup.status || 'FAILED'}
                      </span>
                    </div>
                  </div>
                )}
            </NodeCard>
          </DroppablePanel>
        </div>
      );
    }).filter(Boolean);
  }, [serviceData, sc, config, setConfig, appDataByContainer, claimedContainers, integrationData, isMobile]);

  // Build custom group panel elements
  const customGroupElements = useMemo(() => {
    return customGroups.map(group => {
      const groupCfg = sc[`group-${group.id}`] || {};
      if (groupCfg.visible === false) return null;
      const gridKey = `group-${group.id}`;
      const borderColor = group.borderColor || 'var(--accent)';
      const services = (group.containers || [])
        .map(c => allServicesFlat[c])
        .filter(Boolean);

      return (
        <div key={gridKey}>
          <DroppablePanel panelId={gridKey} disabled={isMobile}>
            <NodeCard
              sectionKey={`group-${group.id}`}
              config={config}
              setConfig={setConfig}
              borderColor={borderColor}
              metrics={null}
              services={services}
              nodeData={{ display_name: group.title, icon: group.icon || cachedIconUrl('https://cdn.jsdelivr.net/gh/marella/material-design-icons@latest/svg/folder_special/outline.svg'), subtitle: `${services.length} services` }}
              panelId={gridKey}
              dragDisabled={isMobile}
            />
          </DroppablePanel>
        </div>
      );
    }).filter(Boolean);
  }, [customGroups, allServicesFlat, sc, config, setConfig, isMobile]);

  // Ensure layouts have entries for all dynamic node sections + custom groups and enforce min constraints
  // CRITICAL: Use a ref to stabilize the object reference. Only produce a new object when
  // layout content actually changes. This prevents RGL's compactor from rearranging on every
  // 30-second data refresh.
  const prevEffectiveRef = useRef(null);
  const effectiveLayouts = useMemo(() => {
    const nodeKeys = Object.keys(serviceData.nodes || {}).map(k => `node-${k}`);
    const groupKeys = customGroups.map(g => `group-${g.id}`);
    const allDynamicKeys = [...nodeKeys, ...groupKeys];
    const result = {};
    const lgCols = config.gridColumns || 24;

    // Process lg and md breakpoints from saved/default layouts
    for (const [bp, items] of Object.entries(layouts)) {
      const constrained = items.map(item => ({
        ...item,
        minW: bp === 'sm' ? 1 : (item.minW || 4),
        minH: item.minH || 3,
      }));

      const existingKeys = new Set(constrained.map(i => i.i));
      const missing = allDynamicKeys.filter(k => !existingKeys.has(k));
      // Add missing nodes at the bottom
      let maxY = constrained.reduce((max, i) => Math.max(max, i.y + i.h), 0);
      const newItems = missing.map(k => ({
        i: k, x: 0, y: maxY++,
        w: bp === 'lg' ? lgCols : bp === 'md' ? Math.min(lgCols, 20) : 1,
        h: 6,
        minW: bp === 'sm' ? 1 : 4,
        minH: 3,
      }));
      result[bp] = [...constrained, ...newItems];
    }

    // ── Auto-generate sm (mobile) breakpoint from lg layout ──
    if (!result.sm) {
      const lgItems = result.lg || result.md || [];
      const sorted = [...lgItems].sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);
      let smY = 0;
      result.sm = sorted.map(item => {
        const h = item.h || 4;
        const entry = { i: item.i, x: 0, y: smY, w: 1, h, minW: 1, minH: 3 };
        smY += h;
        return entry;
      });
    }

    // Only return a new object if the layout actually changed
    if (prevEffectiveRef.current) {
      const prev = prevEffectiveRef.current;
      const same = Object.keys(result).every(bp => {
        const a = result[bp];
        const b = prev[bp];
        if (!b || a.length !== b.length) return false;
        return a.every((item, idx) =>
          item.i === b[idx].i && item.x === b[idx].x && item.y === b[idx].y &&
          item.w === b[idx].w && item.h === b[idx].h &&
          item.minH === b[idx].minH
        );
      });
      if (same) return prev;
    }

    prevEffectiveRef.current = result;
    return result;
  }, [layouts, serviceData, customGroups, config.gridColumns]);

  // Auto-scroll when dragging panels near viewport edges (RGL)
  const scrollRAF = useRef(null);
  const handlePanelDrag = useCallback((layout, oldItem, newItem, placeholder, e) => {
    if (scrollRAF.current) cancelAnimationFrame(scrollRAF.current);
    const EDGE = 80;
    const SPEED = 15;
    const y = e?.clientY ?? 0;
    const vh = window.innerHeight;
    if (y > vh - EDGE) {
      const doScroll = () => { window.scrollBy(0, SPEED); scrollRAF.current = requestAnimationFrame(doScroll); };
      scrollRAF.current = requestAnimationFrame(doScroll);
    } else if (y < EDGE) {
      const doScroll = () => { window.scrollBy(0, -SPEED); scrollRAF.current = requestAnimationFrame(doScroll); };
      scrollRAF.current = requestAnimationFrame(doScroll);
    }
  }, []);
  const handlePanelDragStop = useCallback(() => {
    if (scrollRAF.current) { cancelAnimationFrame(scrollRAF.current); scrollRAF.current = null; }
  }, []);
  const handlePanelResizeStop = useCallback(() => {
    // HelmGrid handles layout save via onLayoutChange — nothing extra needed here
  }, []);

  // Welcome message config
  const wm = config.welcomeMessage || {};


  
  return (
    <div className="dashboard-content" ref={mobileRef}>
      {/* Welcome message banner */}
      {wm.enabled && wm.text && (
        <div className="welcome-banner">
          <div className="welcome-text" style={{ fontSize: wm.fontSize || 20 }}>
            {wm.text}
          </div>
          {wm.description && (
            <div className="welcome-desc" style={{
              fontSize: Math.max((wm.fontSize || 20) * 0.6, 12),
            }}>
              {wm.description}
            </div>
          )}
        </div>
      )}
      {/* HelmGrid handles its own width measurement and mount state */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <HelmGrid
          className="layout"
          layouts={effectiveLayouts}
          breakpoints={{ lg: 1200, md: 768, sm: 480 }}
          cols={cols}
          rowHeight={36}
          margin={isMobile ? [12, 12] : [16, 16]}
          draggable={!isMobile}
          dragHandle=".section-header"
          resizable={!isMobile}
          onLayoutChange={handleLayoutChange}
          onDrag={handlePanelDrag}
          onDragStop={handlePanelDragStop}
          onResizeStop={handlePanelResizeStop}
        >
          {/* Dynamic node sections */}
          {nodeElements}

          {/* Placeholders for node panels that exist in saved layout but haven't loaded yet */}
          {(() => {
            const loadedNodeKeys = new Set(Object.keys(serviceData.nodes || {}).map(k => `node-${k}`));
            const savedKeys = (layouts.lg || layouts.md || []).map(i => i.i).filter(k => k.startsWith('node-'));
            return savedKeys
              .filter(k => !loadedNodeKeys.has(k))
              .map(k => (
                <div key={k}>
                  <div className="glass-card node-card node-placeholder">
                    <div className="section-header">
                      <div className="node-placeholder-text">
                        Loading {k.replace('node-', '')}…
                      </div>
                    </div>
                  </div>
                </div>
              ));
          })()}

          {/* Custom groups */}
          {customGroupElements}

          {/* Static sections */}
          {sc.ups?.visible !== false && (
            <div key="ups">
              <UPSCard upsData={ups} borderColor={sc.ups?.borderColor} config={config} />
            </div>
          )}
          {sc.pipeline?.visible !== false && (
            <div key="pipeline">
              <GiteaActivity commits={commits} config={config} />
            </div>
          )}
          {sc.todos?.visible !== false && (
            <div key="todos">
              <TodoCard borderColor={sc.todos?.borderColor} config={config} setConfig={setConfig} />
            </div>
          )}
          {sc.quicklaunch?.visible !== false && (
            <div key="quicklaunch">
              <QuickLaunch config={config} borderColor={sc.quicklaunch?.borderColor} />
            </div>
          )}
        </HelmGrid>
        <DragOverlay dropAnimation={null}>
          {activeDrag ? <ServiceDragOverlay service={activeDrag} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
