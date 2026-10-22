/**
 * The Overview's Services section (#300, spec §8 item 4): every service the
 * status model has, in one list grouped by node or by custom group, from the
 * header's poll of /api/status (each row's state, word and reason) and the
 * board's /api/services and integrations (the latency and the headline
 * metric), put together by servicesView.js. It judges nothing itself. It
 * replaces today's service cards.
 *
 * The grouping is a choice kept per browser (useServicesGrouping), by node by
 * default; with storage blocked it lasts the visit. Grouping by custom group
 * is offered once Settings has one. Each row it draws puts its anchor on the
 * list of places (entityAnchors.js), so the attention panel's row for a
 * service leads to its row here.
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
 * last ones it had. It sits on today's board under Infrastructure, lined up
 * with it (`margin`), in a root of its own.
 */
import { memo, useMemo } from 'react';
import { Banner } from '@ui/banner';
import { Button } from '@ui/button';
import { ShellSection } from '@ui/app-shell';
import { ServicesSection } from '@ui/services-section';
import { usePlaces } from './entityAnchors.js';
import { useStatusFreshness } from './statusFreshness.js';
import {
  groupingsFor,
  serviceGroups,
  serviceRows,
  servicesCount,
  useServicesGrouping,
} from './servicesView.js';

// The words for numbers that stopped coming, from the board's source health
// (sourceHealth.js sourceBanner: `message` on a failed read, `staleNote` after
// two missed polls).
function staleBanner(health, onRetry) {
  if (!health?.message && !health?.staleNote) return null;
  const age = health.staleNote?.replace(/^updated /, '');
  return (
    <Banner
      tone="unknown"
      title="Service numbers aren't updating"
      cause={
        health.message
          ? "JagHelm's last read of the latencies and app numbers failed: these are the last ones it had"
          : 'No new latencies or app numbers have come in: these are the last ones'
      }
      detail={age ? `Updated ${age}` : undefined}
      action={
        onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        )
      }
    />
  );
}

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
  const [chosen, setGrouping] = useServicesGrouping();
  const freshness = useStatusFreshness({ status, reach, updated });
  const stale = freshness.stale;
  // The rows change with the freshness's flag, not with each tick of its age.
  const rows = useMemo(
    () => serviceRows({ status, services, appData, sections, freshness: { stale } }),
    [status, services, appData, sections, stale]
  );
  const groupings = useMemo(() => groupingsFor(customGroups), [customGroups]);
  const grouping = groupings.some((g) => g.value === chosen) ? chosen : 'node';
  const groups = useMemo(
    () => serviceGroups(rows, { by: grouping, services, customGroups }),
    [rows, grouping, services, customGroups]
  );
  const loading = status == null ? reach === 'loading' : !servicesLoaded;
  usePlaces(loading ? [] : rows.map((r) => r.id));
  const banner = useMemo(() => staleBanner(health, onRetry), [health, onRetry]);

  if (!loading && rows.length === 0) return null;
  return (
    <div data-slot="overview-services" style={{ margin: `0 ${margin}px` }}>
      <ShellSection>
        <ServicesSection
          groups={groups}
          count={servicesCount(rows, freshness)}
          grouping={grouping}
          groupings={groupings}
          onGroupingChange={setGrouping}
          loading={loading}
          banner={loading ? null : banner}
        />
      </ShellSection>
    </div>
  );
});
