/**
 * The Overview's Jobs section (#578): every scheduled job and backup the
 * status model has, after Infrastructure, from the header's poll of
 * /api/status alone (jobsView.js: each row's state, word, reason, schedule
 * and last report). It reads nothing of its own, so it adds no request to a
 * tick. It is the new home of the old board's Scheduled Jobs panel; a job's
 * runs and Remove are in its detail (#310's drawer, src/shell/detail/). Its
 * own chunk (lazyViews.js), which a desktop asks for as the app starts, so a
 * phone's first load doesn't carry it.
 *
 * It is the Jobs and Backups subsystems': unfiltered it shows both groups,
 * the Jobs or Backups filter keeps that group alone (`filter`), any other
 * filter hides it, and so does its switch (Settings → Appearance → Overview
 * sections, #307). Each row opens its job's detail over the page (its URL,
 * #309, entityNav.js). A job a Remove took off leaves at once
 * (removedJobs.js), before the model drops it.
 *
 * With a stale status, it follows the one rule (statusFreshness.js, #480):
 * every row is drawn as no signal, its words kept as last known; the count
 * says how old they are. While the first status is on its way, placeholder
 * rows; with no job in the model, nothing; with every one removed in this
 * tab, before the model drops them, a quiet line under the heading. It sits on today's board under
 * Infrastructure, lined up with it (`margin`), 24px under it, in a root of
 * its own.
 */
import { memo, useMemo } from 'react';
import { ShellSection } from '@ui/app-shell';
import { JobsSection } from '@ui/jobs-section';
import { useEntityLink } from './entityNav.js';
import { hasJobs, jobGroups, jobRows, jobsCount } from './jobsView.js';
import { useRemovedJobs, wasRemoved } from './removedJobs.js';
import { useStatusAt, useStatusFreshness } from './statusFreshness.js';

export default memo(function OverviewJobs({ status, reach, updated, filter = null, margin = 16 }) {
  const freshness = useStatusFreshness({ status, reach, updated });
  const stale = freshness.stale;
  // Each answer re-renders the rows, so the ages move with the status's clock.
  const at = useStatusAt(updated);
  const held = useRemovedJobs(status);
  const linkOf = useEntityLink();
  const rows = useMemo(
    () =>
      jobRows({
        status,
        freshness: { stale },
        at,
        hidden: (e) => wasRemoved(held, e),
      }).map((row) => ({ ...row, ...linkOf(row.id) })),
    [status, stale, at, held, linkOf]
  );
  const groups = useMemo(() => jobGroups(rows, { status, filter }), [rows, status, filter]);
  const shown = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const loading = status == null && reach === 'loading';

  // A job a Remove hid still holds the section (and its heading, where focus
  // lands) until the model drops it.
  if (!loading && !hasJobs(status, filter)) return null;
  return (
    // 24px under the section above, as the mock spaces its sections.
    <div data-slot="overview-jobs" style={{ margin: `24px ${margin}px 0` }}>
      <ShellSection>
        <JobsSection groups={groups} count={jobsCount(shown, freshness)} loading={loading} />
      </ShellSection>
    </div>
  );
});
