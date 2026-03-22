import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Responsive, useContainerWidth, verticalCompactor } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import NodeCard from '../components/NodeCard';
import TodoCard from '../components/TodoCard';
import { UPSCard, GiteaActivity, QuickLaunch } from '../components/Widgets';
import { getServices, getUPSStatus, getGiteaActivity, getAdGuardStats, getNpmStats } from '../hooks/useData';

/**
 * DashboardView v8 — Phase 1
 * 
 * Key change: Node sections are now driven by /api/services instead of
 * hardcoded service lists and 11 separate API calls.
 * 
 * What /api/services gives us per node:
 * - Node metrics (CPU, RAM, disk, temp, uptime)
 * - Services array with: container name, display name, icon, status, ping, uptime24, docker stats
 * 
 * What still uses dedicated endpoints (until Phase 3 Integration Engine):
 * - UPS data (dedicated section, not a service card)
 * - Gitea activity (dedicated section, commit list)
 * - AdGuard stats (Tier 3 app data on the service card)
 * - NPM stats (Tier 3 app data on the service card)
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
  const [adguardStats, setAdguardStats] = useState(null);
  const [npmStats, setNpmStats] = useState(null);

  const fetchAll = useCallback(async (bust) => {
    const b = bust || false;
    const r = await Promise.allSettled([
      getServices(b),
      getUPSStatus(b),
      getGiteaActivity(b),
      getAdGuardStats(b),
      getNpmStats(b),
    ]);
    if (r[0].status === 'fulfilled') setServiceData(r[0].value || { nodes: {} });
    if (r[1].status === 'fulfilled') setUps(r[1].value);
    if (r[2].status === 'fulfilled') setCommits(r[2].value || []);
    if (r[3].status === 'fulfilled') setAdguardStats(r[3].value);
    if (r[4].status === 'fulfilled') setNpmStats(r[4].value);
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

  // Build Tier 3 app data maps (until Phase 3 moves this server-side)
  const appDataByContainer = useMemo(() => {
    const map = {};
    if (adguardStats) {
      const dnsQ = adguardStats.num_dns_queries || 0;
      const dnsB = adguardStats.num_blocked_filtering || 0;
      const bP = dnsQ > 0 ? ((dnsB / dnsQ) * 100).toFixed(1) : '0';
      // Match by container name — the server tells us the actual container name
      map['adguardhome'] = {
        Queries: dnsQ?.toLocaleString(),
        Blocked: dnsB?.toLocaleString(),
        'Block %': `${bP}%`,
        Latency: adguardStats.avg_processing_time
          ? `${Math.round(adguardStats.avg_processing_time * 1000)}ms`
          : '—',
      };
    }
    if (npmStats) {
      map['nginx-proxy-manager'] = {
        Hosts: npmStats.hosts,
        Online: npmStats.online,
        Certs: npmStats.certs,
      };
    }
    return map;
  }, [adguardStats, npmStats]);

  const sc = config.sections || {};
  const rawLayouts = config.gridLayout || DEFAULT_LAYOUTS;
  const layouts = useMemo(() => migrateLayouts(rawLayouts) || DEFAULT_LAYOUTS, [rawLayouts]);

  const cols = useMemo(() => (
    config.gridColumns
      ? { lg: config.gridColumns, md: Math.min(config.gridColumns, 10), sm: 1 }
      : { lg: 12, md: 10, sm: 1 }
  ), [config.gridColumns]);

  const layoutMountedRef = useRef(false);
  const handleLayoutChange = useCallback((_, allLayouts) => {
    // Skip the initial layout computation that fires on mount — it can clobber saved layouts
    // before service data has loaded (missing node keys)
    if (!layoutMountedRef.current) {
      layoutMountedRef.current = true;
      return;
    }
    setConfig(p => ({ ...p, gridLayout: allLayouts }));
  }, [setConfig]);

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

      // Transform services for NodeCard/ServiceCard
      const services = (node.services || []).map(s => ({
        name: s.display_name,
        container: s.container,
        status: s.status,
        uptime: s.uptime24,
        ping: s.ping,
        icon: s.icon,
        docker: s.docker,
        appData: appDataByContainer[s.container] || null,
      }));

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
          />
        </div>
      );
    }).filter(Boolean);
  }, [serviceData, sc, config, setConfig, appDataByContainer]);

  // Ensure layouts have entries for all dynamic node sections
  const effectiveLayouts = useMemo(() => {
    const nodeKeys = Object.keys(serviceData.nodes || {}).map(k => `node-${k}`);
    const result = {};
    for (const [bp, items] of Object.entries(layouts)) {
      const existingKeys = new Set(items.map(i => i.i));
      const missing = nodeKeys.filter(k => !existingKeys.has(k));
      // Add missing nodes at the bottom
      let maxY = items.reduce((max, i) => Math.max(max, i.y + i.h), 0);
      const newItems = missing.map(k => ({
        i: k, x: 0, y: maxY++, w: bp === 'lg' ? 12 : 10, h: 6, minW: 4, minH: 3,
      }));
      result[bp] = [...items, ...newItems];
    }
    return result;
  }, [layouts, serviceData]);

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

  return (
    <div className="dashboard-content" ref={containerRef}>
      {mounted && (
        <Responsive
          className="layout"
          width={width}
          layouts={effectiveLayouts}
          breakpoints={{ lg: 1200, md: 768, sm: 480 }}
          compactor={verticalCompactor}
          onLayoutChange={handleLayoutChange}
          onDrag={handleDrag}
          onDragStop={handleDragStop}
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
