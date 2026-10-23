/**
 * What the Overview's Services section (OverviewServices.jsx, #300) and the
 * Services page (ServicesPage.jsx, #313) both draw from, so the two are one
 * section: the rows (servicesView.js, each opening its service, #309), the
 * freshness, the grouping (one choice for both) with its control's options
 * and the hint beside a disabled Group, whether the first reads are still on
 * their way, and the Banner for numbers that stopped coming.
 */
import { useMemo } from 'react';
import { Banner } from '@ui/banner';
import { Button } from '@ui/button';
import { followLink } from '../router/useRoute.js';
import { pathTo } from '../router/routes.js';
import { useEntityLink } from './entityNav.js';
import { useStatusFreshness } from './statusFreshness.js';
import { groupingsFor, serviceRows, useServicesGrouping } from './servicesView.js';

// The words for numbers that stopped coming, from the board's source health
// (sourceHealth.js sourceBanner: `message` on a failed read, `staleNote` once
// the last answer is stale, by the header's rule, freshness.js).
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

// Where custom groups are made: the hint beside a disabled Group.
const SECTIONS = pathTo('settings', { section: 'sections' });
const noGroupsHint = (
  <>
    No custom groups yet:{' '}
    <a href={SECTIONS} onClick={(e) => followLink(e, SECTIONS)}>
      add one in Settings → Sections
    </a>
  </>
);

/**
 * What the Overview's section and the Services page (#313) both draw from:
 * the rows (each opening its service, #309), the freshness, the grouping and
 * its control's options and hint, whether the first reads are still on their
 * way, and the Banner for numbers that stopped coming.
 */
export function useServicesSection({
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
}) {
  const [chosen, setGrouping] = useServicesGrouping();
  const freshness = useStatusFreshness({ status, reach, updated });
  const stale = freshness.stale;
  // The rows change with the freshness's flag, not with each tick of its age.
  // Each row opens its service (#309).
  const linkOf = useEntityLink();
  const rows = useMemo(
    () =>
      serviceRows({ status, services, appData, sections, freshness: { stale } }).map((row) => ({
        ...row,
        ...linkOf(row.id),
      })),
    [status, services, appData, sections, stale, linkOf]
  );
  const groupings = useMemo(() => groupingsFor(customGroups), [customGroups]);
  const grouping = groupings.some((g) => g.value === chosen && !g.disabled) ? chosen : 'node';
  const loading = status == null ? reach === 'loading' : !servicesLoaded;
  const banner = useMemo(() => staleBanner(health, onRetry), [health, onRetry]);
  return {
    rows,
    freshness,
    grouping,
    groupings,
    setGrouping,
    groupingHint: groupings.some((g) => g.disabled) ? noGroupsHint : undefined,
    loading,
    banner: loading ? null : banner,
  };
}
