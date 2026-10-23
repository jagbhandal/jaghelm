/**
 * The Overview's Services section (#300, spec §8 item 4): every service the
 * status model has, in one list grouped by node or by custom group, from the
 * header's poll of /api/status (each row's state, word and reason) and the
 * board's /api/services and integrations (the latency and the headline
 * metric), put together by servicesView.js. It judges nothing itself. It
 * replaced the old board's service cards.
 *
 * The grouping is a choice kept per browser (useServicesGrouping), by node by
 * default; with storage blocked it lasts the visit. Grouping by custom group
 * is disabled until Settings has one, with a link there. Each row opens its
 * service's detail over the page (its URL, #309, entityNav.js).
 *
 * With a stale status (no signal: a failed poll, or a status past its TTL),
 * it follows the one rule (statusFreshness.js, #480, #495): every row is
 * drawn as no signal, its lamp named so, never in a level from that status;
 * the count says "No signal · last known 3 min ago", by the same clock as the
 * header and the attention panel.
 *
 * While the first status or the first /api/services is on its way, placeholder
 * rows; with no service in the model (no Kuma and no containers, or all on
 * nodes hidden in Settings), nothing. When /api/services or the integrations
 * stop answering, a Banner says the numbers are old, with Retry, over the
 * last ones it had. It sits under the sections above it (OverviewBoard.jsx),
 * lined up with them (`margin`), 24px under them, in a root of its own.
 *
 * The Services page (#313, ServicesPage.jsx) draws the same section from the
 * same parts (useServicesSection), every service, with its filters.
 */
import { memo, useMemo } from 'react';
import { ShellSection } from '@ui/app-shell';
import { ServicesSection } from '@ui/services-section';
import { serviceGroups, servicesCount } from './servicesView.js';
import { useServicesSection } from './useServicesSection.jsx';

const NO_GROUPS = [];

export const OverviewServices = memo(function OverviewServices({
  status,
  reach,
  updated,
  services,
  servicesLoaded,
  appData,
  customGroups = NO_GROUPS,
  sections,
  health,
  onRetry,
  margin = 16,
}) {
  const { rows, freshness, grouping, groupings, setGrouping, groupingHint, loading, banner } =
    useServicesSection({
      status,
      reach,
      updated,
      services,
      servicesLoaded,
      appData,
      customGroups,
      sections,
      health,
      onRetry,
    });
  const groups = useMemo(
    () => serviceGroups(rows, { by: grouping, services, customGroups }),
    [rows, grouping, services, customGroups]
  );

  if (!loading && rows.length === 0) return null;
  return (
    // 24px under the section above, as the mock spaces its sections.
    <div data-slot="overview-services" style={{ margin: `24px ${margin}px 0` }}>
      <ShellSection>
        <ServicesSection
          groups={groups}
          count={servicesCount(rows, freshness)}
          grouping={grouping}
          groupings={groupings}
          onGroupingChange={setGrouping}
          groupingHint={groupingHint}
          loading={loading}
          banner={banner}
        />
      </ShellSection>
    </div>
  );
});
