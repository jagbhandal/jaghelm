/**
 * The Services page (#313, spec §8 "Services and Infrastructure pages"), from
 * 768px at /services: every service the status model has, as the Overview's
 * Services section draws them (the same section, rows and grouping, from
 * useServicesSection and servicesView.js), with filters over them and a list
 * or a table. Below 768px the same address is the phone's Services tab
 * (PhoneView.jsx), so a window crossing 768px keeps the page and its filters.
 *
 *  - Its filters are in the address (listFilters.js): the search (a service's
 *    name, node, custom group or container), the state it is drawn in (all,
 *    problems, up, maintenance, no signal), its node, and a tag, a filter
 *    that shows only once a service has one (#519). Back undoes a change, a
 *    link opens the page filtered, and "Clear filters" shows everything.
 *  - Node or Group, as the Overview's, one choice for both; list or table,
 *    kept per browser (useServicesView).
 *  - Each row opens its service's detail over the page (#309).
 *
 * It reads the header's poll for the model, and `/api/services` and
 * `/api/integrations` on the App's tick while it is open (useDashboardData,
 * tickBudget.js), as the Overview's section does. With a stale status every
 * row is no signal, as there. Its own chunk (lazyViews.js).
 */
import { useCallback, useMemo } from 'react';
import { ShellPage } from '@ui/app-shell';
import { Button } from '@ui/button';
import { EmptyState } from '@ui/empty-state';
import { ListFilters } from '@ui/list-filters';
import { Panel } from '@ui/panel';
import { ServicesSection } from '@ui/services-section';
import { ServicesTable } from '@ui/services-table';
import { useConfig } from '../context/ConfigContext.jsx';
import { SERVICE_FILTERS, hasListFilters, useListFilters, useSearchDraft } from './listFilters.js';
import { filterServiceRows, serviceFilterOptions } from './pageFilters.js';
import { serviceGroups, servicesCount, useServicesView } from './servicesView.js';
import { sourceBanner } from './sourceHealth.js';
import { useAppDataMatching } from './useAppDataMatching.js';
import { useDashboardData } from './useDashboardData.js';
import { useServicesSection } from './useServicesSection.jsx';

/** What the page reads beside the status: the latencies, and the headline metrics. */
const SOURCES = ['services', 'integrations'];
const NO_GROUPS = [];
const ALL = 'all';

/** The State filter's options, "All states" first. */
const SERVICE_STATES = Object.freeze([
  { value: ALL, label: 'All states' },
  { value: 'problems', label: 'Problems' },
  { value: 'ok', label: 'Up' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'no-signal', label: 'No signal' },
]);

/** A Select's options: "All …" first, then `options`, and `chosen` when they no longer have it. */
function itemsOf(all, options, chosen) {
  const out = [{ value: ALL, label: all }, ...options];
  if (chosen && !options.some((o) => o.value === chosen))
    out.push({ value: chosen, label: chosen });
  return out;
}

export default function ServicesPage({ status, reach, updated, tick, active, refreshIntervalMs }) {
  const { config } = useConfig();
  const { serviceData, integrationData, servicesLoaded, sources, retry } = useDashboardData(0, {
    tick,
    active,
    refreshIntervalMs,
    only: SOURCES,
  });
  // The numbers' Banner, as the Overview's: the latencies' source, else the metrics'.
  const health = useMemo(() => {
    const services = sourceBanner(sources.services, 'services');
    if (services.message || services.staleNote) return services;
    return sourceBanner(sources.integrations, 'integrations');
  }, [sources]);
  const sections = useMemo(() => config.sections || {}, [config.sections]);
  const customGroups = useMemo(() => config.customGroups || NO_GROUPS, [config.customGroups]);
  const appData = useAppDataMatching(integrationData, serviceData);
  const { rows, freshness, grouping, groupings, setGrouping, groupingHint, loading, banner } =
    useServicesSection({
      status,
      reach,
      updated,
      services: serviceData,
      servicesLoaded,
      appData,
      customGroups,
      sections,
      health,
      onRetry: retry,
    });
  const [view, setView] = useServicesView();

  const [filters, setFilters] = useListFilters(SERVICE_FILTERS);
  // The search filters as it is typed; the address follows once typing stops.
  const [text, setText] = useSearchDraft(filters.q, (q, options) => setFilters({ q }, options));
  const options = useMemo(() => serviceFilterOptions(rows, serviceData), [rows, serviceData]);
  // No service has a tag yet (#519): no Tag filter, and a tag in the address is none.
  const tagged = options.tags.length > 0;
  const wanted = useMemo(
    () => ({ ...filters, q: text.trim(), tag: tagged ? filters.tag : null }),
    [filters, text, tagged]
  );
  const shown = useMemo(
    () => filterServiceRows(rows, wanted, { customGroups }),
    [rows, wanted, customGroups]
  );
  const groups = useMemo(
    () => serviceGroups(shown, { by: grouping, services: serviceData, customGroups }),
    [shown, grouping, serviceData, customGroups]
  );
  const filtered = hasListFilters(wanted);
  const clear = useCallback(() => {
    setText('');
    setFilters({ q: '', state: null, node: null, tag: null });
  }, [setText, setFilters]);
  const choose = (key) => (value) => setFilters({ [key]: value === ALL ? null : value });

  const toolbar = (
    <ListFilters
      filters={[
        { kind: 'search', id: 'q', label: 'Search services', value: text, onValueChange: setText },
        {
          id: 'state',
          label: 'State',
          value: wanted.state ?? ALL,
          items: SERVICE_STATES,
          onValueChange: choose('state'),
        },
        {
          id: 'node',
          label: 'Node',
          value: wanted.node ?? ALL,
          items: itemsOf('All nodes', options.nodes, wanted.node),
          onValueChange: choose('node'),
        },
        ...(tagged
          ? [
              {
                id: 'tag',
                label: 'Tag',
                value: wanted.tag ?? ALL,
                items: itemsOf(
                  'All tags',
                  options.tags.map((t) => ({ value: t, label: t })),
                  wanted.tag
                ),
                onValueChange: choose('tag'),
              },
            ]
          : []),
      ]}
      onClear={filtered ? clear : undefined}
    />
  );

  const empty = (
    <Panel data-slot="services-empty">
      {rows.length > 0 ? (
        <EmptyState
          title="No services match these filters"
          description={`None of the ${rows.length} services fits them all.`}
          action={
            <Button variant="secondary" size="sm" onClick={clear}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <EmptyState
          title="No services yet"
          description="A service shows here once Uptime Kuma monitors it, or a node runs its container."
        />
      )}
    </Panel>
  );

  return (
    <ShellPage data-slot="services-page">
      <h1 className="sr-only">Services</h1>
      <ServicesSection
        groups={groups}
        count={servicesCount(shown, freshness, filtered ? { of: rows.length } : undefined)}
        grouping={grouping}
        groupings={groupings}
        onGroupingChange={setGrouping}
        groupingHint={groupingHint}
        view={view}
        onViewChange={setView}
        table={<ServicesTable groups={groups} grouping={grouping} />}
        loading={loading}
        banner={banner}
        toolbar={toolbar}
        empty={empty}
      />
    </ShellPage>
  );
}
