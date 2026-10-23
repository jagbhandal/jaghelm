/**
 * What the Overview's Infrastructure section (OverviewInfrastructure.jsx,
 * #299) and the Infrastructure page (InfrastructurePage.jsx, #313) both draw
 * from, so the two are one section: the nodes (infrastructureView.js, each
 * opening its detail, #309), the freshness, the cards / table choice (one for
 * both), whether the first reads are still on their way, and the Banner for
 * readings that stopped coming.
 */
import { useMemo } from 'react';
import { Banner } from '@ui/banner';
import { Button } from '@ui/button';
import { useEntityLink } from './entityNav.js';
import { useStatusFreshness } from './statusFreshness.js';
import { infrastructureNodes, useInfrastructureView } from './infrastructureView.js';

// The words for readings that stopped coming, from /api/services' health
// (sourceHealth.js sourceBanner: `message` on a failed read, `staleNote`
// once the last answer is stale, by the header's rule, freshness.js).
function staleBanner(health, onRetry) {
  if (!health?.message && !health?.staleNote) return null;
  const age = health.staleNote?.replace(/^updated /, '');
  return (
    <Banner
      tone="unknown"
      title="Node readings aren't updating"
      cause={
        health.message
          ? "JagHelm's last read of the nodes failed: these are the last readings it had"
          : 'No new readings have come in: these are the last ones'
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

/**
 * What the Overview's section and the Infrastructure page (#313) both draw
 * from: the nodes (each opening its detail, #309), the freshness, the cards
 * / table choice, whether the first reads are still on their way, and the
 * Banner for readings that stopped coming.
 */
export function useInfrastructureSection({
  status,
  reach,
  updated,
  services,
  servicesLoaded,
  history,
  sections,
  health,
  onRetry,
}) {
  const [view, setView] = useInfrastructureView();
  const freshness = useStatusFreshness({ status, reach, updated });
  const stale = freshness.stale;
  // The nodes change with the freshness's flag, not with each tick of its age.
  // Each node opens its detail (#309).
  const linkOf = useEntityLink();
  const nodes = useMemo(
    () =>
      infrastructureNodes({ status, services, history, sections, freshness: { stale } }).map(
        (node) => ({ ...node, ...linkOf(node.id) })
      ),
    [status, services, history, sections, stale, linkOf]
  );
  const loading = status == null ? reach === 'loading' : !servicesLoaded;
  const banner = useMemo(() => staleBanner(health, onRetry), [health, onRetry]);
  return { nodes, freshness, view, setView, loading, banner: loading ? null : banner };
}
