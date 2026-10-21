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
import { cachedIconUrl, deleteCronJob } from '../../hooks/useData';

import NodePanel from './NodePanel';
import { toServiceCard } from './serviceCard';
import { useConfig } from '../../context/ConfigContext.jsx';
import {
  LAYOUT_VERSION,
  STATIC_PANEL_KEYS,
  defaultLayouts,
  layoutVersion,
  migrateLayouts,
  versionedLayouts,
} from './layouts';
import { useDashboardData, pollPeriodMs } from './useDashboardData';
import { useAppDataMatching } from './useAppDataMatching';
import { useEffectiveLayouts } from './useEffectiveLayouts';
import { useConfiguredPanels, SOURCE_PANEL_KEYS } from './configuredPanels';
import { sourceBanner } from './sourceHealth';
import { boardSections, emptyBoardReason, filterLayouts } from './boardFilter';
import { OverviewInfrastructure } from '../../shell/OverviewInfrastructure.jsx';
import { ShellSection } from '@ui/app-shell';
import { Panel } from '@ui/panel';
import { EmptyState } from '@ui/empty-state';
import { Button } from '@ui/button';
import { Skeleton } from '@ui/skeleton';

// What the Pipeline panel lists when /api/gitea/activity answered no list.
const NO_COMMITS = [];

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
 *
 * `filter`, the subsystem the Overview's strip is filtered to (`{ id, name,
 * detail }`, the model's, #298), keeps only that subsystem's panels
 * (boardFilter.js), risen to the top and fixed in place: a filtered board
 * can't be dragged or resized, since a drag saves the layout it sees. When it
 * keeps none, a note in their place says why (emptyBoardReason) and offers the
 * whole board (`onClearFilter`), or, while the panel's source hasn't answered,
 * a placeholder.
 *
 * At its top, the Overview's Infrastructure section (#299): the nodes, from
 * the header's poll (`status`, `reach`, `updated`) and this board's
 * readings. It is the Nodes subsystem's, so a filter to another subsystem
 * hides it; while it is drawn, each node's anchor is its card there, and the
 * node panels below, which keep the node's service cards and Proxmox lists,
 * carry none.
 */
export default function DashboardView({
  refreshKey,
  tick,
  active,
  onOpenSettings,
  filter = null,
  onClearFilter,
  status = null,
  reach = null,
  updated = null,
}) {
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
  const {
    serviceData,
    ups,
    commits,
    cronJobs,
    integrationData,
    history,
    servicesLoaded,
    sources,
    retry,
  } = useDashboardData(refreshKey, { tick, active });

  const removeCronJob = useCallback(
    async (node, job) => {
      try {
        await deleteCronJob(node, job);
        retry();
      } catch (err) {
        console.warn('[dashboard] Remove cron job failed:', err?.message);
        window.alert(`Could not remove ${job}: ${err?.message || 'unknown error'}`);
      }
    },
    [retry]
  );

  // Banners are computed at render from `sources` + a live clock (no per-tick
  // state), so an all-304 refresh stays render-free. `now` is bucketed to half
  // the refresh interval so back-to-back renders in one bucket recompute
  // IDENTICAL content and the node/group memos keep their identity; the bucket
  // is still far finer than the staleness threshold, so "updated Nm ago" flips
  // promptly once it crosses.
  const refreshIntervalMs = (config.refreshInterval || 30) * 1000;
  const nowBucket = Math.floor(Date.now() / Math.max(refreshIntervalMs / 2, 1000));
  const banners = useMemo(() => {
    const now = nowBucket * Math.max(refreshIntervalMs / 2, 1000);
    const out = {};
    for (const key of Object.keys(sources)) {
      // Each source goes stale on its own poll period (slow sources poll less often).
      out[key] = sourceBanner(sources[key], key, pollPeriodMs(key, refreshIntervalMs), now);
    }
    return out;
  }, [sources, refreshIntervalMs, nowBucket]);

  // Use useMemo for the `|| {}` / `|| []` fallbacks so a missing section/group
  // doesn't allocate a fresh empty object/array on every render — that would
  // invalidate downstream memos (nodeElements, customGroupElements) every tick
  // and defeat the 304-stable-identity contract from useDashboardData.
  const sc = useMemo(() => config.sections || {}, [config.sections]);
  const customGroups = useMemo(() => config.customGroups || [], [config.customGroups]);

  // UPS and Pipeline show only when the server says their source is set up
  // (#272); the rule is in configuredPanels.js. true, false or null (not known).
  const configured = useConfiguredPanels({ ups, commits, commitsSource: sources.commits });
  const upsShown = configured.ups === true && sc.ups?.visible !== false;
  const pipelineShown = configured.pipeline === true && sc.pipeline?.visible !== false;
  const cronShown = config.showCronJobs !== false;

  // One page-level announcement for all DISTINCT active source errors, so a
  // global outage (e.g. Prometheus down) is announced once — not once per panel
  // (the per-panel DegradedBanner is visual-only / not a live region). A source
  // whose only panel is hidden is left out: nothing on the board shows it.
  const liveErrors = useMemo(() => {
    const hidden = { ups: !upsShown, commits: !pipelineShown, cron: !cronShown };
    return [
      ...new Set(
        Object.entries(banners)
          .filter(([key]) => !hidden[key])
          .map(([, b]) => b && b.message)
          .filter(Boolean)
      ),
    ].join('. ');
  }, [banners, upsShown, pipelineShown, cronShown]);

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
  const cols = useMemo(() => {
    const lg = config.gridColumns || 24;
    return { lg, md: Math.min(lg, 20), sm: 1 };
  }, [config.gridColumns]);

  // The panels on the board. One that is not (switched off in Settings, or a
  // source-fed panel not known to be set up) joins no layout, so it holds no
  // empty slot; one the server says is not set up also leaves a saved layout
  // that has it.
  const shown = {
    ups: upsShown,
    pipeline: pipelineShown,
    'cron-jobs': cronShown,
    todos: sc.todos?.visible !== false,
    quicklaunch: sc.quicklaunch?.visible !== false,
  };
  // Joined into strings, so the memos below change only when the set does.
  const shownPanelsKey = STATIC_PANEL_KEYS.filter((k) => shown[k]).join(' ');
  const nodeKeysKey = Object.keys(serviceData.nodes || {}).join('\n');

  // The saved layout, or null. Without one the board is laid out from the
  // nodes and panels it has (#248); a saved layout is used as it is.
  const savedLayouts = useMemo(() => migrateLayouts(config.gridLayout), [config.gridLayout]);
  // A layout saved before LAYOUT_VERSION is saved again, brought up to it, with
  // its version (#299): once, so a later height of the user's own stays.
  useEffect(() => {
    const saved = config.gridLayout;
    if (!saved || layoutVersion(saved) >= LAYOUT_VERSION) return;
    setConfig((p) =>
      p.gridLayout === saved ? { ...p, gridLayout: versionedLayouts(migrateLayouts(saved)) } : p
    );
  }, [config.gridLayout, setConfig]);
  const layouts = useMemo(
    () =>
      savedLayouts ||
      defaultLayouts(nodeKeysKey ? nodeKeysKey.split('\n') : [], {
        panels: shownPanelsKey ? shownPanelsKey.split(' ') : [],
        cols,
      }),
    [savedLayouts, nodeKeysKey, shownPanelsKey, cols]
  );

  const hiddenPanels = useMemo(
    () => STATIC_PANEL_KEYS.filter((k) => !shownPanelsKey.split(' ').includes(k)),
    [shownPanelsKey]
  );
  const droppedSourcePanels = useMemo(
    () => SOURCE_PANEL_KEYS.filter((k) => configured[k] === false),
    [configured]
  );

  const effectiveLayouts = useEffectiveLayouts(
    layouts,
    serviceData,
    customGroups,
    config.gridColumns,
    hiddenPanels,
    droppedSourcePanels
  );

  const handleLayoutChange = useCallback(
    (_, allLayouts) => setConfig((p) => ({ ...p, gridLayout: versionedLayouts(allLayouts) })),
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
        const card = toServiceCard(nodeKey, s, appDataByContainer);
        map[card.uid] = card;
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
  // The Infrastructure section shows unfiltered and under the Nodes filter.
  const infraShown = filter == null || filter.id === 'nodes';
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
                anchored={!infraShown}
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
      infraShown,
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

  // The Overview's filter (#298): the panels it keeps. A node's card counts as
  // a services panel only when it draws a service card of its own (one not
  // moved into a group), or while it is still loading.
  const { loadedNodes, nodesWithServices } = useMemo(() => {
    const loaded = new Set();
    const withServices = new Set();
    for (const [nodeKey, node] of Object.entries(serviceData.nodes || {})) {
      loaded.add(`node-${nodeKey}`);
      const own = (node.services || []).some(
        (s) => !claimedContainers.has(`${nodeKey}:${s.container}`)
      );
      if (own) withServices.add(`node-${nodeKey}`);
    }
    return { loadedNodes: loaded, nodesWithServices: withServices };
  }, [serviceData, claimedContainers]);
  const filterId = filter?.id ?? null;
  const keep = useMemo(
    () => boardSections(filterId, { loadedNodes, nodesWithServices }),
    [filterId, loadedNodes, nodesWithServices]
  );
  const kept = (key) => !keep || keep(key);

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

  // First-run empty state: services have loaded, but no nodes were discovered
  // and the user hasn't created any custom groups. Show a friendly CTA instead
  // of an empty/Loading grid.
  const nodeCount = Object.keys(serviceData.nodes || {}).length;
  const savedNodePlaceholders = (savedLayouts?.lg || savedLayouts?.md || []).some(
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
    const savedKeys = (savedLayouts?.lg || savedLayouts?.md || [])
      .map((i) => i.i)
      .filter((k) => typeof k === 'string' && k.startsWith('node-'));
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
  }, [serviceData, savedLayouts]);

  // The grid's children and layout, kept to the filter's panels.
  const gridNodes = keep ? nodeElements.filter((el) => keep(el.key)) : nodeElements;
  const gridPlaceholders = keep ? nodePlaceholders.filter((el) => keep(el.key)) : nodePlaceholders;
  const gridGroups = keep ? customGroupElements.filter((el) => keep(el.key)) : customGroupElements;
  const keptKey = keep
    ? [
        ...[...gridNodes, ...gridPlaceholders, ...gridGroups].map((el) => el.key),
        ...STATIC_PANEL_KEYS.filter((k) => shown[k] && keep(k)),
      ].join('\n')
    : null;
  const gridLayouts = useMemo(
    () =>
      keptKey === null
        ? effectiveLayouts
        : filterLayouts(effectiveLayouts, new Set(keptKey ? keptKey.split('\n') : [])),
    [effectiveLayouts, keptKey]
  );
  const fixed = isMobile || keep !== null;

  return (
    <div className="dashboard-content" ref={mobileRef}>
      <div className="sr-only" role="status" aria-live="polite">
        {liveErrors}
      </div>
      {infraShown && (
        <OverviewInfrastructure
          status={status}
          reach={reach}
          updated={updated}
          services={serviceData}
          servicesLoaded={servicesLoaded}
          history={history}
          sections={sc}
          health={servicesB}
          onRetry={retry}
          margin={isMobile ? 12 : 16}
        />
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
      ) : keptKey === '' && filterId !== 'nodes' ? (
        <BoardFilterEmpty
          filter={filter}
          reason={emptyBoardReason(filter.id, {
            upsHidden: sc.ups?.visible === false,
            // `ups` is the last answer's body; a failure is the source's error.
            upsAnswered: ups != null || sources.ups?.error != null,
            cronShown,
            servicesLoaded,
          })}
          onClear={onClearFilter}
          margin={isMobile ? 12 : 16}
        />
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <HelmGrid
            className="layout"
            layouts={gridLayouts}
            breakpoints={{ lg: 1200, md: 768, sm: 480 }}
            cols={cols}
            rowHeight={36}
            margin={isMobile ? [12, 12] : [16, 16]}
            draggable={!fixed}
            dragHandle=".section-header"
            resizable={!fixed}
            onLayoutChange={handleLayoutChange}
            onDrag={handlePanelDrag}
            onDragStop={handlePanelDragStop}
            onResizeStop={handlePanelResizeStop}
            labels={gridLabels}
          >
            {gridNodes}
            {gridPlaceholders}
            {gridGroups}

            {upsShown && kept('ups') && (
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
            {pipelineShown && kept('pipeline') && (
              <div key="pipeline">
                <ErrorBoundary inline itemId="pipeline" label="Pipeline panel failed to render">
                  <GiteaActivity
                    commits={Array.isArray(commits) ? commits : NO_COMMITS}
                    banner={bannerEl(banners.commits)}
                  />
                </ErrorBoundary>
              </div>
            )}
            {shown.todos && kept('todos') && (
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
            {cronShown && kept('cron-jobs') && (
              <div key="cron-jobs">
                <ErrorBoundary inline itemId="cron-jobs" label="Cron Jobs panel failed to render">
                  <CronJobs
                    nodes={cronJobs}
                    banner={bannerEl(banners.cron)}
                    onRemove={removeCronJob}
                  />
                </ErrorBoundary>
              </div>
            )}
            {shown.quicklaunch && kept('quicklaunch') && (
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

// What the note says for each reason (emptyBoardReason). The subsystem is set
// up (the model says so), so no note says it isn't.
const NOTES = {
  off: ({ name }, { panel }) => ({
    title: `${panel} is switched off`,
    description: `Switch it on in Settings to see ${name} here.`,
  }),
  unread: ({ id, name, detail }) => ({
    title: id === 'power' ? 'No UPS reading on the board' : `Nothing on the board for ${name}`,
    description: `${name}, as the status reads it: ${detail}.`,
  }),
  none: ({ id, name }) => ({
    title: `No section on the board for ${name}`,
    description:
      id === 'integrations'
        ? "Today's board has none for them yet: an integration's numbers show on its service's card."
        : "Today's board has none for it yet.",
  }),
};

/**
 * What the board shows when the Overview's filter (#298) keeps none of its
 * panels, in the new UI, lined up with the board's cards (HelmGrid's margin):
 * a placeholder while the panel's source hasn't answered, otherwise a note
 * saying why (NOTES) with "Show the whole board".
 */
function BoardFilterEmpty({ filter, reason, onClear, margin }) {
  if (reason.why === 'loading') {
    return (
      <div data-slot="board-filter-empty" aria-busy="true" style={{ margin }}>
        <ShellSection>
          <span className="sr-only">Loading the board</span>
          <Skeleton style={{ height: 120 }} />
        </ShellSection>
      </div>
    );
  }
  const { title, description } = NOTES[reason.why](filter, reason);
  return (
    <div data-slot="board-filter-empty" style={{ margin }}>
      <ShellSection>
        <Panel>
          <EmptyState
            title={title}
            description={description}
            action={
              onClear && (
                <Button variant="secondary" size="sm" onClick={onClear}>
                  Show the whole board
                </Button>
              )
            }
          />
        </Panel>
      </ShellSection>
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
