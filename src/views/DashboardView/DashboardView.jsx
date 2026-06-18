import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';

import HelmGrid from '../../components/HelmGrid';
import NodeCard from '../../components/NodeCard';
import TodoCard from '../../components/TodoCard';
import DroppablePanel from '../../components/DroppablePanel';
import ServiceDragOverlay from '../../components/ServiceDragOverlay';
import ErrorBoundary from '../../components/ErrorBoundary';
import DegradedBanner from '../../components/DegradedBanner';
import { UPSCard, GiteaActivity, QuickLaunch, CronJobs } from '../../components/Widgets';
import { cachedIconUrl } from '../../hooks/useData';

import NodePanel from './NodePanel';
import { useConfig } from '../../context/ConfigContext.jsx';
import { DEFAULT_LAYOUTS, migrateLayouts } from './layouts';
import { useDashboardData } from './useDashboardData';
import { useAppDataMatching } from './useAppDataMatching';
import { useEffectiveLayouts } from './useEffectiveLayouts';
import { sourceBanner } from './sourceHealth';

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
export default function DashboardView({ refreshKey, onOpenSettings }) {
  const { config, setConfig } = useConfig();
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
  const { serviceData, ups, commits, cronJobs, integrationData, servicesLoaded, sources, retry } =
    useDashboardData(refreshKey);

  // Per-panel degraded/stale banners are computed AT RENDER from `sources`
  // (per-source { error, lastSuccessMs }) and a live clock — no per-tick state,
  // so an all-304 refresh that doesn't flip any error stays render-free and the
  // 304-stable-identity contract holds. The render that surfaces a NEW error
  // (or recovery) is the error-flip setState in the hook; staleness is read off
  // the live clock on whatever render happens to occur.
  //
  // `now` is bucketed to half the refresh interval before it feeds the memo, so
  // back-to-back renders within the same bucket recompute IDENTICAL banner
  // content and the node/group element memos keep their referential identity
  // (a render triggered by something unrelated doesn't needlessly rebuild every
  // panel). The bucket is far finer than the ~2-interval staleness threshold, so
  // the "updated Nm ago" note still flips promptly once it crosses.
  const refreshIntervalMs = (config.refreshInterval || 30) * 1000;
  const nowBucket = Math.floor(Date.now() / Math.max(refreshIntervalMs / 2, 1000));
  const banners = useMemo(() => {
    const now = nowBucket * Math.max(refreshIntervalMs / 2, 1000);
    const out = {};
    for (const key of Object.keys(sources)) {
      out[key] = sourceBanner(sources[key], key, refreshIntervalMs, now);
    }
    return out;
  }, [sources, refreshIntervalMs, nowBucket]);

  // One page-level announcement for all DISTINCT active source errors, so a
  // global outage (e.g. Prometheus down) is announced once — not once per panel
  // (the per-panel DegradedBanner is visual-only / not a live region).
  const liveErrors = useMemo(
    () =>
      [
        ...new Set(
          Object.values(banners)
            .map((b) => b && b.message)
            .filter(Boolean)
        ),
      ].join('. '),
    [banners]
  );

  // Render a DegradedBanner element for a source's banner descriptor, or null
  // when the source is healthy (so the happy path renders nothing extra).
  const bannerEl = useCallback(
    (b) =>
      b && (b.message || b.staleNote) ? (
        <DegradedBanner message={b.message} staleNote={b.staleNote} onRetry={retry} />
      ) : null,
    [retry]
  );

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
  // Use useMemo for the `|| {}` / `|| []` fallbacks so a missing section/group
  // doesn't allocate a fresh empty object/array on every render — that would
  // invalidate downstream memos (nodeElements, customGroupElements) every tick
  // and defeat the 304-stable-identity contract from useDashboardData.
  const sc = useMemo(() => config.sections || {}, [config.sections]);
  const customGroups = useMemo(() => config.customGroups || [], [config.customGroups]);
  const rawLayouts = config.gridLayout || DEFAULT_LAYOUTS;
  const layouts = useMemo(() => migrateLayouts(rawLayouts) || DEFAULT_LAYOUTS, [rawLayouts]);
  const cols = useMemo(() => {
    const lg = config.gridColumns || 24;
    return { lg, md: Math.min(lg, 20), sm: 1 };
  }, [config.gridColumns]);

  const effectiveLayouts = useEffectiveLayouts(
    layouts,
    serviceData,
    customGroups,
    config.gridColumns
  );

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

  // Node panels — one per discovered node. Node metrics + service status come
  // from the `services` source; their Tier-3 tiles come from `integrations`.
  // Prefer the live-metrics banner whenever services has anything to say
  // (error OR staleness); fall back to the integrations banner only when
  // services is fully healthy, so "app metrics missing" is still surfaced
  // without ever stacking two banners on one card.
  const servicesB = banners.services;
  const nodeBanner = servicesB?.message || servicesB?.staleNote ? servicesB : banners.integrations;
  const nodeElements = useMemo(
    () =>
      Object.entries(serviceData.nodes || {})
        .map(([nodeKey, node]) => (
          <div key={`node-${nodeKey}`}>
            <ErrorBoundary
              inline
              itemId={`node-${nodeKey}`}
              label={`Node "${nodeKey}" failed to render`}
            >
              <NodePanel
                nodeKey={nodeKey}
                node={node}
                sectionCfg={sc[nodeKey] || {}}
                appDataByContainer={appDataByContainer}
                claimedContainers={claimedContainers}
                integrationData={integrationData}
                isMobile={isMobile}
                banner={
                  nodeBanner?.message || nodeBanner?.staleNote ? (
                    <DegradedBanner
                      message={nodeBanner.message}
                      staleNote={nodeBanner.staleNote}
                      onRetry={retry}
                    />
                  ) : null
                }
              />
            </ErrorBoundary>
          </div>
        ))
        .filter(Boolean),
    [
      serviceData,
      sc,
      appDataByContainer,
      claimedContainers,
      integrationData,
      isMobile,
      nodeBanner,
      retry,
    ]
  );

  // Custom group panels — user-defined groupings of containers. Their service
  // cards come from the `services` source, so they carry the same banner.
  const groupBanner = banners.services;
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
              <ErrorBoundary
                inline
                itemId={gridKey}
                label={`Group "${group.title || group.id}" failed to render`}
              >
                <DroppablePanel panelId={gridKey} disabled={isMobile}>
                  <NodeCard
                    sectionKey={`group-${group.id}`}
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
                    banner={
                      groupBanner?.message || groupBanner?.staleNote ? (
                        <DegradedBanner
                          message={groupBanner.message}
                          staleNote={groupBanner.staleNote}
                          onRetry={retry}
                        />
                      ) : null
                    }
                  />
                </DroppablePanel>
              </ErrorBoundary>
            </div>
          );
        })
        .filter(Boolean),
    [customGroups, allServicesFlat, sc, isMobile, groupBanner, retry]
  );

  // Human-readable panel names for the grid's keyboard move/resize handle — the
  // raw grid id (e.g. "node-pve1") is a developer key, not something to read to
  // a screen-reader user. Mirrors the visible section titles.
  const gridLabels = useMemo(() => {
    const map = {
      ups: sc.ups?.title || 'UPS Power',
      pipeline: sc.pipeline?.title || 'Pipeline Activity',
      todos: sc.todos?.title || 'Checklist',
      'cron-jobs': 'Scheduled Jobs',
      quicklaunch: sc.quicklaunch?.title || 'Quick Launch',
    };
    for (const [nodeKey, node] of Object.entries(serviceData.nodes || {})) {
      map[`node-${nodeKey}`] = node?.display_name || nodeKey;
    }
    for (const group of customGroups) {
      map[`group-${group.id}`] = group.title || group.id;
    }
    return map;
  }, [sc, serviceData, customGroups]);

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

  // First-run empty state: services have loaded, but no nodes were discovered
  // and the user hasn't created any custom groups. Show a friendly CTA instead
  // of an empty/Loading grid.
  const nodeCount = Object.keys(serviceData.nodes || {}).length;
  const savedNodePlaceholders = (layouts.lg || layouts.md || []).some(
    (i) => typeof i.i === 'string' && i.i.startsWith('node-')
  );
  const isEmpty =
    servicesLoaded && nodeCount === 0 && customGroups.length === 0 && !savedNodePlaceholders;

  // First-paint loading state: the initial /api/services request hasn't resolved
  // yet AND we have nothing real to show (no live nodes, no custom groups, no
  // saved node placeholders to stand in). Render skeleton cards instead of a
  // blank/placeholder-text first paint. Once data arrives, servicesLoaded flips
  // and either the grid (nodes/groups) or the empty-state CTA takes over.
  const isFirstLoading =
    !servicesLoaded && nodeCount === 0 && customGroups.length === 0 && !savedNodePlaceholders;

  // A few node-card-shaped shimmer blocks. Count is fixed (we don't yet know how
  // many nodes will report) — three reads as "loading a grid" without guessing.
  const skeletonElements = useMemo(
    () =>
      Array.from({ length: 3 }).map((_, i) => (
        <div
          key={`skeleton-${i}`}
          className="glass-card node-card skeleton-card skeleton"
          aria-hidden="true"
        />
      )),
    []
  );

  // Saved-but-not-yet-loaded node placeholders. Prevents the grid from collapsing
  // while /api/services is still in flight.
  const nodePlaceholders = useMemo(() => {
    const loadedNodeKeys = new Set(Object.keys(serviceData.nodes || {}).map((k) => `node-${k}`));
    const savedKeys = (layouts.lg || layouts.md || [])
      .map((i) => i.i)
      .filter((k) => k.startsWith('node-'));
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
      <div className="sr-only" role="status" aria-live="polite">
        {liveErrors}
      </div>
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

      {isFirstLoading ? (
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading dashboard"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
          }}
        >
          {skeletonElements}
        </div>
      ) : isEmpty ? (
        <DashboardEmptyState onOpenSettings={onOpenSettings} />
      ) : (
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
            labels={gridLabels}
          >
            {nodeElements}
            {nodePlaceholders}
            {customGroupElements}

            {sc.ups?.visible !== false && (
              <div key="ups">
                <ErrorBoundary inline itemId="ups" label="UPS panel failed to render">
                  <UPSCard
                    upsData={ups}
                    borderColor={sc.ups?.borderColor}
                    banner={bannerEl(banners.ups)}
                  />
                </ErrorBoundary>
              </div>
            )}
            {sc.pipeline?.visible !== false && (
              <div key="pipeline">
                <ErrorBoundary inline itemId="pipeline" label="Pipeline panel failed to render">
                  <GiteaActivity commits={commits} banner={bannerEl(banners.commits)} />
                </ErrorBoundary>
              </div>
            )}
            {sc.todos?.visible !== false && (
              <div key="todos">
                <ErrorBoundary inline itemId="todos" label="Todos panel failed to render">
                  <TodoCard
                    borderColor={sc.todos?.borderColor}
                    config={config}
                    setConfig={setConfig}
                  />
                </ErrorBoundary>
              </div>
            )}
            {config.showCronJobs !== false && (
              <div key="cron-jobs">
                <ErrorBoundary inline itemId="cron-jobs" label="Cron Jobs panel failed to render">
                  <CronJobs nodes={cronJobs} banner={bannerEl(banners.cron)} />
                </ErrorBoundary>
              </div>
            )}
            {sc.quicklaunch?.visible !== false && (
              <div key="quicklaunch">
                <ErrorBoundary
                  inline
                  itemId="quicklaunch"
                  label="Quick Launch panel failed to render"
                >
                  <QuickLaunch borderColor={sc.quicklaunch?.borderColor} />
                </ErrorBoundary>
              </div>
            )}
          </HelmGrid>

          <DragOverlay dropAnimation={null}>
            {activeDrag ? <ServiceDragOverlay service={activeDrag} /> : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

/**
 * First-run empty state shown when no nodes are discovered. Guides the user to
 * Settings to connect their first node instead of staring at an empty grid.
 */
function DashboardEmptyState({ onOpenSettings }) {
  return (
    <div
      className="glass-card"
      style={{
        maxWidth: 560,
        margin: '48px auto',
        padding: '40px 32px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <div style={{ fontSize: 44, lineHeight: 1 }} aria-hidden="true">
        🛰️
      </div>
      <h2
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 22,
          color: 'var(--text-primary)',
          margin: 0,
        }}
      >
        Connect your first node
      </h2>
      <p
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 14,
          color: 'var(--text-secondary)',
          maxWidth: 420,
          margin: 0,
          lineHeight: 1.6,
        }}
      >
        No infrastructure nodes have reported in yet. Add a Prometheus target or a node in Settings,
        and live metrics will start streaming onto your dashboard here.
      </p>
      {onOpenSettings && (
        <button
          type="button"
          className="settings-btn-primary"
          onClick={onOpenSettings}
          style={{ marginTop: 8, padding: '10px 20px', fontSize: 14 }}
        >
          Open Settings
        </button>
      )}
    </div>
  );
}
