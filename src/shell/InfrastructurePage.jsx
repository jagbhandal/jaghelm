/**
 * The Infrastructure page (#313, spec §8 "Services and Infrastructure pages"),
 * from 768px at /infrastructure: every node the status model has, as the
 * Overview's Infrastructure section draws them (the same section, cards and
 * table, from useInfrastructureSection and infrastructureView.js), with
 * filters over them, and under them each Proxmox node's virtual machines and
 * storage pools, as its detail lists them (#310, entityExtras.js). Below
 * 768px the same address is the phone's Infrastructure tab (PhoneView.jsx),
 * so a window crossing 768px keeps the page and its filters.
 *
 *  - Its filters are in the address (listFilters.js): the search (a node's
 *    name, key or role), the state it is drawn in (all, problems, healthy, no
 *    signal) and its role (services.yaml's subtitle, a filter that shows when
 *    a node has one). Back undoes a change, a link opens the page filtered,
 *    and "Clear filters" shows everything.
 *  - Cards or table, one choice for the page and the Overview (#299).
 *  - Each node opens its detail over the page (#309).
 *
 * It reads the header's poll for the model, and on the App's tick while it is
 * open `/api/services` and `/api/integrations`, and `/api/history` one tick
 * in three (useDashboardData, tickBudget.js), as the Overview does. With a
 * stale status every node, meter and pool is no signal, as there. Its own
 * chunk (lazyViews.js).
 */
import { useCallback, useId, useMemo } from 'react';
import { Boxes } from 'lucide-react';
import { ShellPage } from '@ui/app-shell';
import { Button } from '@ui/button';
import { DetailSections } from '@ui/entity-detail';
import { EmptyState } from '@ui/empty-state';
import { InfrastructureSection } from '@ui/infrastructure-section';
import { ListFilters } from '@ui/list-filters';
import { Panel } from '@ui/panel';
import { useConfig } from '../context/ConfigContext.jsx';
import { entityExtras } from './detail/entityExtras.js';
import { useInfrastructureSection } from './OverviewInfrastructure.jsx';
import { NODE_FILTERS, hasListFilters, useListFilters, useSearchDraft } from './listFilters.js';
import { filterNodes, infrastructureCount, roleOptions } from './infrastructureView.js';
import { sourceBanner } from './sourceHealth.js';
import { useDashboardData } from './useDashboardData.js';

const ALL = 'all';

/** The State filter's options, "All states" first: a node is never in maintenance. */
export const NODE_STATES = Object.freeze([
  { value: ALL, label: 'All states' },
  { value: 'problems', label: 'Problems' },
  { value: 'ok', label: 'Healthy' },
  { value: 'no-signal', label: 'No signal' },
]);
const NODE_STATE_VALUES = new Set(NODE_STATES.map((s) => s.value));

/** The Proxmox parts of a node's detail the page lists: its machines and its pools. */
const PROXMOX_PARTS = new Set(['vms', 'pools']);

/**
 * Each of `nodes` with a Proxmox integration, and the parts of its detail the
 * page lists (entityExtras.js, as the detail drawer builds them): `[{ node,
 * sections }]`, in the nodes' order.
 */
export function proxmoxOf({ status, nodes, services, integrations, stale }) {
  if (!integrations || typeof integrations !== 'object') return [];
  const read = { integrations: { body: integrations } };
  return nodes.flatMap((node) => {
    const entity = status?.entities?.find((e) => e.id === node.id);
    if (!entity) return [];
    const { sections } = entityExtras({ status, entity, read, services, freshness: { stale } });
    const parts = sections.filter((s) => PROXMOX_PARTS.has(s.key));
    return parts.length > 0 ? [{ node, sections: parts }] : [];
  });
}

/** Each Proxmox node's machines and pools, a panel each, under the nodes. */
function ProxmoxNodes({ list, stale }) {
  const id = useId();
  if (list.length === 0) return null;
  return (
    <section
      data-slot="proxmox-nodes"
      aria-labelledby={`${id}-title`}
      className="flex min-w-0 flex-col gap-3 text-text-1"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent-text inset-ring inset-ring-accent-border [&_svg]:size-4 [&_svg]:stroke-[1.75]"
        >
          <Boxes />
        </span>
        <h2 id={`${id}-title`} className="text-title-sm">
          Virtual machines and storage
        </h2>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
        {list.map(({ node, sections }) => (
          <li key={node.id} className="min-w-0">
            <Panel
              data-node={node.id}
              title={node.name}
              description={['Proxmox', node.host].filter(Boolean).join(' · ')}
              titleAs="h3"
              className="h-full"
            >
              <DetailSections sections={sections} muted={stale} />
            </Panel>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function InfrastructurePage({
  status,
  reach,
  updated,
  tick,
  active,
  refreshIntervalMs,
}) {
  const { config } = useConfig();
  const { serviceData, integrationData, history, servicesLoaded, sources, healthNow, retry } =
    useDashboardData(0, { tick, active, refreshIntervalMs });
  const health = useMemo(
    () => sourceBanner(sources.services, 'services', refreshIntervalMs, healthNow),
    [sources, refreshIntervalMs, healthNow]
  );
  const sections = useMemo(() => config.sections || {}, [config.sections]);
  const { nodes, freshness, view, setView, loading, banner } = useInfrastructureSection({
    status,
    reach,
    updated,
    services: serviceData,
    servicesLoaded,
    history,
    sections,
    health,
    onRetry: retry,
  });
  const stale = freshness.stale;

  const [filters, setFilters] = useListFilters(NODE_FILTERS);
  // The search filters as it is typed; the address follows once typing stops.
  const [text, setText] = useSearchDraft(filters.q, (q, options) => setFilters({ q }, options));
  const roles = useMemo(() => roleOptions(nodes), [nodes]);
  const wanted = useMemo(
    () => ({
      q: text,
      // A state no node can be in (maintenance) is no filter here.
      state: NODE_STATE_VALUES.has(filters.state) ? filters.state : null,
      role: roles.length > 0 ? filters.role : null,
    }),
    [filters, text, roles]
  );
  const shown = useMemo(() => filterNodes(nodes, wanted), [nodes, wanted]);
  const proxmox = useMemo(
    () =>
      proxmoxOf({
        status,
        nodes: shown,
        services: serviceData,
        integrations: integrationData,
        stale,
      }),
    [status, shown, serviceData, integrationData, stale]
  );
  const filtered = hasListFilters(wanted);
  const clear = useCallback(() => {
    setText('');
    setFilters({ q: '', state: null, role: null });
  }, [setText, setFilters]);
  const choose = (key) => (value) => setFilters({ [key]: value === ALL ? null : value });

  const roleItems = [{ value: ALL, label: 'All roles' }, ...roles];
  if (wanted.role && !roles.some((r) => r.value === wanted.role))
    roleItems.push({ value: wanted.role, label: wanted.role });
  const toolbar = (
    <ListFilters
      search={{ value: text, onChange: setText, label: 'Search nodes' }}
      filters={[
        {
          id: 'state',
          label: 'State',
          value: wanted.state ?? ALL,
          items: NODE_STATES,
          onValueChange: choose('state'),
        },
        ...(roles.length > 0
          ? [
              {
                id: 'role',
                label: 'Role',
                value: wanted.role ?? ALL,
                items: roleItems,
                onValueChange: choose('role'),
              },
            ]
          : []),
      ]}
      onClear={filtered ? clear : undefined}
    />
  );

  const empty = (
    <Panel data-slot="infrastructure-empty">
      {nodes.length > 0 ? (
        <EmptyState
          title="No nodes match these filters"
          description={`None of the ${nodes.length} nodes JagHelm watches is left by them.`}
          action={
            <Button variant="secondary" size="sm" onClick={clear}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <EmptyState
          title="No nodes yet"
          description="A node shows here once Prometheus reports it and services.yaml lists it."
        />
      )}
    </Panel>
  );

  return (
    <ShellPage data-slot="infrastructure-page">
      <h1 className="sr-only">Infrastructure</h1>
      <InfrastructureSection
        nodes={shown}
        count={infrastructureCount(shown, freshness, filtered ? { of: nodes.length } : undefined)}
        view={view}
        onViewChange={setView}
        loading={loading}
        banner={banner}
        toolbar={toolbar}
        empty={empty}
      />
      {!loading && <ProxmoxNodes list={proxmox} stale={stale} />}
    </ShellPage>
  );
}
