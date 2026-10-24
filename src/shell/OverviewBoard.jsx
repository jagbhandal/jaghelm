/**
 * The Overview's sections under its status and strip, from 768px (#306: it
 * replaced the old grid board, DashboardView, whose panels each had a home
 * here, in the utilities rail and the Launch page, or in an entity's
 * detail):
 *
 *   Infrastructure  the nodes, as cards or a table (#299)
 *   Power           the UPS (#306), its place on the Overview on mains too
 *   Jobs            every scheduled job and backup (#578), its own chunk
 *   Services        every service in one list, by node or custom group (#300)
 *
 * Each draws the header's poll (`status`, `reach`, `updated`) with what this
 * reads beside it (useDashboardData: /api/services, /api/integrations and
 * /api/history, within the tick's request budget, tickBudget.js). The
 * sections reflow with their content: none has a height of its own, so
 * nothing is clipped at any width (spec §3 goal 3), and nothing is arranged
 * by hand until Edit layout (Phase 5).
 *
 * `filter`, the subsystem the strip is filtered to (`{ id, name, detail }`,
 * the model's, #298), keeps that subsystem's section alone: Nodes →
 * Infrastructure, Power → Power, Jobs or Backups → that group of Jobs,
 * Services → Services. When it keeps none (its section switched off in
 * Settings → Appearance → Overview sections, #307, or a subsystem with no
 * section of its own, Integrations), a note in their place says why and
 * offers everything again (`onClearFilter`).
 *
 * On a first boot with no node yet (no node in /api/services nor in the
 * model), a panel says so (#571's words): while the server waits for
 * Prometheus to report one (`discovery: 'waiting'`), that nodes appear on
 * their own; otherwise how to add one, with Open Settings.
 *
 * Until the header's poll has its first answer, nothing (#243): the status
 * is a placeholder of a height it can't know, and the sections under it
 * would all move when it came. The Jobs section's chunk too, when the model
 * has a job to draw: it is asked for beside the poll. The data loads
 * meanwhile, and the element stays, so its width is known.
 *
 * The sources' failures are announced once, from one polite live region
 * (the sections' Banners are not live regions: the same cause can show on
 * two of them).
 */
import { useMemo } from 'react';
import { Server } from 'lucide-react';
import { ShellSection } from '@ui/app-shell';
import { Button } from '@ui/button';
import { EmptyState } from '@ui/empty-state';
import { Panel } from '@ui/panel';
import ErrorBoundary from '../components/ErrorBoundary';
import { useConfig } from '../context/ConfigContext.jsx';
import { loadOverviewEditor, loadOverviewJobs } from '../lazyViews.js';
import { OverviewInfrastructure } from './OverviewInfrastructure.jsx';
import { OverviewPower } from './OverviewPower.jsx';
import { OverviewServices } from './OverviewServices.jsx';
import { readLayout } from './overviewLayout.js';
import { SECTION_OF, emptyFilterReason, sectionShown } from './overviewSections.js';
import { sourceBanner } from './sourceHealth.js';
import { useAppDataMatching } from './useAppDataMatching.js';
import { useChunk } from './useChunk.js';
import { useDashboardData } from './useDashboardData.js';

const NO_GROUPS = [];

/**
 * The Edit layout panel (#330), from its own chunk, asked for only when the
 * mode is entered: nothing of it is in the Overview's first load. Drawn as soon
 * as it is in (useChunk), so the panel doesn't wait on a Suspense frame.
 */
function EditorSlot(props) {
  const [OverviewEditor] = useChunk(loadOverviewEditor);
  return OverviewEditor ? <OverviewEditor {...props} /> : null;
}

// A note where the first section would be, lined up with the sections (their `margin`).
const NOTE = { margin: '0 16px' };

/** What the note says for each reason. */
function noteOf({ id, name }, reason) {
  if (reason.why === 'off') {
    return {
      title: `The ${reason.section} section is switched off`,
      description: `Switch it on in Settings → Appearance → Overview sections to see ${name} here.`,
    };
  }
  return {
    title: `No section of its own for ${name}`,
    description:
      id === 'integrations'
        ? "An integration's numbers show on its service's row, in the Services section."
        : `The strip above says how ${name} is.`,
  };
}

/** The note in place of the sections a filter left out, with "Show everything". */
function FilterNote({ filter, reason, onClear }) {
  const { title, description } = noteOf(filter, reason);
  return (
    <div data-slot="filter-empty" style={NOTE}>
      <ShellSection>
        <Panel>
          <EmptyState
            title={title}
            description={description}
            action={
              onClear && (
                <Button variant="secondary" size="sm" onClick={onClear}>
                  Show everything
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
 * The first boot's panel (#566, #571), where the nodes will be: while the
 * server asks Prometheus for nodes each refresh (`waiting`), they come by
 * themselves, and a save in Settings would end the wait (Settings can't add
 * a node), so it offers no way there. Otherwise nothing discovers: a node
 * goes into services.yaml, and Settings shows the nodes that are hidden.
 */
function FirstNode({ waiting, onOpenSettings }) {
  return (
    <div data-slot="first-node" style={NOTE}>
      <ShellSection>
        <Panel>
          <EmptyState
            icon={<Server />}
            title={waiting ? 'Waiting for your first node' : 'Connect your first node'}
            description={
              waiting
                ? 'JagHelm asks Prometheus for nodes every refresh. They appear here on their own as soon as Prometheus scrapes a host, with live metrics streaming onto your dashboard.'
                : 'No infrastructure nodes have reported in yet. Add a Prometheus target and list its node in services.yaml, and live metrics will start streaming onto your dashboard here.'
            }
            action={
              onOpenSettings && !waiting ? (
                <Button variant="secondary" size="sm" onClick={onOpenSettings}>
                  Open Settings
                </Button>
              ) : null
            }
          />
        </Panel>
      </ShellSection>
    </div>
  );
}

export default function OverviewBoard({
  refreshKey = 0,
  tick,
  active,
  onOpenSettings,
  filter = null,
  onClearFilter,
  status = null,
  reach = null,
  updated = null,
  editing = false,
  onDoneEditing,
}) {
  const { config } = useConfig();
  const refreshIntervalMs = (config.refreshInterval || 30) * 1000;
  const { serviceData, integrationData, history, servicesLoaded, sources, retry } =
    useDashboardData(refreshKey, { tick, active, refreshIntervalMs });

  // Banners are what the hook says of each source: its failure, and its note
  // once its last answer is stale, by the header's rule on the header's clock
  // (#559), so the two come together. `sources` keeps its identity while
  // neither changes, and a healthy source's banner is the same frozen object,
  // so an all-304 refresh re-renders no section (#252).
  const banners = useMemo(
    () => ({
      services: sourceBanner(sources.services, 'services'),
      integrations: sourceBanner(sources.integrations, 'integrations'),
    }),
    [sources]
  );

  const sc = useMemo(() => config.sections || {}, [config.sections]);
  const customGroups = useMemo(() => config.customGroups || NO_GROUPS, [config.customGroups]);
  // The arrangement (#330): the order of the sections under the notes, and the
  // pinned services. Unset, the default, which is the order this file draws.
  const stored = config.overviewLayout;
  const layout = useMemo(() => readLayout({ overviewLayout: stored }), [stored]);
  // Each service's integration numbers, by uid (the Services section's headline metric).
  const appDataByService = useAppDataMatching(integrationData, serviceData);

  // Which sections draw: their switch on, and the filter theirs (or none).
  const filterId = filter?.id ?? null;
  const keeps = (id) =>
    sectionShown(config, id) && (filterId == null || SECTION_OF[filterId] === id);
  const infraShown = keeps('infrastructure');
  const powerShown = keeps('power');
  const servicesShown = keeps('services');
  const jobsShown = keeps('jobs');
  const jobsFilter = filterId === 'jobs' || filterId === 'backups' ? filterId : null;
  // Its own chunk, so a phone's first load doesn't carry it (useChunk).
  const [OverviewJobs, jobsIn] = useChunk(loadOverviewJobs);
  const jobsWait =
    jobsShown &&
    !jobsIn &&
    (status?.entities ?? []).some((e) => e.kind === 'job' || e.kind === 'backup');

  // The Services section's numbers: the latency from `services`, the headline
  // metrics from `integrations`; the first of them with anything to say.
  const servicesB = banners.services;
  const servicesHealth =
    servicesB.message || servicesB.staleNote ? servicesB : banners.integrations;

  // One announcement for the distinct failing sources a drawn section shows.
  const liveErrors = [
    ...new Set(
      [
        (infraShown || servicesShown) && banners.services.message,
        servicesShown && banners.integrations.message,
      ].filter(Boolean)
    ),
  ].join('. ');

  // A first boot: no node read, nor one in the model.
  const firstRun =
    filterId == null &&
    servicesLoaded &&
    Object.keys(serviceData.nodes || {}).length === 0 &&
    !(status?.entities ?? []).some((e) => e.kind === 'node');
  const reason = emptyFilterReason(filterId, config);

  // The first section drawn: the Infrastructure's flush margin is for the lead.
  const leadId = layout.order.find((id) => ({ infrastructure: infraShown, power: powerShown, jobs: jobsShown && OverviewJobs, services: servicesShown })[id]);
  // The sections, by id, drawn in the arrangement's order (default: infrastructure,
  // power, jobs, services). Each is keyed, so a move reorders them without a remount.
  const drawn = {
    infrastructure: infraShown && (
      <ErrorBoundary
        key="infrastructure"
        inline
        itemId="infrastructure"
        label="Infrastructure failed to render"
      >
        <OverviewInfrastructure
          lead={leadId === 'infrastructure'}
          status={status}
          reach={reach}
          updated={updated}
          services={serviceData}
          servicesLoaded={servicesLoaded}
          history={history}
          sections={sc}
          health={servicesB}
          onRetry={retry}
        />
      </ErrorBoundary>
    ),
    power: powerShown && (
      <ErrorBoundary key="power" inline itemId="power" label="Power failed to render">
        <OverviewPower status={status} reach={reach} updated={updated} />
      </ErrorBoundary>
    ),
    jobs: jobsShown && OverviewJobs && (
      <ErrorBoundary key="jobs" inline itemId="jobs" label="Jobs section failed to render">
        <OverviewJobs status={status} reach={reach} updated={updated} filter={jobsFilter} />
      </ErrorBoundary>
    ),
    services: servicesShown && (
      <ErrorBoundary key="services" inline itemId="services" label="Services failed to render">
        <OverviewServices
          status={status}
          reach={reach}
          updated={updated}
          services={serviceData}
          servicesLoaded={servicesLoaded}
          appData={appDataByService}
          customGroups={customGroups}
          pinned={layout.pinned}
          sections={sc}
          health={servicesHealth}
          onRetry={retry}
        />
      </ErrorBoundary>
    ),
  };

  if (reach === 'loading' || jobsWait) return <div className="dashboard-content" />;

  return (
    <div className="dashboard-content" data-slot="overview-board">
      <div className="sr-only" role="status" aria-live="polite">
        {liveErrors}
      </div>
      {firstRun && (
        <FirstNode waiting={serviceData.discovery === 'waiting'} onOpenSettings={onOpenSettings} />
      )}
      {reason && <FilterNote filter={filter} reason={reason} onClear={onClearFilter} />}
      {editing && (
        <EditorSlot
          status={status}
          services={serviceData}
          sections={sc}
          customGroups={customGroups}
          onDone={onDoneEditing}
        />
      )}
      {layout.order.map((id) => drawn[id])}
    </div>
  );
}
