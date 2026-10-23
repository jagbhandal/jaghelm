import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';

import HelmGrid from '../../components/HelmGrid';
import TodoCard from '../../components/TodoCard';
import ErrorBoundary from '../../components/ErrorBoundary';
import DegradedBanner from '../../components/DegradedBanner';
import { UPSCard, GiteaActivity, QuickLaunch, CronJobs } from '../../components/Widgets';
import { deleteCronJob } from '../../hooks/useData';

import NodePanel from './NodePanel';
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
import { OverviewServices } from '../../shell/OverviewServices.jsx';
import { sectionShown } from '../../shell/overviewSections.js';
import { RAIL_WIDTH, ShellSection } from '@ui/app-shell';
import { useMediaQuery } from '../../shell/useMediaQuery.js';
import { Panel } from '@ui/panel';
import { EmptyState } from '@ui/empty-state';
import { Button } from '@ui/button';
import { Skeleton } from '@ui/skeleton';

// What the Pipeline panel lists when /api/gitea/activity answered no list.
const NO_COMMITS = [];
const NO_GROUPS = [];

/**
 * DashboardView — the main grid of node panels (their Proxmox lists) and
 * dedicated section panels (UPS, Gitea, todos, cron, quick launch), under the
 * Overview's Infrastructure and Services sections.
 *
 * Composition:
 *   - useDashboardData      → state + ETag-aware periodic refresh
 *   - useAppDataMatching    → integration data → container mapping (the
 *                             Services section's headline metrics)
 *   - useEffectiveLayouts   → reconcile saved layout with discovered panels
 *   - NodePanel             → renders one node's panel (its Proxmox lists)
 *   - HelmGrid              → drag/resize-aware responsive grid
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
 * node panels below, which keep the node's Proxmox lists, carry none.
 *
 * Under it, the Services section (#300): every service in one list, grouped
 * by node or by custom group, from the same poll and this board's readings
 * and integrations. It replaces the service cards: the node panels draw none,
 * the custom groups are its grouping rather than panels of their own, and no
 * card is dragged between panels any more (a custom group's services are
 * chosen in Settings → Sections). It is the Services subsystem's, so the
 * Services filter keeps it alone, and any other hides it.
 *
 * Either section can be switched off (Settings → Appearance → Overview
 * sections, #307, overviewSections.js); with Infrastructure off, the node
 * panels carry the nodes' anchors again.
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

  const refreshIntervalMs = (config.refreshInterval || 30) * 1000;

  // Data — fetch loop encapsulated in the hook
  const {
    serviceData,
    ups,
    commits,
    cronJobs,
    integrationData,
    history,
    servicesLoaded,
    settled,
    sources,
    healthNow,
    retry,
  } = useDashboardData(refreshKey, { tick, active, refreshIntervalMs });

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

  // Banners are computed at render from `sources` + the hook's clock (no
  // per-tick state), so an all-304 refresh stays render-free. `healthNow` steps
  // every half refresh interval, so back-to-back renders in one step recompute
  // IDENTICAL content and the node/group memos keep their identity; the step
  // is still far finer than the staleness threshold, so "updated Nm ago" flips
  // promptly once it crosses. It is the hook's, not a clock of this view's own:
  // `sources` read the last answers on it (#545). A healthy source's banner is
  // the same frozen HEALTHY every step, so a healthy tick rebuilds no node
  // panel (#252).
  const banners = useMemo(() => {
    const out = {};
    for (const key of Object.keys(sources)) {
      // Each source goes stale on its own poll period (slow sources poll less often).
      out[key] = sourceBanner(sources[key], key, pollPeriodMs(key, refreshIntervalMs), healthNow);
    }
    return out;
  }, [sources, refreshIntervalMs, healthNow]);

  // Use useMemo for the `|| {}` / `|| []` fallbacks so a missing section/group
  // doesn't allocate a fresh empty object/array on every render — that would
  // invalidate downstream memos (nodeElements, customGroupElements) every tick
  // and defeat the 304-stable-identity contract from useDashboardData.
  const sc = useMemo(() => config.sections || {}, [config.sections]);
  const customGroups = useMemo(() => config.customGroups || NO_GROUPS, [config.customGroups]);

  // UPS and Pipeline show only when the server says their source is set up
  // (#272); the rule is in configuredPanels.js. true, false or null (not known).
  const configured = useConfiguredPanels({ ups, commits, commitsSource: sources.commits });
  const upsShown = configured.ups === true && sc.ups?.visible !== false;
  const pipelineShown = configured.pipeline === true && sc.pipeline?.visible !== false;
  const cronShown = config.showCronJobs !== false;
  // From 1440px the Overview's utilities rail draws Quick Launch, Pipeline and
  // the Checklist (#301): the board leaves its own out, so they show once.
  const railed = useMediaQuery(RAIL_WIDTH);

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

  // Tier 3 app data per service, by uid (preset metrics: queries, blocked, etc.)
  const appDataByService = useAppDataMatching(integrationData, serviceData);

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
    pipeline: pipelineShown && !railed,
    'cron-jobs': cronShown,
    todos: sc.todos?.visible !== false && !railed,
    quicklaunch: sc.quicklaunch?.visible !== false && !railed,
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
  // Panels the board no longer draws leave the layout: a source-fed one the
  // server says is not set up, and a custom group's (#300: the Services
  // section groups by them instead), so a saved layout holds no slot for one.
  const savedGroupKeys = useMemo(
    () =>
      [
        ...new Set(
          Object.values(savedLayouts ?? {})
            .filter(Array.isArray)
            .flat()
            .map((i) => i?.i)
            .filter((k) => typeof k === 'string' && k.startsWith('group-'))
        ),
      ].join('\n'),
    [savedLayouts]
  );
  const droppedPanels = useMemo(
    () => [
      ...SOURCE_PANEL_KEYS.filter((k) => configured[k] === false),
      ...(savedGroupKeys ? savedGroupKeys.split('\n') : []),
    ],
    [configured, savedGroupKeys]
  );

  const effectiveLayouts = useEffectiveLayouts(
    layouts,
    serviceData,
    NO_GROUPS,
    config.gridColumns,
    hiddenPanels,
    droppedPanels
  );

  const handleLayoutChange = useCallback(
    (_, allLayouts) => setConfig((p) => ({ ...p, gridLayout: versionedLayouts(allLayouts) })),
    [setConfig]
  );

  // Node panels — one per discovered node, holding its Proxmox lists, which
  // come from the `integrations` source, so they carry its banner.
  const servicesB = banners.services;
  // The Infrastructure section shows unfiltered and under the Nodes filter;
  // the Services section unfiltered and under the Services filter; either
  // never once switched off (Settings → Appearance → Overview sections, #307).
  const infraShown =
    sectionShown(config, 'infrastructure') && (filter == null || filter.id === 'nodes');
  const servicesShown =
    sectionShown(config, 'services') && (filter == null || filter.id === 'services');
  const nodeBanner = banners.integrations;
  // The Services section's numbers: the latency from `services`, the headline
  // metrics from `integrations`; the first of them with anything to say.
  const servicesHealth =
    servicesB?.message || servicesB?.staleNote ? servicesB : banners.integrations;
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
                integrationData={integrationData}
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
    [serviceData, sc, integrationData, infraShown, nodeBanner, retry]
  );

  // The Overview's filter (#298): the panels it keeps.
  const filterId = filter?.id ?? null;
  const keep = useMemo(() => boardSections(filterId), [filterId]);
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
    return map;
  }, [sc, serviceData]);

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
  const keptKey = keep
    ? [
        ...[...gridNodes, ...gridPlaceholders].map((el) => el.key),
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
  // A filter whose subsystem is drawn by a section above the board.
  const sectionAbove = filterId === 'nodes' || filterId === 'services';

  // Until the header's poll has its first answer, nothing under the status
  // (#243): the status is a placeholder until then, of a height it can't know,
  // and the sections and panels drawn under it would all move when it came.
  // The data loads meanwhile, and the element stays, so its width is known.
  if (reach === 'loading') return <div className="dashboard-content" ref={mobileRef} />;

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
      {servicesShown && (
        <OverviewServices
          status={status}
          reach={reach}
          updated={updated}
          services={serviceData}
          servicesLoaded={servicesLoaded}
          appData={appDataByService}
          customGroups={customGroups}
          sections={sc}
          health={servicesHealth}
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
        <DashboardEmptyState onOpenSettings={onOpenSettings} discovery={serviceData.discovery} />
      ) : keptKey === '' ? (
        // Nodes and Services have their section above: no note for them.
        sectionAbove ? null : (
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
        )
      ) : (
        <HelmGrid
          className="layout"
          layouts={gridLayouts}
          breakpoints={{ lg: 1200, md: 768, sm: 480 }}
          cols={cols}
          rowHeight={36}
          margin={isMobile ? [12, 12] : [16, 16]}
          // Until every source has answered once, each panel keeps the height
          // it last had: its content is still coming in (#302).
          reserve={!(settled && servicesLoaded)}
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
          {shown.pipeline && kept('pipeline') && (
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
        ? "Today's board has none for them yet: an integration's numbers show on its service's row."
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
 * First-run empty state shown when no nodes are discovered, instead of an
 * empty grid. `discovery` is /api/services' (#566): 'waiting' while the first
 * boot, with no services.yaml yet, asks Prometheus for nodes each refresh.
 * They then come by themselves, and a save in Settings would end the wait
 * (Settings can't add a node), so it says so and offers no way there.
 * Otherwise nothing discovers: a node goes into services.yaml, and Settings
 * shows nodes that are hidden.
 */
function DashboardEmptyState({ onOpenSettings, discovery }) {
  const waiting = discovery === 'waiting';
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
        {waiting ? 'Waiting for your first node' : 'Connect your first node'}
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
        {waiting
          ? 'JagHelm asks Prometheus for nodes every refresh. They appear here on their own as soon as Prometheus scrapes a host, with live metrics streaming onto your dashboard.'
          : 'No infrastructure nodes have reported in yet. Add a Prometheus target and list its node in services.yaml, and live metrics will start streaming onto your dashboard here.'}
      </p>
      {onOpenSettings && !waiting && (
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
