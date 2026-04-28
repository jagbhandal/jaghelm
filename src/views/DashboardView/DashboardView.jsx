import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';

import HelmGrid from '../../components/HelmGrid';
import NodeCard from '../../components/NodeCard';
import TodoCard from '../../components/TodoCard';
import DroppablePanel from '../../components/DroppablePanel';
import ServiceDragOverlay from '../../components/ServiceDragOverlay';
import { UPSCard, GiteaActivity, QuickLaunch, CronJobs } from '../../components/Widgets';
import { cachedIconUrl } from '../../hooks/useData';

import NodePanel from './NodePanel';
import { DEFAULT_LAYOUTS, migrateLayouts } from './layouts';
import { useDashboardData } from './useDashboardData';
import { useAppDataMatching } from './useAppDataMatching';
import { useEffectiveLayouts } from './useEffectiveLayouts';

/**
 * DashboardView — the main grid of node panels, dedicated section panels
 * (UPS, Gitea, todos, cron, quick launch), and user-defined custom groups.
 *
 * Composition:
 *   - useDashboardData      → state + ETag-aware periodic refresh
 *   - useAppDataMatching    → integration data → container mapping
 *   - useEffectiveLayouts   → reconcile saved layout with discovered panels
 *   - NodePanel             → renders one node card (with Proxmox children)
 *   - HelmGrid              → drag/resize-aware responsive grid
 *   - DndContext            → service-card drag between panels
 */
export default function DashboardView({ config, setConfig, refreshKey }) {
  // Mobile detection — used to disable drag/resize on small screens
  const mobileRef = useRef(null);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const el = mobileRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setIsMobile(el.clientWidth < 480));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Data — fetch loop encapsulated in the hook
  const { serviceData, ups, commits, cronJobs, integrationData } = useDashboardData(refreshKey);

  // Tier 3 app data per container (preset metrics: queries, blocked, etc.)
  const appDataByContainer = useAppDataMatching(integrationData, serviceData);

  // ── Drag-and-drop service cards between panels ──
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [activeDrag, setActiveDrag] = useState(null);

  const handleDragStart = useCallback((event) => {
    if (event.active?.data?.current?.service) {
      setActiveDrag(event.active.data.current.service);
    }
  }, []);

  const handleDragCancel = useCallback(() => setActiveDrag(null), []);

  const handleDragEnd = useCallback(
    (event) => {
      setActiveDrag(null);
      const { active, over } = event;
      if (!active || !over) return;

      const uid = active.data?.current?.uid;
      const sourcePanel = active.data?.current?.sourcePanel;
      const targetPanelId = over.data?.current?.panelId;
      if (!uid || !targetPanelId || sourcePanel === targetPanelId) return;

      const customGroups = config.customGroups || [];

      // Drop into a custom group panel — assign the container to that group, removing it from any other.
      if (targetPanelId.startsWith('group-')) {
        const targetGroupId = targetPanelId.replace('group-', '');
        const updatedGroups = customGroups.map((g) => {
          const filtered = (g.containers || []).filter((c) => c !== uid);
          if (g.id === targetGroupId) {
            return { ...g, containers: [...filtered, uid] };
          }
          return { ...g, containers: filtered };
        });
        setConfig((p) => ({ ...p, customGroups: updatedGroups }));
        return;
      }

      // Drop back onto a node panel — release from any custom group it was in.
      if (targetPanelId.startsWith('node-')) {
        const updatedGroups = customGroups.map((g) => ({
          ...g,
          containers: (g.containers || []).filter((c) => c !== uid),
        }));
        setConfig((p) => ({ ...p, customGroups: updatedGroups }));
      }
    },
    [config, setConfig]
  );

  // ── Layout state ──
  const sc = config.sections || {};
  const rawLayouts = config.gridLayout || DEFAULT_LAYOUTS;
  const layouts = useMemo(() => migrateLayouts(rawLayouts) || DEFAULT_LAYOUTS, [rawLayouts]);
  const cols = useMemo(() => {
    const lg = config.gridColumns || 24;
    return { lg, md: Math.min(lg, 20), sm: 1 };
  }, [config.gridColumns]);

  const customGroups = config.customGroups || [];
  const effectiveLayouts = useEffectiveLayouts(layouts, serviceData, customGroups, config.gridColumns);

  const handleLayoutChange = useCallback(
    (_, allLayouts) => setConfig((p) => ({ ...p, gridLayout: allLayouts })),
    [setConfig]
  );

  // Containers claimed by a custom group are hidden from their original node panel.
  const claimedContainers = useMemo(() => {
    const set = new Set();
    for (const group of customGroups) {
      for (const c of group.containers || []) set.add(c);
    }
    return set;
  }, [customGroups]);

  // Flat lookup of all discovered services, keyed by node:container UID.
  // Custom groups reference services from this map.
  const allServicesFlat = useMemo(() => {
    const map = {};
    for (const [nodeKey, node] of Object.entries(serviceData.nodes || {})) {
      for (const s of node.services || []) {
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

  // Node panels — one per discovered node
  const nodeElements = useMemo(
    () =>
      Object.entries(serviceData.nodes || {})
        .map(([nodeKey, node]) => (
          <NodePanel
            key={`node-${nodeKey}`}
            nodeKey={nodeKey}
            node={node}
            sectionCfg={sc[nodeKey] || {}}
            config={config}
            setConfig={setConfig}
            appDataByContainer={appDataByContainer}
            claimedContainers={claimedContainers}
            integrationData={integrationData}
            isMobile={isMobile}
          />
        ))
        .filter(Boolean),
    [serviceData, sc, config, setConfig, appDataByContainer, claimedContainers, integrationData, isMobile]
  );

  // Custom group panels — user-defined groupings of containers
  const customGroupElements = useMemo(
    () =>
      customGroups
        .map((group) => {
          const groupCfg = sc[`group-${group.id}`] || {};
          if (groupCfg.visible === false) return null;
          const gridKey = `group-${group.id}`;
          const borderColor = group.borderColor || 'var(--accent)';
          const services = (group.containers || []).map((c) => allServicesFlat[c]).filter(Boolean);

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
                  nodeData={{
                    display_name: group.title,
                    icon:
                      group.icon ||
                      cachedIconUrl(
                        'https://cdn.jsdelivr.net/gh/marella/material-design-icons@latest/svg/folder_special/outline.svg'
                      ),
                    subtitle: `${services.length} services`,
                  }}
                  panelId={gridKey}
                  dragDisabled={isMobile}
                />
              </DroppablePanel>
            </div>
          );
        })
        .filter(Boolean),
    [customGroups, allServicesFlat, sc, config, setConfig, isMobile]
  );

  // ── Auto-scroll while dragging panels near viewport edges ──
  const scrollRAF = useRef(null);
  const handlePanelDrag = useCallback((layout, oldItem, newItem, placeholder, e) => {
    if (scrollRAF.current) cancelAnimationFrame(scrollRAF.current);
    const EDGE = 80;
    const SPEED = 15;
    const y = e?.clientY ?? 0;
    const vh = window.innerHeight;
    if (y > vh - EDGE) {
      const doScroll = () => {
        window.scrollBy(0, SPEED);
        scrollRAF.current = requestAnimationFrame(doScroll);
      };
      scrollRAF.current = requestAnimationFrame(doScroll);
    } else if (y < EDGE) {
      const doScroll = () => {
        window.scrollBy(0, -SPEED);
        scrollRAF.current = requestAnimationFrame(doScroll);
      };
      scrollRAF.current = requestAnimationFrame(doScroll);
    }
  }, []);

  const handlePanelDragStop = useCallback(() => {
    if (scrollRAF.current) {
      cancelAnimationFrame(scrollRAF.current);
      scrollRAF.current = null;
    }
  }, []);

  const handlePanelResizeStop = useCallback(() => {
    // HelmGrid handles layout save via onLayoutChange — nothing extra needed here
  }, []);

  // Welcome banner config
  const wm = config.welcomeMessage || {};

  // Saved-but-not-yet-loaded node placeholders. Prevents the grid from collapsing
  // while /api/services is still in flight.
  const nodePlaceholders = useMemo(() => {
    const loadedNodeKeys = new Set(
      Object.keys(serviceData.nodes || {}).map((k) => `node-${k}`)
    );
    const savedKeys = (layouts.lg || layouts.md || []).map((i) => i.i).filter((k) => k.startsWith('node-'));
    return savedKeys
      .filter((k) => !loadedNodeKeys.has(k))
      .map((k) => (
        <div key={k}>
          <div className="glass-card node-card node-placeholder">
            <div className="section-header">
              <div className="node-placeholder-text">Loading {k.replace('node-', '')}…</div>
            </div>
          </div>
        </div>
      ));
  }, [serviceData, layouts]);

  return (
    <div className="dashboard-content" ref={mobileRef}>
      {wm.enabled && wm.text && (
        <div className="welcome-banner">
          <div className="welcome-text" style={{ fontSize: wm.fontSize || 20 }}>
            {wm.text}
          </div>
          {wm.description && (
            <div
              className="welcome-desc"
              style={{ fontSize: Math.max((wm.fontSize || 20) * 0.6, 12) }}
            >
              {wm.description}
            </div>
          )}
        </div>
      )}

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
          {nodeElements}
          {nodePlaceholders}
          {customGroupElements}

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
          {config.showCronJobs !== false && (
            <div key="cron-jobs">
              <CronJobs nodes={cronJobs} config={config} />
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
