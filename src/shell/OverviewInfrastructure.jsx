/**
 * The Overview's Infrastructure section (#299, spec §8 item 3): the nodes, as
 * cards or a table, from the header's poll of /api/status (the states, words,
 * reasons, levels and lines) and the board's /api/services and /api/history
 * (the readings and the hour of CPU), put together by infrastructureView.js.
 * It judges nothing itself.
 *
 * Cards or table is a choice kept per browser (useInfrastructureView), cards
 * by default; with storage blocked it lasts the visit. Each node it draws puts
 * its anchor on the list of places (entityAnchors.js), so the attention
 * panel's row for a node leads to its card, or its row in the table.
 *
 * While the first status or the first /api/services is on its way, three
 * placeholder cards; with no node in the model (or all hidden in Settings),
 * nothing. When /api/services stops answering, a Banner says the readings are
 * old, with Retry, over the last ones it had. It sits on today's board, lined
 * up with its cards (`margin`, HelmGrid's), in a root of its own.
 */
import { memo, useMemo } from 'react';
import { Banner } from '@ui/banner';
import { Button } from '@ui/button';
import { ShellSection } from '@ui/app-shell';
import { InfrastructureSection } from '@ui/infrastructure-section';
import { usePlaces } from './entityAnchors.js';
import {
  infrastructureCount,
  infrastructureNodes,
  useInfrastructureView,
} from './infrastructureView.js';

// The words for readings that stopped coming, from /api/services' health
// (sourceHealth.js sourceBanner: `message` on a failed read, `staleNote`
// after two missed polls).
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
  services,
  servicesLoaded,
  history,
  sections,
  tempUnit,
  health,
  onRetry,
  margin = 16,
}) {
  const [view, setView] = useInfrastructureView();
  const nodes = useMemo(
    () => infrastructureNodes({ status, services, history, sections, tempUnit }),
    [status, services, history, sections, tempUnit]
  );
  const loading = status == null ? reach === 'loading' : !servicesLoaded;
  usePlaces(loading ? [] : nodes.map((n) => n.id));
  const banner = useMemo(() => staleBanner(health, onRetry), [health, onRetry]);

  if (!loading && nodes.length === 0) return null;
  return (
    <div data-slot="overview-infrastructure" style={{ margin: `0 ${margin}px` }}>
      <ShellSection>
        <InfrastructureSection
          nodes={nodes}
          count={infrastructureCount(nodes)}
          view={view}
          onViewChange={setView}
          loading={loading}
          banner={loading ? null : banner}
        />
      </ShellSection>
    </div>
  );
});
