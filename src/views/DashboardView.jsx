import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Responsive, useContainerWidth } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import NodeCard from '../components/NodeCard';
import TodoCard from '../components/TodoCard';
import { UPSCard, GiteaActivity, QuickLaunch } from '../components/Widgets';
import { getServices, getUPSStatus, getGiteaActivity, getAllIntegrations } from '../hooks/useData';

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
    // Node sections are generated dynamically, but we need default positions
    // for known nodes + the static sections
    { i: 'node-gateway', x: 0, y: 0, w: 12, h: 7, minW: 4, minH: 3 },
    { i: 'node-production', x: 0, y: 7, w: 12, h: 7, minW: 4, minH: 3 },
    { i: 'node-staging', x: 0, y: 14, w: 6, h: 6, minW: 4, minH: 3 },
    { i: 'ups', x: 6, y: 14, w: 6, h: 5, minW: 4, minH: 3 },
    { i: 'pipeline', x: 0, y: 20, w: 8, h: 5, minW: 4, minH: 3 },
    { i: 'todos', x: 8, y: 20, w: 4, h: 5, minW: 3, minH: 3 },
    { i: 'quicklaunch', x: 0, y: 25, w: 12, h: 4, minW: 4, minH: 2 },
  ],
  md: [
    { i: 'node-gateway', x: 0, y: 0, w: 10, h: 7 },
    { i: 'node-production', x: 0, y: 7, w: 10, h: 7 },
    { i: 'node-staging', x: 0, y: 14, w: 10, h: 6 },
    { i: 'ups', x: 0, y: 20, w: 10, h: 5 },
    { i: 'pipeline', x: 0, y: 25, w: 10, h: 5 },
    { i: 'todos', x: 0, y: 30, w: 10, h: 5 },
    { i: 'quicklaunch', x: 0, y: 35, w: 10, h: 4 },
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
  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 1200 });

  // Unified service data from /api/services
  const [serviceData, setServiceData] = useState({ nodes: {} });

  // Dedicated section data (not yet in /api/services)
  const [ups, setUps] = useState(null);
  const [commits, setCommits] = useState([]);

  // Phase 3: Integration engine data (replaces hardcoded AdGuard/NPM)
  const [integrationData, setIntegrationData] = useState({});

  const fetchAll = useCallback(async (bust) => {
    const b = bust || false;
    const r = await Promise.allSettled([
      getServices(b),
      getUPSStatus(b),
      getGiteaActivity(b),
      getAllIntegrations(b),
    ]);
    if (r[0].status === 'fulfilled') setServiceData(r[0].value || { nodes: {} });
    if (r[1].status === 'fulfilled') setUps(r[1].value);
    if (r[2].status === 'fulfilled') setCommits(r[2].value || []);
    if (r[3].status === 'fulfilled') setIntegrationData(r[3].value || {});
  }, []);

  const isInitialRef = useRef(true);
  useEffect(() => {
    if (isInitialRef.current) {
      isInitialRef.current = false;
      fetchAll(false);
    } else {
      fetchAll(true);
    }
  }, [fetchAll, refreshKey]);

  // Build Tier 3 app data map from integration engine + fuzzy container matching
  // For each integration type, scan all discovered services and match by checking if
  // the container name or display name contains any of the integration's keywords.
  // This handles renamed containers, display name overrides, and compose prefixes.
  const appDataByContainer = useMemo(() => {
    const map = {};

    // Keywords that identify which container belongs to which integration.
    // The integration type key itself is always included as a keyword.
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

    // Collect all discovered containers (name + display_name) for matching
    const allContainers = [];
    for (const node of Object.values(serviceData.nodes || {})) {
      for (const s of (node.services || [])) {
        allContainers.push(s);
      }
    }

    for (const [intType, fields] of Object.entries(integrationData)) {
      const keywords = integrationKeywords[intType] || [intType];

      for (const svc of allContainers) {
        // Check container name and display name (case-insensitive partial match)
        const containerLower = (svc.container || '').toLowerCase();
        const displayLower = (svc.display_name || '').toLowerCase();

        const matched = keywords.some(kw => {
          const kwLower = kw.toLowerCase();
          return containerLower.includes(kwLower) || displayLower.includes(kwLower);
        });

        if (matched && !map[svc.container]) {
          map[svc.container] = fields;
        }
      }
    }
    return map;
  }, [integrationData, serviceData]);

  const sc = config.sections || {};
  const rawLayouts = config.gridLayout || DEFAULT_LAYOUTS;
  const layouts = useMemo(() => migrateLayouts(rawLayouts) || DEFAULT_LAYOUTS, [rawLayouts]);

  const cols = useMemo(() => (
    config.gridColumns
      ? { lg: config.gridColumns, md: Math.min(config.gridColumns, 10), sm: 1 }
      : { lg: 12, md: 10, sm: 1 }
  ), [config.gridColumns]);

  // ── Layout persistence — User-interaction gated ──
  // RGL fires onLayoutChange on mount, prop changes, AND after user drag/resize.
  // The compactor also fires it when rearranging panels.
  // We ONLY save when the user actually dragged or resized something.
  // This prevents compactor noise from overwriting the saved layout.
  const userInteractedRef = useRef(false);

  const handleLayoutChange = useCallback((_, allLayouts) => {
    if (!userInteractedRef.current) return; // Ignore compactor/mount fires
    userInteractedRef.current = false; // Reset flag
    setConfig(p => ({ ...p, gridLayout: allLayouts }));
  }, [setConfig]);

  // Set the flag when user starts dragging or resizing
  const handleDragStart = useCallback(() => {
    userInteractedRef.current = true;
  }, []);
  const handleResizeStart = useCallback(() => {
    userInteractedRef.current = true;
  }, []);

  // ── Custom Groups: containers assigned to user-created groups ──
  const customGroups = config.customGroups || [];

  // Build set of containers claimed by custom groups
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
  const allServicesFlat = useMemo(() => {
    const map = {};
    for (const node of Object.values(serviceData.nodes || {})) {
      for (const s of (node.services || [])) {
        map[s.container] = {
          name: s.display_name,
          container: s.container,
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

      // Disk (only if reported)
      if (m.diskTotalGB != null) {
        metrics.push({
          label: 'Disk',
          value: `${m.diskUsedGB || '—'}/${m.diskTotalGB || '—'}`,
          unit: 'GB',
          percent: parseFloat(m.diskPercent),
          small: true,
        });
      }

      metrics.push({ label: 'Uptime', value: m.uptime, small: true });

      // Transform services for NodeCard/ServiceCard — exclude containers claimed by custom groups
      const services = (node.services || [])
        .filter(s => !claimedContainers.has(s.container))
        .map(s => ({
          name: s.display_name,
          container: s.container,
          status: s.status,
          uptime: s.uptime24,
          ping: s.ping,
          icon: s.icon,
          docker: s.docker,
          appData: appDataByContainer[s.container] || null,
        }));

      // Proxmox VM cards — show as children inside the PVE node panel
      const proxmoxVms = (nodeKey === 'pve' && integrationData.proxmox?._vms) || null;

      return (
        <div key={gridKey}>
          <NodeCard
            sectionKey={nodeKey}
            config={config}
            setConfig={setConfig}
            borderColor={borderColor}
            metrics={metrics}
            services={services}
            nodeData={node}
          >
            {proxmoxVms && proxmoxVms.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)',
                  letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6, paddingLeft: 2,
                }}>Virtual Machines</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                  {proxmoxVms.map(vm => {
                    const isRunning = vm.status === 'running';
                    const isPaused = vm.status === 'paused';
                    const statusColor = isRunning ? 'var(--green)' : isPaused ? 'var(--amber)' : 'var(--red)';
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
                          <div style={{
                            textAlign: 'center', padding: '4px 8px',
                            background: 'rgba(255,255,255,0.03)', borderRadius: 6,
                            border: '1px solid rgba(255,255,255,0.04)', flex: 1,
                          }}>
                            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--fs-service-stat-value)', color: 'var(--text-primary)' }}>{vm.maxcpu}</div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-service-stat-label)', color: 'var(--text-secondary)', letterSpacing: 1, textTransform: 'uppercase', marginTop: 1 }}>vCPU</div>
                          </div>
                          <div style={{
                            textAlign: 'center', padding: '4px 8px',
                            background: 'rgba(255,255,255,0.03)', borderRadius: 6,
                            border: '1px solid rgba(255,255,255,0.04)', flex: 1,
                          }}>
                            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--fs-service-stat-value)', color: 'var(--text-primary)' }}>{vm.vmid}</div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-service-stat-label)', color: 'var(--text-secondary)', letterSpacing: 1, textTransform: 'uppercase', marginTop: 1 }}>VMID</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </NodeCard>
        </div>
      );
    }).filter(Boolean);
  }, [serviceData, sc, config, setConfig, appDataByContainer, claimedContainers, integrationData]);

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
          <NodeCard
            sectionKey={`group-${group.id}`}
            config={config}
            setConfig={setConfig}
            borderColor={borderColor}
            metrics={null}
            services={services}
            nodeData={{ display_name: group.title, icon: group.icon || '📂', subtitle: `${services.length} services` }}
          />
        </div>
      );
    }).filter(Boolean);
  }, [customGroups, allServicesFlat, sc, config, setConfig]);

  // Ensure layouts have entries for all dynamic node sections + custom groups and enforce min constraints
  // CRITICAL: Use a ref to stabilize the object reference. Only produce a new object when
  // layout content actually changes. This prevents RGL's compactor from rearranging on every
  // 30-second data refresh.
  const prevEffectiveRef = useRef(null);
  const effectiveLayouts = useMemo(() => {
    // Build constraint map from defaults
    const constraints = {};
    for (const item of DEFAULT_LAYOUTS.lg) {
      constraints[item.i] = { minW: item.minW, minH: item.minH };
    }

    const nodeKeys = Object.keys(serviceData.nodes || {}).map(k => `node-${k}`);
    const groupKeys = customGroups.map(g => `group-${g.id}`);
    const allDynamicKeys = [...nodeKeys, ...groupKeys];
    const result = {};
    for (const [bp, items] of Object.entries(layouts)) {
      // Apply min constraints from defaults to saved layout items
      const constrained = items.map(item => {
        const c = constraints[item.i];
        if (c) {
          return { ...item, minW: c.minW, minH: c.minH };
        }
        return item;
      });

      const existingKeys = new Set(constrained.map(i => i.i));
      const missing = allDynamicKeys.filter(k => !existingKeys.has(k));
      // Add missing nodes at the bottom
      let maxY = constrained.reduce((max, i) => Math.max(max, i.y + i.h), 0);
      const newItems = missing.map(k => ({
        i: k, x: 0, y: maxY++, w: bp === 'lg' ? 12 : 10, h: 6, minW: 4, minH: 3,
      }));
      result[bp] = [...constrained, ...newItems];
    }

    // Only return a new object if the layout actually changed
    // This prevents RGL from re-running compactor on every data refresh
    if (prevEffectiveRef.current) {
      const prev = prevEffectiveRef.current;
      const same = Object.keys(result).every(bp => {
        const a = result[bp];
        const b = prev[bp];
        if (!b || a.length !== b.length) return false;
        return a.every((item, idx) =>
          item.i === b[idx].i && item.x === b[idx].x && item.y === b[idx].y &&
          item.w === b[idx].w && item.h === b[idx].h
        );
      });
      if (same) return prev; // Return same reference — RGL won't re-render
    }

    prevEffectiveRef.current = result;
    return result;
  }, [layouts, serviceData, customGroups]);

  // Auto-scroll when dragging near viewport edges
  const scrollRAF = useRef(null);
  const handleDrag = useCallback((layout, oldItem, newItem, placeholder, e) => {
    if (scrollRAF.current) cancelAnimationFrame(scrollRAF.current);
    const EDGE = 80; // px from edge to start scrolling
    const SPEED = 15; // px per frame
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
  const handleDragStop = useCallback(() => {
    if (scrollRAF.current) { cancelAnimationFrame(scrollRAF.current); scrollRAF.current = null; }
  }, []);

  // Welcome message config
  const wm = config.welcomeMessage || {};

  return (
    <div className="dashboard-content" ref={containerRef}>
      {/* Welcome message banner */}
      {wm.enabled && wm.text && (
        <div style={{
          textAlign: 'center',
          padding: '12px 20px 4px',
          maxWidth: 900,
          margin: '0 auto',
        }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: wm.fontSize || 20,
            color: 'var(--text-primary)',
            lineHeight: 1.3,
          }}>
            {wm.text}
          </div>
          {wm.description && (
            <div style={{
              fontFamily: 'var(--font-body)',
              fontSize: Math.max((wm.fontSize || 20) * 0.6, 12),
              color: 'var(--text-secondary)',
              marginTop: 4,
            }}>
              {wm.description}
            </div>
          )}
        </div>
      )}
      {mounted && (
        <Responsive
          className="layout"
          width={width}
          layouts={effectiveLayouts}
          breakpoints={{ lg: 1200, md: 768, sm: 480 }}
          // No compactor — panels stay exactly where the user places them
          onLayoutChange={handleLayoutChange}
          onDragStart={handleDragStart}
          onDrag={handleDrag}
          onDragStop={handleDragStop}
          onResizeStart={handleResizeStart}
          gridConfig={{
            cols,
            rowHeight: 36,
            margin: [16, 16],
          }}
          dragConfig={{
            enabled: true,
            handle: '.section-header',
          }}
          resizeConfig={{
            enabled: true,
            handles: ['se', 'sw', 'e', 'w'],
          }}
        >
          {/* Dynamic node sections */}
          {nodeElements}

          {/* Placeholders for node panels that exist in saved layout but haven't loaded yet.
              Without these, RGL has no children for those keys on first render,
              and when serviceData arrives, they get repositioned instead of using saved positions. */}
          {(() => {
            const loadedNodeKeys = new Set(Object.keys(serviceData.nodes || {}).map(k => `node-${k}`));
            const savedKeys = (layouts.lg || layouts.md || []).map(i => i.i).filter(k => k.startsWith('node-'));
            return savedKeys
              .filter(k => !loadedNodeKeys.has(k))
              .map(k => (
                <div key={k}>
                  <div className="glass-card node-card" style={{ borderTop: '2px solid var(--accent)', opacity: 0.4 }}>
                    <div className="section-header">
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', padding: '12px' }}>
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
        </Responsive>
      )}
    </div>
  );
}
