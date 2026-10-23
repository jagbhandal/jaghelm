/**
 * The Overview's Power section (#306): the UPS, from the header's poll of
 * /api/status alone (powerView.js), so it adds no request to a tick. It is
 * the new home of the old board's UPS panel: the UPS's place on the Overview
 * whatever its state, on mains too, where it has no issue row; its row opens
 * the UPS's detail over the page (its URL, #309; the charge, load, model and
 * runtime, #310).
 *
 * It is the Power subsystem's: unfiltered and under the Power filter it
 * shows, any other filter hides it, and so does its switch (Settings →
 * Appearance → Overview sections). With no UPS in the model, nothing. With a
 * stale status it follows the one rule (statusFreshness.js, #480): the row is
 * drawn as no signal, its words kept as last known; the count says how old
 * they are. It is the Jobs section's look (JobsSection), with its own title
 * and icon, 24px under the section above, lined up with it (`margin`).
 */
import { memo, useMemo } from 'react';
import { Zap } from 'lucide-react';
import { ShellSection } from '@ui/app-shell';
import { JobsSection } from '@ui/jobs-section';
import { useEntityLink } from './entityNav.js';
import { hasPower, powerCount, powerRows } from './powerView.js';
import { useStatusFreshness } from './statusFreshness.js';

export const OverviewPower = memo(function OverviewPower({ status, reach, updated, margin = 16 }) {
  const freshness = useStatusFreshness({ status, reach, updated });
  const stale = freshness.stale;
  const linkOf = useEntityLink();
  const rows = useMemo(
    () => powerRows({ status, freshness: { stale } }).map((row) => ({ ...row, ...linkOf(row.id) })),
    [status, stale, linkOf]
  );
  const groups = useMemo(
    () => (rows.length ? [{ key: 'ups', title: 'UPS', count: null, rows }] : []),
    [rows]
  );
  if (!hasPower(status)) return null;
  return (
    <div data-slot="overview-power" style={{ margin: `24px ${margin}px 0` }}>
      <ShellSection>
        <JobsSection
          data-slot="power-section"
          title="Power"
          icon={<Zap />}
          groups={groups}
          count={powerCount(status, freshness)}
        />
      </ShellSection>
    </div>
  );
});
