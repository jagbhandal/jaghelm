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
import { useCallback, useMemo } from 'react';
import { Boxes } from 'lucide-react';
import { ShellPage } from '@ui/app-shell';
import { Button } from '@ui/button';
import { DetailSections } from '@ui/entity-detail';
import { EmptyState } from '@ui/empty-state';
import { InfrastructureSection } from '@ui/infrastructure-section';
import { ListFilters } from '@ui/list-filters';
import { Panel } from '@ui/panel';
import { useConfig } from '../context/ConfigContext.jsx';
import { NODE_FILTERS, hasListFilters, useListFilters, useSearchDraft } from './listFilters.js';
import { infrastructureCount } from './infrastructureView.js';
import { filterNodes, roleOptions } from './pageFilters.js';
import { sourceBanner } from './sourceHealth.js';
import { proxmoxOf } from './proxmoxNodes.js';
import { useDashboardData } from './useDashboardData.js';
import { useInfrastructureSection } from './useInfrastructureSection.jsx';

const ALL = 'all';

/** The State filter's options, "All states" first: a node is never in maintenance. */
const NODE_STATES = Object.freeze([
  { value: ALL, label: 'All states' },
  { value: 'problems', label: 'Problems' },
  { value: 'ok', label: 'Healthy' },
  { value: 'no-signal', label: 'No signal' },
]);
const NODE_STATE_VALUES = new Set(NODE_STATES.map((s) => s.value));

/**
 * Each Proxmox node's machines and pools, under the nodes: one Panel, its
 * parts the detail drawer's (DetailSections), each named by its node.
 */
function ProxmoxNodes({ list, stale }) {
  if (list.length === 0) return null;
  const sections = list.flatMap(({ node, sections: parts }) =>
    parts.map((part) => ({
      ...part,
      key: `${node.id}:${part.key}`,
      title: `${node.name} · ${part.title}`,
    }))
  );
  return (
    <Panel
      data-slot="proxmox-nodes"
      icon={<Boxes />}
      title="Virtual machines and storage"
      description="Each Proxmox node's, as its detail lists them"
    >
      <DetailSections sections={sections} muted={stale} />
    </Panel>
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
  const { serviceData, integrationData, history, servicesLoaded, sources, retry } =
    useDashboardData(0, { tick, active, refreshIntervalMs });
  const health = useMemo(() => sourceBanner(sources.services, 'services'), [sources]);
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
      q: text.trim(),
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
          description={`None of the ${nodes.length} nodes fits them all.`}
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
