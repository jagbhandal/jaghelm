/**
 * The Overview's Infrastructure section (#299, spec §8 item 3): the nodes, as
 * cards or a table, from the header's poll of /api/status (the states, words,
 * reasons, levels and lines) and the board's /api/services and /api/history
 * (the readings and the hour of CPU), put together by infrastructureView.js.
 * It judges nothing itself.
 *
 * Cards or table is a choice kept per browser (useInfrastructureView), cards
 * by default; with storage blocked it lasts the visit. Each node opens its
 * detail over the page, from its card or its row in the table (its URL, #309,
 * entityNav.js).
 *
 * With a stale status (no signal: a failed poll, or a status past its TTL),
 * it follows the one rule (statusFreshness.js, #480, #495): every node and
 * meter is drawn as no signal, never in a level from that status, beside the
 * readings /api/services still gives; the count says "No signal · last known
 * 3 min ago", by the same clock as the header and the attention panel.
 *
 * While the first status or the first /api/services is on its way, three
 * placeholder cards; with no node in the model (or all hidden in Settings),
 * nothing. When /api/services stops answering, a Banner says the readings are
 * old, with Retry, over the last ones it had. It sits first under the
 * Overview's status (OverviewBoard.jsx), lined up with it (`margin`), in a
 * root of its own.
 */
import { memo, useMemo } from 'react';
import { Banner } from '@ui/banner';
import { Button } from '@ui/button';
import { ShellSection } from '@ui/app-shell';
import { InfrastructureSection } from '@ui/infrastructure-section';
import { useEntityLink } from './entityNav.js';
import { useStatusFreshness } from './statusFreshness.js';
import {
  infrastructureCount,
  infrastructureNodes,
  useInfrastructureView,
} from './infrastructureView.js';

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

export const OverviewInfrastructure = memo(function OverviewInfrastructure({
  status,
  reach,
  updated,
  services,
  servicesLoaded,
  history,
  sections,
  health,
  onRetry,
  margin = 16,
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

  if (!loading && nodes.length === 0) return null;
  return (
    <div data-slot="overview-infrastructure" style={{ margin: `0 ${margin}px` }}>
      <ShellSection>
        <InfrastructureSection
          nodes={nodes}
          count={infrastructureCount(nodes, freshness)}
          view={view}
          onViewChange={setView}
          loading={loading}
          banner={loading ? null : banner}
        />
      </ShellSection>
    </div>
  );
});
